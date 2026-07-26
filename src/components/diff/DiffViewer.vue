<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { storeToRefs } from "pinia";
import { html } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import type {
  DiffSide,
  DiffLocationRequest,
  DiffLocationResult,
  DiffResult,
  FileStatus,
  PatchHunk,
  PatchLine,
  Platform,
  PrFile,
  PrFileContent,
  ReviewThreadSummary,
  StandardPatchFile,
} from "@/types";
import { prFileContent, reviewFileSetViewed, reviewViewedFilesList } from "@/api";
import AppSelect from "@/components/shared/AppSelect.vue";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";
import {
  useReviewProgressStore,
  type ReviewProgressContext,
} from "@/stores/useReviewProgressStore";
import { getErrorMessage } from "@/utils/error";
import { findPatchLocation as findStandardPatchLocation } from "@/utils/diffHunk";
import CodeSearchBar from "./CodeSearchBar.vue";
import { useDiffCodeSearch } from "./useDiffCodeSearch";
import { useDiffPopupStyle, useDiffViewportStyles } from "./useDiffLayoutStyles";
import { useDocumentStateClass } from "@/composables/useDynamicCssClass";

const props = defineProps<{
  diff: DiffResult | null;
  platform?: Platform;
  owner?: string;
  repo?: string;
  prNumber?: number;
  baseSha?: string;
  headSha?: string;
  baseOwner?: string;
  baseRepo?: string;
  headOwner?: string;
  headRepo?: string;
  locationRequest?: DiffLocationRequest | null;
  threadSummary?: ReviewThreadSummary | null;
  canSyncViewedFiles?: boolean;
  readOnly?: boolean;
}>();

const uiSettings = useUiSettingsStore();
const reviewProgress = useReviewProgressStore();
const { isDiffSyncScrollEnabled } = storeToRefs(uiSettings);
const viewedFilesLoading = ref(false);
const viewedFilesError = ref("");
const viewedFilesLoadedRemotely = ref(false);
const syncingViewedFiles = ref(new Set<string>());
let viewedFilesRequestSequence = 0;

const emit = defineEmits<{
  addComment: [
    path: string,
    startLine: number,
    endLine: number,
    side: "left" | "right",
    body: string,
  ];
  locationResult: [result: DiffLocationResult];
  reviewProgress: [unviewedFileCount: number];
}>();

interface FileTreeNode {
  key: string;
  name: string;
  kind: "directory" | "file";
  children: FileTreeNode[];
  file: PrFile | null;
}

interface FileTreeRow extends FileTreeNode {
  depth: number;
}

interface ControlledDiffRow {
  key: string;
  left: PatchLine | null;
  right: PatchLine | null;
}

interface ControlledContextGap {
  key: string;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  direction: "up" | "both" | "down";
}

interface ControlledDiffHunk {
  key: string;
  hunk: PatchHunk;
  rows: ControlledDiffRow[];
  gapBefore: ControlledContextGap | null;
}

interface LoadedFileContext {
  identity: string;
  baseLines: string[];
  headLines: string[];
}

interface ImagePreviewTarget {
  side: "base" | "head";
  label: string;
  owner: string;
  repo: string;
  path: string;
  revision: string;
  mimeType: string;
}

interface ImagePreviewPanel extends ImagePreviewTarget {
  src: string | null;
  error: string | null;
}

interface ContextExpansion {
  fromStart: number;
  fromEnd: number;
}

interface ContextGapAction {
  edge: "start" | "end";
  arrow: "↑" | "↓";
}

interface HighlightedLocation {
  path: string;
  line: number;
  side: DiffSide;
}

const CONTEXT_EXPANSION_STEP = 20;
const IMAGE_MIME_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

const containerRef = ref<HTMLElement | null>(null);
const workspaceRef = ref<HTMLElement | null>(null);
const topScrollbarRef = ref<HTMLElement | null>(null);
const leftTopScrollbarRef = ref<HTMLElement | null>(null);
const rightTopScrollbarRef = ref<HTMLElement | null>(null);
const diffScrollRef = ref<HTMLElement | null>(null);
const topScrollbarContentWidth = ref(0);
const independentTopScrollbarWidths = ref<[number, number]>([0, 0]);
const navigatorVisible = ref(true);
const navigatorWidth = ref(270);
const {
  workspaceClass,
  unifiedScrollbarContentClass,
  leftScrollbarContentClass,
  rightScrollbarContentClass,
  treeRowDepthClass,
} = useDiffViewportStyles({
  navigatorWidth,
  topScrollbarContentWidth,
  independentTopScrollbarWidths,
});
const resizingNavigator = ref(false);
const selectedFilePath = ref("");
const expandedDirectories = ref<Set<string>>(new Set());
const highlightedLocation = ref<HighlightedLocation | null>(null);
let locationRequestSequence = 0;

const controlledSides = ["left", "right"] as const;

const statusDescriptions: Record<FileStatus, string> = {
  added: "新增",
  modified: "修改",
  removed: "删除",
  renamed: "重命名",
};

function sortTree(nodes: FileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  nodes.forEach((node) => sortTree(node.children));
}

function buildFileTree(files: PrFile[]): FileTreeNode[] {
  const root: FileTreeNode = {
    key: "",
    name: "",
    kind: "directory",
    children: [],
    file: null,
  };

  files.forEach((file) => {
    const segments = file.filename.split("/").filter(Boolean);
    if (segments.length === 0) return;

    let parent = root;
    let currentPath = "";
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      let child = parent.children.find(
        (node) => node.name === segment && node.kind === (isFile ? "file" : "directory"),
      );
      if (!child) {
        child = {
          key: isFile ? file.filename : `directory:${currentPath}`,
          name: segment,
          kind: isFile ? "file" : "directory",
          children: [],
          file: isFile ? file : null,
        };
        parent.children.push(child);
      }
      parent = child;
    });
  });

  sortTree(root.children);
  return root.children;
}

function firstFilePath(nodes: FileTreeNode[]): string {
  for (const node of nodes) {
    if (node.file) return node.file.filename;
    const nested = firstFilePath(node.children);
    if (nested) return nested;
  }
  return "";
}

function collectDirectoryKeys(nodes: FileTreeNode[], keys = new Set<string>()): Set<string> {
  nodes.forEach((node) => {
    if (node.kind === "directory") {
      keys.add(node.key);
      collectDirectoryKeys(node.children, keys);
    }
  });
  return keys;
}

function expandDirectoriesForFile(path: string): void {
  const segments = path.split("/").filter(Boolean);
  const next = new Set(expandedDirectories.value);
  let directoryPath = "";
  for (const segment of segments.slice(0, -1)) {
    directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment;
    next.add(`directory:${directoryPath}`);
  }
  expandedDirectories.value = next;
}

const fileTree = computed(() => buildFileTree(props.diff?.files ?? []));
const visibleTreeRows = computed(() => {
  const rows: FileTreeRow[] = [];
  const visit = (nodes: FileTreeNode[], depth: number) => {
    nodes.forEach((node) => {
      rows.push({ ...node, depth });
      if (node.kind === "directory" && expandedDirectories.value.has(node.key)) {
        visit(node.children, depth + 1);
      }
    });
  };
  visit(fileTree.value, 1);
  return rows;
});
const selectedFile = computed(
  () => props.diff?.files.find((file) => file.filename === selectedFilePath.value) ?? null,
);
const reviewProgressContext = computed(() => {
  // 只读 Diff（创建预览、按提交查看历史变更）不是评审对象，不参与“已查看”进度。
  if (props.readOnly) return null;
  if (!props.platform || !props.owner || !props.repo || !props.prNumber || !props.headSha)
    return null;
  return {
    platform: props.platform,
    owner: props.owner,
    repo: props.repo,
    prNumber: props.prNumber,
    headSha: props.headSha,
  };
});
function reviewProgressIdentity(context: ReviewProgressContext): string {
  return [context.platform, context.owner, context.repo, context.prNumber, context.headSha].join(
    ":",
  );
}

const viewedProgressSource = computed(() => {
  if (!props.canSyncViewedFiles) return "本地";
  if (viewedFilesLoading.value) return "同步中";
  if (!viewedFilesLoadedRemotely.value) return "本地缓存";
  return "远端";
});
const viewedProgressDescription = computed(() => {
  if (!props.canSyncViewedFiles) return "查看进度仅保存在本机";
  if (viewedFilesLoading.value) return "正在从远端同步查看进度";
  if (!viewedFilesLoadedRemotely.value) return "远端同步失败，当前展示本地缓存";
  return "查看进度已同步到远端平台";
});
const viewedFilePaths = computed(() => {
  const context = reviewProgressContext.value;
  return context ? reviewProgress.viewedFiles(context) : new Set<string>();
});
const viewedFileCount = computed(
  () => props.diff?.files.filter((file) => viewedFilePaths.value.has(file.filename)).length ?? 0,
);
const unviewedFileCount = computed(() =>
  Math.max(0, (props.diff?.files.length ?? 0) - viewedFileCount.value),
);
const hasStandardPatchPayload = computed(
  () => props.diff?.patch_schema_version === 1 && Array.isArray(props.diff?.patches),
);
const selectedStandardPatch = computed(
  () =>
    (hasStandardPatchPayload.value ? props.diff?.patches : [])?.find(
      (patch) => patch.filename === selectedFilePath.value,
    ) ?? null,
);

const imageViewMode = ref<"source" | "preview">("preview");
const imagePreviewPanels = ref<ImagePreviewPanel[]>([]);
const imagePreviewLoading = ref(false);
let imagePreviewRequestSequence = 0;

function imageMimeType(path: string): string | null {
  const extension = path.toLowerCase().split(".").at(-1) ?? "";
  return IMAGE_MIME_TYPES[extension] ?? null;
}

const imagePreviewTargets = computed<ImagePreviewTarget[]>(() => {
  const patch = selectedStandardPatch.value;
  if (!patch || !props.platform) return [];

  const targets: ImagePreviewTarget[] = [];
  const baseOwner = props.baseOwner ?? props.owner;
  const baseRepo = props.baseRepo ?? props.repo;
  const baseMimeType = patch.old_path ? imageMimeType(patch.old_path) : null;
  if (patch.old_path && props.baseSha && baseMimeType && baseOwner && baseRepo) {
    targets.push({
      side: "base",
      label: "变更前",
      owner: baseOwner,
      repo: baseRepo,
      path: patch.old_path,
      revision: props.baseSha,
      mimeType: baseMimeType,
    });
  }
  const headOwner = props.headOwner ?? props.owner;
  const headRepo = props.headRepo ?? props.repo;
  const headMimeType = patch.new_path ? imageMimeType(patch.new_path) : null;
  if (patch.new_path && props.headSha && headMimeType && headOwner && headRepo) {
    targets.push({
      side: "head",
      label: "变更后",
      owner: headOwner,
      repo: headRepo,
      path: patch.new_path,
      revision: props.headSha,
      mimeType: headMimeType,
    });
  }
  return targets;
});
const canPreviewImage = computed(() => imagePreviewTargets.value.length > 0);
const isShowingImagePreview = computed(
  () => canPreviewImage.value && imageViewMode.value === "preview",
);
const imagePreviewIdentity = computed(() =>
  [
    props.platform ?? "",
    props.owner ?? "",
    props.repo ?? "",
    props.baseOwner ?? "",
    props.baseRepo ?? "",
    props.headOwner ?? "",
    props.headRepo ?? "",
    selectedStandardPatch.value?.old_path ?? "",
    selectedStandardPatch.value?.new_path ?? "",
    props.baseSha ?? "",
    props.headSha ?? "",
  ].join("\0"),
);

function svgViewBoxDimensions(svg: Element): { width: number; height: number } | null {
  const values = (svg.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const width = values[2];
  const height = values[3];
  return values.length === 4 &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
    ? { width, height }
    : null;
}

function hasFixedSvgDimension(value: string | null): boolean {
  const dimension = value?.trim();
  return dimension !== undefined && dimension !== "" && !dimension.endsWith("%");
}

function createSvgPreviewSource(content: string): string | null {
  const document = new DOMParser().parseFromString(content, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror")) {
    return null;
  }
  const dimensions = svgViewBoxDimensions(svg);
  if (
    dimensions &&
    (!hasFixedSvgDimension(svg.getAttribute("width")) ||
      !hasFixedSvgDimension(svg.getAttribute("height")))
  ) {
    svg.setAttribute("width", String(dimensions.width));
    svg.setAttribute("height", String(dimensions.height));
  }

  const normalizedContent = new XMLSerializer().serializeToString(document);
  const bytes = new TextEncoder().encode(normalizedContent);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  // SVG stays in the browser's restricted image context and is never injected as markup.
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function createImagePreviewSource(file: PrFileContent, mimeType: string): string | null {
  if (mimeType === "image/svg+xml") {
    return file.content_base64
      ? `data:image/svg+xml;base64,${file.content_base64}`
      : createSvgPreviewSource(file.content);
  }
  return file.binary && file.content_base64
    ? `data:${mimeType};base64,${file.content_base64}`
    : null;
}

async function loadImagePreview(): Promise<void> {
  const targets = imagePreviewTargets.value;
  const identity = imagePreviewIdentity.value;
  if (!canPreviewImage.value || !props.platform) return;
  const platform = props.platform;

  const requestSequence = ++imagePreviewRequestSequence;
  imagePreviewLoading.value = true;
  imagePreviewPanels.value = targets.map((target) => ({ ...target, src: null, error: null }));

  const panels = await Promise.all(
    targets.map(async (target): Promise<ImagePreviewPanel> => {
      try {
        const file = await prFileContent(
          platform,
          target.owner,
          target.repo,
          target.path,
          target.revision,
        );
        if (file.truncated) {
          return { ...target, src: null, error: "图片文件过大，无法渲染预览" };
        }
        const src = createImagePreviewSource(file, target.mimeType);
        return src
          ? { ...target, src, error: null }
          : { ...target, src: null, error: "文件内容不是有效或受支持的图片" };
      } catch (error) {
        return { ...target, src: null, error: getErrorMessage(error, "图片预览加载失败") };
      }
    }),
  );

  if (requestSequence !== imagePreviewRequestSequence || identity !== imagePreviewIdentity.value)
    return;
  imagePreviewPanels.value = panels;
  imagePreviewLoading.value = false;
}

function setImageViewMode(mode: "source" | "preview"): void {
  imageViewMode.value = mode;
  if (mode === "preview") closeCodeSearch();
}

function imagePreviewPanelKey(panel: ImagePreviewTarget): string {
  return [panel.side, panel.owner, panel.repo, panel.path, panel.revision].join("\0");
}

function handleImagePreviewError(failedPanel: ImagePreviewPanel): void {
  imagePreviewPanels.value = imagePreviewPanels.value.map((currentPanel) =>
    imagePreviewPanelKey(currentPanel) === imagePreviewPanelKey(failedPanel) &&
    currentPanel.src === failedPanel.src
      ? { ...currentPanel, src: null, error: "图片解码失败" }
      : currentPanel,
  );
}

function resolveLocationFile(
  path: string,
): { file: PrFile; patch: StandardPatchFile | null } | null {
  const patches = hasStandardPatchPayload.value ? (props.diff?.patches ?? []) : [];
  const patch =
    patches.find(
      (candidate) =>
        candidate.filename === path || candidate.old_path === path || candidate.new_path === path,
    ) ?? null;
  const filename = patch?.filename ?? path;
  const file = props.diff?.files.find((candidate) => candidate.filename === filename) ?? null;
  return file ? { file, patch } : null;
}

function isHighlightedLine(side: DiffSide, line: number | null | undefined): boolean {
  const location = highlightedLocation.value;
  return (
    line != null &&
    location?.path === selectedFilePath.value &&
    location.side === side &&
    location.line === line
  );
}

function findControlledLineElement(side: DiffSide, line: number): HTMLElement | null {
  return (
    Array.from(
      containerRef.value?.querySelectorAll<HTMLElement>(".controlled-line[data-side][data-line]") ??
        [],
    ).find((element) => element.dataset.side === side && Number(element.dataset.line) === line) ??
    null
  );
}

function scrollElementWithinContainer(
  element: HTMLElement,
  container: HTMLElement,
  alignment: "center" | "nearest",
): void {
  const elementRect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const elementTop = container.scrollTop + elementRect.top - containerRect.top;
  const elementBottom = elementTop + elementRect.height;
  const viewportTop = container.scrollTop;
  const viewportBottom = viewportTop + container.clientHeight;

  if (alignment === "nearest") {
    if (elementTop < viewportTop) container.scrollTop = elementTop;
    else if (elementBottom > viewportBottom) {
      container.scrollTop = elementBottom - container.clientHeight;
    }
    return;
  }

  container.scrollTop = Math.max(
    0,
    elementTop - Math.max(0, (container.clientHeight - elementRect.height) / 2),
  );
}

function scrollSelectedTreeRowIntoView(path: string): void {
  const row = Array.from(
    workspaceRef.value?.querySelectorAll<HTMLElement>(".tree-row[data-file-path]") ?? [],
  ).find((candidate) => candidate.dataset.filePath === path);
  const tree = row?.closest<HTMLElement>(".file-tree");
  if (row && tree) scrollElementWithinContainer(row, tree, "nearest");
}

function emitLocationFailure(request: DiffLocationRequest, message: string): void {
  emit("locationResult", { id: request.id, success: false, message });
}

async function locateDiffRequest(request: DiffLocationRequest): Promise<void> {
  const sequence = ++locationRequestSequence;
  highlightedLocation.value = null;
  const path = request.path.trim();
  if (!path) {
    emitLocationFailure(request, "AI 建议未提供文件路径，无法在 Diff 中定位");
    return;
  }

  const resolved = resolveLocationFile(path);
  if (!resolved) {
    emitLocationFailure(request, `当前变更中找不到文件 ${path}，该建议可能已过期`);
    return;
  }

  expandDirectoriesForFile(resolved.file.filename);
  await selectFile(resolved.file.filename);
  await nextTick();
  if (sequence !== locationRequestSequence) return;
  scrollSelectedTreeRowIntoView(resolved.file.filename);

  if (request.line == null) {
    if (diffScrollRef.value) diffScrollRef.value.scrollTop = 0;
    emit("locationResult", { id: request.id, success: true, message: null });
    return;
  }
  if (!Number.isInteger(request.line) || request.line <= 0) {
    emitLocationFailure(request, `AI 建议提供的行号 ${request.line} 无效`);
    return;
  }
  if (!resolved.patch || resolved.patch.content_kind !== "text") {
    emitLocationFailure(request, `文件 ${resolved.file.filename} 没有可定位的标准文本 Patch`);
    return;
  }

  const target = findStandardPatchLocation(resolved.patch, request.line, path, request.side);
  if (!target) {
    emitLocationFailure(
      request,
      `文件 ${resolved.file.filename} 中找不到变更行 ${request.line}，该建议可能已过期或行号不在当前 Patch 中`,
    );
    return;
  }

  highlightedLocation.value = {
    path: resolved.file.filename,
    line: target.line,
    side: target.side,
  };
  await nextTick();
  if (sequence !== locationRequestSequence) return;
  const lineElement = findControlledLineElement(target.side, target.line);
  if (!lineElement) {
    highlightedLocation.value = null;
    emitLocationFailure(request, `文件 ${resolved.file.filename} 的目标行暂时无法显示`);
    return;
  }
  const diffScroll = diffScrollRef.value;
  if (!diffScroll) {
    highlightedLocation.value = null;
    emitLocationFailure(request, `文件 ${resolved.file.filename} 的滚动容器暂时不可用`);
    return;
  }
  scrollElementWithinContainer(lineElement, diffScroll, "center");
  emit("locationResult", { id: request.id, success: true, message: null });
}

function pairHunkLines(lines: PatchLine[], hunkKey: string): ControlledDiffRow[] {
  const rows: ControlledDiffRow[] = [];
  let deletions: PatchLine[] = [];
  let additions: PatchLine[] = [];
  let rowIndex = 0;
  let previousKind: PatchLine["kind"] | null = null;

  const appendRow = (left: PatchLine | null, right: PatchLine | null) => {
    rows.push({ key: `${hunkKey}:row:${rowIndex}`, left, right });
    rowIndex += 1;
  };
  const flushChanges = () => {
    const rowCount = Math.max(deletions.length, additions.length);
    for (let index = 0; index < rowCount; index += 1) {
      appendRow(deletions[index] ?? null, additions[index] ?? null);
    }
    deletions = [];
    additions = [];
  };

  for (const line of lines) {
    if (line.kind === "context") {
      flushChanges();
      appendRow(line, line);
    } else if (line.kind === "deletion") {
      if (additions.length > 0) flushChanges();
      deletions.push(line);
    } else if (line.kind === "addition") {
      additions.push(line);
    } else if (line.kind === "no_newline") {
      continue;
    } else {
      flushChanges();
      if (previousKind === "deletion") appendRow(line, null);
      else if (previousKind === "addition") appendRow(null, line);
      else appendRow(line, line);
    }
    previousKind = line.kind;
  }
  flushChanges();
  return rows;
}

const loadedFileContext = ref<LoadedFileContext | null>(null);
const expandedContextGaps = ref<Map<string, ContextExpansion>>(new Map());
const contextLoading = ref(false);
const contextError = ref("");
let contextRequestSequence = 0;

const contextIdentity = computed(() =>
  [
    props.platform ?? "",
    props.owner ?? "",
    props.repo ?? "",
    selectedStandardPatch.value?.old_path ?? "",
    selectedStandardPatch.value?.new_path ?? "",
    props.baseSha ?? "",
    props.headSha ?? "",
  ].join("\0"),
);

function splitFileLines(content: string): string[] {
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function gapBeforeHunk(index: number): ControlledContextGap | null {
  const hunks = selectedStandardPatch.value?.hunks ?? [];
  const hunk = hunks[index];
  if (!hunk) return null;
  const previous = hunks[index - 1];
  const oldStart = Math.max(1, previous ? previous.old_start + previous.old_count : 1);
  const newStart = Math.max(1, previous ? previous.new_start + previous.new_count : 1);
  const oldEnd = Math.max(0, hunk.old_start - 1);
  const newEnd = Math.max(0, hunk.new_start - 1);
  if (oldEnd < oldStart && newEnd < newStart) return null;
  return {
    key: `${selectedStandardPatch.value?.filename ?? "file"}:gap:${index}`,
    oldStart,
    oldEnd,
    newStart,
    newEnd,
    direction: index === 0 ? "up" : "both",
  };
}

const trailingContextGap = computed<ControlledContextGap | null>(() => {
  const payload = loadedFileContext.value;
  const hunks = selectedStandardPatch.value?.hunks ?? [];
  const last = hunks.at(-1);
  if (!payload || payload.identity !== contextIdentity.value || !last) return null;
  const oldStart = Math.max(1, last.old_start + last.old_count);
  const newStart = Math.max(1, last.new_start + last.new_count);
  const oldEnd = payload.baseLines.length;
  const newEnd = payload.headLines.length;
  if (oldEnd < oldStart && newEnd < newStart) return null;
  return {
    key: `${selectedStandardPatch.value?.filename ?? "file"}:gap:trailing`,
    oldStart,
    oldEnd,
    newStart,
    newEnd,
    direction: "down",
  };
});

const controlledHunks = computed<ControlledDiffHunk[]>(() =>
  (selectedStandardPatch.value?.hunks ?? []).map((hunk, index) => {
    const key = `${selectedStandardPatch.value?.filename ?? "file"}:hunk:${index}`;
    return { key, hunk, rows: pairHunkLines(hunk.lines, key), gapBefore: gapBeforeHunk(index) };
  }),
);

const availableContextGaps = computed(() => [
  ...controlledHunks.value.flatMap((hunk) => (hunk.gapBefore ? [hunk.gapBefore] : [])),
  ...(trailingContextGap.value ? [trailingContextGap.value] : []),
]);
const hasExpandedContext = computed(() => expandedContextGaps.value.size > 0);
const canLoadContext = computed(
  () =>
    Boolean(props.platform && props.owner && props.repo) &&
    Boolean(
      (selectedStandardPatch.value?.old_path && props.baseSha) ||
      (selectedStandardPatch.value?.new_path && props.headSha),
    ),
);
const canExpandContext = computed(
  () =>
    selectedStandardPatch.value?.content_kind === "text" &&
    controlledHunks.value.length > 0 &&
    canLoadContext.value &&
    (loadedFileContext.value === null ||
      availableContextGaps.value.some((gap) => contextGapRowCount(gap) > 0)),
);

function contextGapActions(gap: ControlledContextGap): ContextGapAction[] {
  if (gap.direction === "up") return [{ edge: "end", arrow: "↑" }];
  if (gap.direction === "down") return [{ edge: "start", arrow: "↓" }];
  return [
    { edge: "end", arrow: "↑" },
    { edge: "start", arrow: "↓" },
  ];
}

function contextGapLabel(gap: ControlledContextGap, edge: ContextGapAction["edge"]): string {
  if (gap.direction === "both") {
    return `向${edge === "start" ? "下" : "上"}展开未变更上下文（20 行）`;
  }
  return `展开${edge === "start" ? "下方" : "上方"}未变更上下文（20 行）`;
}

function contextGapRowCount(gap: ControlledContextGap): number {
  const oldCount = Math.max(0, gap.oldEnd - gap.oldStart + 1);
  const newCount = Math.max(0, gap.newEnd - gap.newStart + 1);
  return Math.max(oldCount, newCount);
}

function isContextGapExpanded(gap: ControlledContextGap): boolean {
  const expansion = expandedContextGaps.value.get(gap.key);
  return Boolean(expansion && expansion.fromStart + expansion.fromEnd >= contextGapRowCount(gap));
}

function contextRows(gap: ControlledContextGap): ControlledDiffRow[] {
  const payload = loadedFileContext.value;
  if (!payload || payload.identity !== contextIdentity.value) return [];
  const oldCount = Math.max(0, gap.oldEnd - gap.oldStart + 1);
  const newCount = Math.max(0, gap.newEnd - gap.newStart + 1);
  const rowCount = Math.max(oldCount, newCount);
  return Array.from({ length: rowCount }, (_, index) => {
    const oldLine = index < oldCount ? gap.oldStart + index : null;
    const newLine = index < newCount ? gap.newStart + index : null;
    return {
      key: `${gap.key}:context:${index}`,
      left:
        oldLine === null
          ? null
          : {
              kind: "context",
              content: payload.baseLines[oldLine - 1] ?? "",
              old_line: oldLine,
              new_line: newLine,
            },
      right:
        newLine === null
          ? null
          : {
              kind: "context",
              content: payload.headLines[newLine - 1] ?? "",
              old_line: oldLine,
              new_line: newLine,
            },
    };
  });
}

function contextRowsFromStart(gap: ControlledContextGap): ControlledDiffRow[] {
  const rows = contextRows(gap);
  const expansion = expandedContextGaps.value.get(gap.key);
  if (!expansion) return [];
  return rows.slice(0, Math.min(expansion.fromStart, rows.length - expansion.fromEnd));
}

function contextRowsFromEnd(gap: ControlledContextGap): ControlledDiffRow[] {
  const rows = contextRows(gap);
  const expansion = expandedContextGaps.value.get(gap.key);
  if (!expansion) return [];
  const start = Math.max(expansion.fromStart, rows.length - expansion.fromEnd);
  return rows.slice(start);
}

async function loadSelectedFileContext(): Promise<boolean> {
  const patch = selectedStandardPatch.value;
  const identity = contextIdentity.value;
  if (loadedFileContext.value?.identity === identity) return true;
  if (!patch || !props.platform || !props.owner || !props.repo || !canLoadContext.value) {
    contextError.value = "缺少该 PR 的 base/head revision，无法展开上下文";
    return false;
  }

  const requestSequence = ++contextRequestSequence;
  contextLoading.value = true;
  contextError.value = "";
  try {
    const [base, head] = await Promise.all([
      patch.old_path && props.baseSha
        ? prFileContent(props.platform, props.owner, props.repo, patch.old_path, props.baseSha)
        : Promise.resolve(null),
      patch.new_path && props.headSha
        ? prFileContent(props.platform, props.owner, props.repo, patch.new_path, props.headSha)
        : Promise.resolve(null),
    ]);
    if (requestSequence !== contextRequestSequence || identity !== contextIdentity.value)
      return false;
    if (base?.truncated || head?.truncated) {
      contextError.value = "文件过大，无法展开完整上下文";
      return false;
    }
    if (base?.binary || head?.binary) {
      contextError.value = "二进制文件不支持展开文本上下文";
      return false;
    }
    loadedFileContext.value = {
      identity,
      baseLines: base ? splitFileLines(base.content) : [],
      headLines: head ? splitFileLines(head.content) : [],
    };
    return true;
  } catch (error) {
    if (requestSequence === contextRequestSequence && identity === contextIdentity.value) {
      contextError.value = error instanceof Error ? error.message : String(error);
    }
    return false;
  } finally {
    if (requestSequence === contextRequestSequence) contextLoading.value = false;
  }
}

async function expandContextGap(
  gap: ControlledContextGap,
  edge: ContextGapAction["edge"],
): Promise<void> {
  if (isContextGapExpanded(gap)) return;
  if (!(await loadSelectedFileContext())) return;
  const rowCount = contextGapRowCount(gap);
  const current = expandedContextGaps.value.get(gap.key) ?? { fromStart: 0, fromEnd: 0 };
  const remaining = Math.max(0, rowCount - current.fromStart - current.fromEnd);
  const amount = Math.min(CONTEXT_EXPANSION_STEP, remaining);
  const next = { ...current };
  if (edge === "start") next.fromStart += amount;
  else next.fromEnd += amount;
  expandedContextGaps.value = new Map(expandedContextGaps.value).set(gap.key, next);
}

async function expandAllContext(): Promise<void> {
  if (!(await loadSelectedFileContext())) return;
  expandedContextGaps.value = new Map(
    availableContextGaps.value.map((gap) => [
      gap.key,
      { fromStart: contextGapRowCount(gap), fromEnd: 0 },
    ]),
  );
}

function collapseAllContext(): void {
  expandedContextGaps.value = new Map();
}

const hasControlledPatch = computed(() => selectedStandardPatch.value !== null);
const totalAdditions = computed(() =>
  (props.diff?.files ?? []).reduce((total, file) => total + file.additions, 0),
);
const totalDeletions = computed(() =>
  (props.diff?.files ?? []).reduce((total, file) => total + file.deletions, 0),
);
const fileSignature = computed(() =>
  (props.diff?.files ?? []).map((file) => file.filename).join("\0"),
);

const renderedDiff = computed(() => props.diff?.diff ?? "");

const MAX_INLINE_HIGHLIGHT_RATIO = 0.8;
const LOW_SIMILARITY_HIGHLIGHT_CLASS = "d2h-low-similarity-highlight";

function textLength(value: string | null): number {
  return Array.from(value ?? "").length;
}

function normalizeInlineHighlights(renderedHtml: string): string {
  const document = new DOMParser().parseFromString(renderedHtml, "text/html");

  document.querySelectorAll<HTMLElement>(".d2h-code-line-ctn").forEach((line) => {
    const highlights = Array.from(line.querySelectorAll<HTMLElement>("ins, del"));
    const totalLength = textLength(line.textContent);
    if (highlights.length === 0 || totalLength === 0) return;

    const highlightedLength = highlights.reduce(
      (length, highlight) => length + textLength(highlight.textContent),
      0,
    );
    if (highlightedLength / totalLength < MAX_INLINE_HIGHLIGHT_RATIO) return;

    // diff2html 会把低相似度替换行的大部分内容标成词级变化。GitHub 对这种行只保留
    // 整行浅色背景，避免整段代码被误显示为深红或深绿。
    highlights.forEach((highlight) => highlight.classList.add(LOW_SIMILARITY_HIGHLIGHT_CLASS));
  });

  return document.body.innerHTML;
}

const diffHtml = computed(() => {
  if (!renderedDiff.value) return "";
  const options = {
    drawFileList: false,
    matching: "lines" as const,
    outputFormat: "side-by-side" as const,
    renderNothingWhenEmpty: false,
  };
  try {
    return normalizeInlineHighlights(html(renderedDiff.value, options));
  } catch {
    // 后端 patch 解析失败时始终回退到平台原始 diff，不能用空字符串覆盖视图。
    if (props.diff?.diff && renderedDiff.value !== props.diff.diff) {
      try {
        return normalizeInlineHighlights(html(props.diff.diff, options));
      } catch {
        return "";
      }
    }
    return "";
  }
});

const hasDiffContent = computed(() => hasControlledPatch.value || Boolean(diffHtml.value));
const canSearchCurrentFile = computed(() => {
  if (!selectedFile.value || isShowingImagePreview.value) return false;
  if (selectedStandardPatch.value) {
    return selectedStandardPatch.value.content_kind === "text" && controlledHunks.value.length > 0;
  }
  return Boolean(diffHtml.value);
});

function toggleDirectory(key: string) {
  const next = new Set(expandedDirectories.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedDirectories.value = next;
}

function activateTreeRow(row: FileTreeRow) {
  if (row.kind === "directory") {
    toggleDirectory(row.key);
  } else if (row.file) {
    void selectFile(row.file.filename);
  }
}

const MIN_NAVIGATOR_WIDTH = 180;
const MAX_NAVIGATOR_WIDTH = 520;
const MIN_DIFF_WIDTH = 320;

function clampNavigatorWidth(width: number): number {
  const workspaceWidth = workspaceRef.value?.clientWidth ?? window.innerWidth;
  const availableWidth = Math.max(MIN_NAVIGATOR_WIDTH, workspaceWidth - MIN_DIFF_WIDTH);
  return Math.round(
    Math.min(Math.max(width, MIN_NAVIGATOR_WIDTH), MAX_NAVIGATOR_WIDTH, availableWidth),
  );
}

function handleNavigatorResize(event: PointerEvent): void {
  if (!resizingNavigator.value || !workspaceRef.value) return;
  const workspaceLeft = workspaceRef.value.getBoundingClientRect().left;
  navigatorWidth.value = clampNavigatorWidth(event.clientX - workspaceLeft);
}

let stopNavigatorResizeDocumentState: (() => void) | null = null;

function stopNavigatorResize(): void {
  if (!resizingNavigator.value) return;
  resizingNavigator.value = false;
  document.removeEventListener("pointermove", handleNavigatorResize);
  document.removeEventListener("pointerup", stopNavigatorResize);
  document.removeEventListener("pointercancel", stopNavigatorResize);
  stopNavigatorResizeDocumentState?.();
  stopNavigatorResizeDocumentState = null;
}

function startNavigatorResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  resizingNavigator.value = true;
  stopNavigatorResizeDocumentState = useDocumentStateClass("mb-navigator-resizing");
  document.addEventListener("pointermove", handleNavigatorResize);
  document.addEventListener("pointerup", stopNavigatorResize);
  document.addEventListener("pointercancel", stopNavigatorResize);
}

function resizeNavigatorWithKeyboard(event: KeyboardEvent): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  navigatorWidth.value = clampNavigatorWidth(
    navigatorWidth.value + (event.key === "ArrowLeft" ? -16 : 16),
  );
}

async function selectFile(path: string) {
  if (selectedFilePath.value === path) {
    if (isShowingImagePreview.value && !imagePreviewLoading.value) void loadImagePreview();
    return;
  }
  selectedFilePath.value = path;
  await nextTick();
  if (diffScrollRef.value) diffScrollRef.value.scrollTop = 0;
  setSideDiffScrollLeft(0);
  if (topScrollbarRef.value) topScrollbarRef.value.scrollLeft = 0;
}

function isFileViewed(path: string): boolean {
  return viewedFilePaths.value.has(path);
}

async function toggleSelectedFileViewed(): Promise<void> {
  const context = reviewProgressContext.value;
  const path = selectedFile.value?.filename;
  if (!context || !path || viewedFilesLoading.value || syncingViewedFiles.value.has(path)) return;
  const viewed = !isFileViewed(path);
  reviewProgress.setFileViewed(context, path, viewed);
  if (!props.canSyncViewedFiles) return;

  viewedFilesError.value = "";
  syncingViewedFiles.value = new Set(syncingViewedFiles.value).add(path);
  const capturedProgressIdentity = reviewProgressIdentity(context);
  try {
    await reviewFileSetViewed(
      context.platform,
      context.owner,
      context.repo,
      context.prNumber,
      path,
      viewed,
    );
  } catch (error) {
    reviewProgress.setFileViewed(context, path, !viewed);
    if (
      reviewProgressContext.value &&
      reviewProgressIdentity(reviewProgressContext.value) === capturedProgressIdentity
    ) {
      viewedFilesError.value = getErrorMessage(error, "无法同步文件已查看状态");
    }
  } finally {
    const next = new Set(syncingViewedFiles.value);
    next.delete(path);
    syncingViewedFiles.value = next;
  }
}

function navigateUnviewed(direction: -1 | 1): void {
  const files = props.diff?.files ?? [];
  if (files.length === 0 || unviewedFileCount.value === 0) return;
  const currentIndex = Math.max(
    0,
    files.findIndex((file) => file.filename === selectedFilePath.value),
  );
  for (let offset = 1; offset <= files.length; offset++) {
    const index = (currentIndex + direction * offset + files.length) % files.length;
    const candidate = files[index];
    if (!isFileViewed(candidate.filename)) {
      void selectFile(candidate.filename);
      expandDirectoriesForFile(candidate.filename);
      void nextTick(() => scrollSelectedTreeRowIntoView(candidate.filename));
      return;
    }
  }
}

function syncRenderedFile() {
  const wrappers = containerRef.value?.querySelectorAll<HTMLElement>(".d2h-file-wrapper");
  if (!wrappers?.length) return;

  const diffPaths = Array.from(
    props.diff?.diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm) ?? [],
    (match) => match[2],
  );
  wrappers.forEach((wrapper, index) => {
    const path = diffPaths[index] || props.diff?.files[index]?.filename || "";
    wrapper.dataset.filePath = path;
    wrapper.hidden = Boolean(selectedFilePath.value && path !== selectedFilePath.value);
  });
}

let diffResizeObserver: ResizeObserver | null = null;

const SIDE_DIFF_SELECTOR = ".d2h-file-side-diff, .controlled-file-side-diff";

function visibleSideDiffScrollers(): HTMLElement[] {
  return Array.from(
    containerRef.value?.querySelectorAll<HTMLElement>(SIDE_DIFF_SELECTOR) ?? [],
  ).filter((scroller) => !scroller.closest<HTMLElement>(".d2h-file-wrapper")?.hidden);
}

function updateLineNumberGutterOffset(_scroller: HTMLElement): void {
  // Sticky line-number gutters track their own scroll container in CSS; no inline CSS variable is needed.
}

function setSideDiffScrollerScrollLeft(scroller: HTMLElement, scrollLeft: number): void {
  if (scroller.scrollLeft !== scrollLeft) scroller.scrollLeft = scrollLeft;
  updateLineNumberGutterOffset(scroller);
}

function setSideDiffScrollLeft(scrollLeft: number, source?: HTMLElement): void {
  for (const scroller of visibleSideDiffScrollers()) {
    if (scroller !== source) setSideDiffScrollerScrollLeft(scroller, scrollLeft);
  }
}

function bindSideDiffScrollers(): void {
  for (const scroller of visibleSideDiffScrollers()) {
    updateLineNumberGutterOffset(scroller);
    scroller.addEventListener("scroll", handleSideDiffScroll);
  }
}

function updateTopScrollbar(): void {
  const sideScrollers = visibleSideDiffScrollers();
  if (isDiffSyncScrollEnabled.value) {
    const topScroller = topScrollbarRef.value;
    if (!topScroller) return;
    const maxScrollRange = sideScrollers.reduce(
      (maximum, scroller) => Math.max(maximum, scroller.scrollWidth - scroller.clientWidth),
      0,
    );
    topScrollbarContentWidth.value = topScroller.clientWidth + maxScrollRange;
    const sideScrollLeft = sideScrollers[0]?.scrollLeft ?? 0;
    if (topScroller.scrollLeft !== sideScrollLeft) topScroller.scrollLeft = sideScrollLeft;
    return;
  }

  const topScrollers = [leftTopScrollbarRef.value, rightTopScrollbarRef.value];
  independentTopScrollbarWidths.value = topScrollers.map((topScroller, index) => {
    if (!topScroller) return 0;
    const sideScroller = sideScrollers[index];
    const scrollRange = sideScroller
      ? Math.max(0, sideScroller.scrollWidth - sideScroller.clientWidth)
      : 0;
    if (sideScroller && topScroller.scrollLeft !== sideScroller.scrollLeft) {
      topScroller.scrollLeft = sideScroller.scrollLeft;
    }
    return topScroller.clientWidth + scrollRange;
  }) as [number, number];
}

function handleTopScrollbarScroll(): void {
  const topScroller = topScrollbarRef.value;
  if (!topScroller) return;
  setSideDiffScrollLeft(topScroller.scrollLeft);
}

function handleIndependentTopScrollbarScroll(sideIndex: number): void {
  const topScroller = sideIndex === 0 ? leftTopScrollbarRef.value : rightTopScrollbarRef.value;
  const sideScroller = visibleSideDiffScrollers()[sideIndex];
  if (!topScroller || !sideScroller || sideScroller.scrollLeft === topScroller.scrollLeft) return;
  setSideDiffScrollerScrollLeft(sideScroller, topScroller.scrollLeft);
}

function handleSideDiffScroll(event: Event): void {
  const source = event.target;
  if (!(source instanceof HTMLElement) || !source.matches(SIDE_DIFF_SELECTOR)) return;
  updateLineNumberGutterOffset(source);
  if (isDiffSyncScrollEnabled.value) {
    setSideDiffScrollLeft(source.scrollLeft, source);
    if (topScrollbarRef.value && topScrollbarRef.value.scrollLeft !== source.scrollLeft) {
      topScrollbarRef.value.scrollLeft = source.scrollLeft;
    }
    return;
  }

  const sideIndex = visibleSideDiffScrollers().indexOf(source);
  const topScroller =
    sideIndex === 0
      ? leftTopScrollbarRef.value
      : sideIndex === 1
        ? rightTopScrollbarRef.value
        : null;
  if (topScroller && topScroller.scrollLeft !== source.scrollLeft) {
    topScroller.scrollLeft = source.scrollLeft;
  }
}

function handleDiffWheel(event: WheelEvent): void {
  const delta = event.shiftKey ? event.deltaY : event.deltaX;
  const isHorizontalGesture = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);
  if (!isHorizontalGesture || delta === 0) return;

  const sideScrollers = visibleSideDiffScrollers();
  const eventTarget = event.target instanceof Element ? event.target : null;
  const source = eventTarget?.closest<HTMLElement>(SIDE_DIFF_SELECTOR) ?? null;
  const sideIndex = source ? sideScrollers.indexOf(source) : -1;
  const topScroller = isDiffSyncScrollEnabled.value
    ? topScrollbarRef.value
    : sideIndex === 0
      ? leftTopScrollbarRef.value
      : sideIndex === 1
        ? rightTopScrollbarRef.value
        : null;
  if (!topScroller) return;

  event.preventDefault();
  topScroller.scrollLeft += delta;
  if (isDiffSyncScrollEnabled.value) handleTopScrollbarScroll();
  else handleIndependentTopScrollbarScroll(sideIndex);
}

function observeDiffSize(): void {
  diffResizeObserver?.disconnect();
  if (typeof ResizeObserver === "undefined") return;
  diffResizeObserver = new ResizeObserver(updateTopScrollbar);
  if (diffScrollRef.value) diffResizeObserver.observe(diffScrollRef.value);
  if (containerRef.value) diffResizeObserver.observe(containerRef.value);
  for (const scroller of visibleSideDiffScrollers()) diffResizeObserver.observe(scroller);
}

watch(isDiffSyncScrollEnabled, async (enabled) => {
  await nextTick();
  if (enabled) {
    const currentScrollLeft = visibleSideDiffScrollers()[0]?.scrollLeft ?? 0;
    setSideDiffScrollLeft(currentScrollLeft);
  }
  updateTopScrollbar();
  observeDiffSize();
});

watch(
  fileSignature,
  () => {
    const files = props.diff?.files ?? [];
    selectedFilePath.value = firstFilePath(fileTree.value);
    expandedDirectories.value = collectDirectoryKeys(fileTree.value);
  },
  { immediate: true },
);

watch(
  [reviewProgressContext, fileSignature, () => props.canSyncViewedFiles],
  async ([context]) => {
    const requestSequence = ++viewedFilesRequestSequence;
    viewedFilesError.value = "";
    viewedFilesLoadedRemotely.value = false;
    viewedFilesLoading.value = false;
    if (!context) return;

    const validPaths = props.diff?.files.map((file) => file.filename) ?? [];
    reviewProgress.pruneFiles(context, validPaths);
    if (!props.canSyncViewedFiles) return;

    viewedFilesLoading.value = true;
    try {
      const viewedFiles = await reviewViewedFilesList(
        context.platform,
        context.owner,
        context.repo,
        context.prNumber,
      );
      if (requestSequence !== viewedFilesRequestSequence) return;
      const validPathSet = new Set(validPaths);
      reviewProgress.replaceViewedFiles(
        context,
        viewedFiles.filter((path) => validPathSet.has(path)),
      );
      viewedFilesLoadedRemotely.value = true;
    } catch (error) {
      if (requestSequence === viewedFilesRequestSequence) {
        viewedFilesError.value = getErrorMessage(error, "无法加载文件已查看状态");
      }
    } finally {
      if (requestSequence === viewedFilesRequestSequence) viewedFilesLoading.value = false;
    }
  },
  { immediate: true },
);

watch(
  [unviewedFileCount, () => props.readOnly],
  ([count, readOnly]) => {
    // 只读视图里的文件集合不代表整体评审范围，保留调用方基于整体 Diff 的计数。
    if (readOnly) return;
    emit("reviewProgress", count);
  },
  { immediate: true },
);

// 同一批文件再次加载（例如切换 PR 但文件名未变）时，也回到第一个文件。
watch(
  () => props.diff,
  (next, previous) => {
    if (next !== previous) selectedFilePath.value = firstFilePath(fileTree.value);
  },
);

watch(
  contextIdentity,
  () => {
    contextRequestSequence += 1;
    loadedFileContext.value = null;
    expandedContextGaps.value = new Map();
    contextLoading.value = false;
    contextError.value = "";
  },
  { immediate: true },
);

watch(
  [imagePreviewIdentity, isShowingImagePreview],
  async ([identity, showingPreview]) => {
    imagePreviewRequestSequence += 1;
    imagePreviewPanels.value = [];
    imagePreviewLoading.value = false;
    if (!showingPreview) return;
    await nextTick();
    if (identity === imagePreviewIdentity.value && isShowingImagePreview.value) {
      void loadImagePreview();
    }
  },
  { immediate: true, flush: "post" },
);

watch(
  [diffHtml, selectedFilePath, selectedStandardPatch],
  async () => {
    await nextTick();
    syncRenderedFile();
    bindSideDiffScrollers();
    updateTopScrollbar();
    observeDiffSize();
  },
  { immediate: true, flush: "post" },
);

watch(
  () => props.locationRequest,
  (request) => {
    if (request) void locateDiffRequest(request);
  },
  { immediate: true, flush: "post" },
);

const popupRef = ref<HTMLElement | null>(null);

const quickComment = ref<{
  x: number;
  y: number;
  path: string;
  startLine: number;
  endLine: number;
  side: "left" | "right";
  selectedText: string;
} | null>(null);
const { popupPositionClass, positionPopup } = useDiffPopupStyle({
  popupRef,
  quickComment,
});
const quickBody = ref("");
const quickSubmitting = ref(false);
const quickCategory = ref("logic");
const quickSubCategory = ref("");

const {
  registerSearchInput,
  codeSearchStates,
  isCodeSearchOpen,
  visibleCodeSearchSides,
  toggleCodeSearch,
  closeCodeSearch,
  closeCodeSearchSide,
  clearCodeSearchQuery,
  navigateCodeSearch,
  updateCodeSearchQuery,
  toggleCodeSearchOption,
  handleCodeSearchKeydown,
  setHoveredCodeSearchSide,
  clearHoveredCodeSearchSide,
  updateHoveredLegacyCodeSearchSide,
} = useDiffCodeSearch({
  containerRef,
  workspaceRef,
  diffScrollRef,
  selectedFile,
  selectedFilePath,
  diffHtml,
  selectedStandardPatch,
  expandedContextGaps,
  isShowingImagePreview,
  canSearchCurrentFile,
  isDiffSyncScrollEnabled,
  quickComment,
  setSideDiffScrollLeft,
  setSideDiffScrollerScrollLeft,
  updateTopScrollbar,
  scrollElementWithinContainer,
});

const categories: Record<string, string[]> = {
  logic: ["边界条件", "空值处理", "异常处理", "并发问题", "状态管理", "类型错误"],
  security: ["注入攻击", "权限控制", "敏感信息泄露", "加密问题", "输入校验", "CSRF/XSS"],
  performance: ["算法复杂度", "内存泄漏", "IO阻塞", "重复计算", "缓存优化", "数据库查询"],
  style: ["命名规范", "注释缺失", "代码冗余", "硬编码", "函数过长", "结构混乱"],
  log: ["日志级别不当", "敏感信息打印", "日志缺失", "异常信息不全", "日志格式", "日志过多"],
};
const categoryLabels: Record<string, string> = {
  logic: "逻辑类",
  security: "安全类",
  performance: "性能类",
  style: "代码风格类",
  log: "日志类",
};

const opinionTemplates: Record<string, string> = {
  边界条件: "请检查此处的边界条件是否处理完整，包括空值、越界、临界值等场景。",
  空值处理: "此处缺少空值判断，建议增加 null/undefined 保护。",
  异常处理: "建议完善异常处理逻辑，确保异常路径能被正确捕获和处理。",
  并发问题: "此处存在并发安全问题，建议考虑加锁或使用原子操作。",
  状态管理: "状态管理逻辑不够清晰，建议简化或拆分状态管理。",
  类型错误: "存在类型不匹配问题，建议使用更精确的类型定义。",
  注入攻击: "存在注入风险，建议使用参数化查询或对输入进行严格过滤。",
  权限控制: "缺少必要的权限校验，建议在此处增加权限检查。",
  敏感信息泄露: "可能泄露敏感信息，建议避免在输出中暴露内部细节。",
  加密问题: "加密方案不够安全，建议使用更安全的加密算法。",
  输入校验: "缺少输入校验，建议对用户输入进行合法性检查。",
  "CSRF/XSS": "存在跨站攻击风险，建议增加 CSRF Token 或 XSS 过滤。",
  算法复杂度: "算法复杂度过高，建议优化以提升性能。",
  内存泄漏: "可能存在内存泄漏风险，请检查资源释放路径。",
  IO阻塞: "IO 操作未异步处理，可能阻塞主线程，建议异步化。",
  重复计算: "存在重复计算，建议提取为变量或缓存结果。",
  缓存优化: "缓存策略可以进一步优化，减少不必要的缓存更新。",
  数据库查询: "数据库查询效率较低，建议添加索引或优化查询。",
  命名规范: "命名不够规范，建议遵循项目命名约定。",
  注释缺失: "此处逻辑较复杂，建议补充注释说明意图。",
  代码冗余: "代码存在冗余，建议抽取为公共方法复用。",
  硬编码: "存在硬编码值，建议抽取为常量或配置项。",
  函数过长: "函数过长，建议拆分为多个小函数。",
  结构混乱: "代码结构不够清晰，建议重新组织逻辑。",
  日志级别不当: "日志级别设置不当，建议根据场景调整。",
  敏感信息打印: "日志中可能包含敏感信息，建议脱敏处理。",
  日志缺失: "关键路径缺少日志，建议补充以方便排查。",
  异常信息不全: "异常信息不够详细，建议补充上下文。",
  日志格式: "日志格式不规范，建议统一格式。",
  日志过多: "日志输出过于频繁，可能影响性能。",
};

function getFileFromNode(node: Node): HTMLElement | null {
  let element: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (element) {
    if (
      element.classList.contains("controlled-file-wrapper") ||
      element.classList.contains("d2h-file-wrapper") ||
      element.classList.contains("d2h-wrapper")
    ) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function getControlledSelectionRange(
  range: Range,
  file: HTMLElement,
): { path: string; startLine: number; endLine: number; side: "left" | "right" } | null {
  const path = file.dataset.filePath ?? "";
  if (!path) return null;

  const selectedLines = Array.from(
    file.querySelectorAll<HTMLElement>(".controlled-line[data-line][data-side]"),
  ).filter((line) => range.intersectsNode(line));
  const selectedSides = new Set(selectedLines.map((line) => line.dataset.side));
  if (selectedLines.length === 0 || selectedSides.size !== 1) return null;

  const side = selectedLines[0].dataset.side;
  if (side !== "left" && side !== "right") return null;
  const lines = selectedLines
    .map((line) => Number.parseInt(line.dataset.line ?? "", 10))
    .filter((line) => Number.isFinite(line) && line > 0);
  if (lines.length === 0) return null;

  return {
    path,
    startLine: Math.min(...lines),
    endLine: Math.max(...lines),
    side,
  };
}

function getLegacySelectionRange(
  range: Range,
  file: HTMLElement,
): { path: string; startLine: number; endLine: number; side: "left" | "right" } | null {
  const fileNameElement =
    file.querySelector(".d2h-file-name") ||
    file.querySelector(".d2h-file-name-wrapper .d2h-file-name");
  const path = fileNameElement?.textContent?.trim() || "";
  if (!path) return null;

  const lines: number[] = [];
  let side: "left" | "right" | null = null;
  file.querySelectorAll("tr").forEach((row) => {
    if (!range.intersectsNode(row)) return;
    row.querySelectorAll(".d2h-code-side-linenumber, .d2h-code-linenumber").forEach((element) => {
      const line = Number.parseInt((element as HTMLElement).textContent || "0", 10);
      if (!line) return;
      lines.push(line);
      if (side) return;

      const scroller = (element as HTMLElement).closest<HTMLElement>(".d2h-file-side-diff");
      if (!scroller) return;
      const sideDiffs = scroller.parentElement?.querySelectorAll(".d2h-file-side-diff");
      side = sideDiffs && sideDiffs.length > 1 && sideDiffs[0] === scroller ? "left" : "right";
    });
  });

  if (lines.length === 0 || !side) return null;
  return { path, startLine: Math.min(...lines), endLine: Math.max(...lines), side };
}

function getSelectionRange(): {
  path: string;
  startLine: number;
  endLine: number;
  side: "left" | "right";
} | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return null;

  const range = selection.getRangeAt(0);
  const startFile = getFileFromNode(range.startContainer);
  const endFile = getFileFromNode(range.endContainer);
  if (!startFile || startFile !== endFile) return null;

  return startFile.classList.contains("controlled-file-wrapper")
    ? getControlledSelectionRange(range, startFile)
    : getLegacySelectionRange(range, startFile);
}

function handleContextMenu(event: MouseEvent) {
  if (props.readOnly) return;
  const target = event.target as HTMLElement;
  if (!containerRef.value?.contains(target)) return;

  event.preventDefault();
  event.stopPropagation();

  const selRange = getSelectionRange();
  if (!selRange) return;
  quickComment.value = {
    x: event.clientX,
    y: event.clientY,
    path: selRange.path,
    startLine: selRange.startLine,
    endLine: selRange.endLine,
    side: selRange.side,
    selectedText: window.getSelection()?.toString().trim() || "",
  };
  quickBody.value = "";
}

let contextMenuListenerAttached = false;

function syncContextMenuListener(readOnly = props.readOnly): void {
  if (readOnly) {
    if (contextMenuListenerAttached) {
      document.removeEventListener("contextmenu", handleContextMenu, true);
      contextMenuListenerAttached = false;
    }
    return;
  }
  if (!contextMenuListenerAttached) {
    document.addEventListener("contextmenu", handleContextMenu, true);
    contextMenuListenerAttached = true;
  }
}

function handleDocClick() {
  quickComment.value = null;
}

async function submitQuickComment() {
  if (!quickComment.value || !quickBody.value.trim()) return;
  let finalBody = quickBody.value.trim();
  if (!finalBody.startsWith("【")) {
    const main = categoryLabels[quickCategory.value] || quickCategory.value;
    const sub = quickSubCategory.value ? `-${quickSubCategory.value}` : "";
    finalBody = `【${main}${sub}】${finalBody}`;
  }
  emit(
    "addComment",
    quickComment.value.path,
    quickComment.value.startLine,
    quickComment.value.endLine,
    quickComment.value.side,
    finalBody,
  );
  quickSubmitting.value = true;
  await new Promise((r) => setTimeout(r, 200));
  quickComment.value = null;
  quickBody.value = "";
  quickSubmitting.value = false;
}

function onSubCategoryChange() {
  if (!quickSubCategory.value) {
    quickBody.value = "";
    return;
  }
  const tpl = opinionTemplates[quickSubCategory.value];
  if (tpl) {
    const main = categoryLabels[quickCategory.value] || quickCategory.value;
    quickBody.value = `【${main}-${quickSubCategory.value}】${tpl}`;
  }
}

function handleQuickKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitQuickComment();
  if (e.key === "Escape") quickComment.value = null;
}

watch(quickComment, async (val) => {
  if (val) {
    (document.querySelector(".quick-comment-textarea") as HTMLTextAreaElement)?.focus();
    await positionPopup();
  }
});

watch([quickCategory, quickSubCategory], async () => {
  if (quickComment.value) {
    await positionPopup();
  }
});

watch(
  () => props.readOnly,
  (readOnly) => syncContextMenuListener(readOnly),
);

onMounted(() => {
  updateTopScrollbar();
  observeDiffSize();
  bindSideDiffScrollers();
  syncContextMenuListener();
  document.addEventListener("click", handleDocClick);
});

onUnmounted(() => {
  imagePreviewRequestSequence += 1;
  stopNavigatorResize();
  diffResizeObserver?.disconnect();
  for (const scroller of visibleSideDiffScrollers()) {
    scroller.removeEventListener("scroll", handleSideDiffScroll);
  }
  if (contextMenuListenerAttached) {
    document.removeEventListener("contextmenu", handleContextMenu, true);
    contextMenuListenerAttached = false;
  }
  document.removeEventListener("click", handleDocClick);
  stopNavigatorResize();
});
</script>

<template>
  <div class="diff-viewer-wrapper">
    <!--
      变更范围等作用于整个 Diff 的控件插槽。
      放在 hasDiffContent 之外，调用方的控件在无 Diff、加载中和报错时同样可见可操作。
    -->
    <slot name="scope" />
    <section
      v-if="hasDiffContent"
      ref="workspaceRef"
      class="diff-workspace"
      :class="[
        workspaceClass,
        {
          'navigator-collapsed': !navigatorVisible,
          resizing: resizingNavigator,
        },
      ]"
      aria-label="代码差异浏览器"
    >
      <aside v-if="navigatorVisible" class="file-navigator" aria-label="变更文件">
        <header class="navigator-header">
          <div>
            <strong>文件</strong>
            <span>{{ diff?.files.length ?? 0 }}</span>
            <span
              v-if="reviewProgressContext"
              class="local-progress-label"
              :title="viewedProgressDescription"
            >
              {{ viewedProgressSource }} {{ viewedFileCount }}/{{ diff?.files.length ?? 0 }} 已查看
            </span>
          </div>
          <div class="change-summary" aria-label="变更统计">
            <span class="additions">+{{ totalAdditions }}</span>
            <span class="deletions">-{{ totalDeletions }}</span>
          </div>
        </header>

        <nav class="file-tree" role="tree" aria-label="变更文件目录树">
          <button
            v-for="row in visibleTreeRows"
            :key="row.key"
            class="tree-row"
            :class="[
              treeRowDepthClass(row.depth),
              {
                selected: row.file?.filename === selectedFilePath,
                viewed: row.file ? isFileViewed(row.file.filename) : false,
              },
            ]"
            type="button"
            role="treeitem"
            :aria-level="row.depth"
            :aria-expanded="row.kind === 'directory' ? expandedDirectories.has(row.key) : undefined"
            :aria-current="row.file?.filename === selectedFilePath ? 'true' : undefined"
            :aria-label="
              row.file
                ? `${statusDescriptions[row.file.status]}文件：${row.file.filename}，${isFileViewed(row.file.filename) ? `已查看，${viewedProgressSource}状态` : '未查看'}${threadSummary?.by_file[row.file.filename]?.unresolved ? `，${threadSummary.by_file[row.file.filename].unresolved} 个未解决线程` : ''}`
                : `目录：${row.name}`
            "
            :data-file-path="row.file?.filename"
            @click="activateTreeRow(row)"
          >
            <svg
              v-if="row.kind === 'directory'"
              class="disclosure-icon"
              :class="{ expanded: expandedDirectories.has(row.key) }"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <path d="m4 2.5 3.5 3.5L4 9.5" stroke="currentColor" stroke-width="1.4" />
            </svg>
            <span v-else class="disclosure-spacer" aria-hidden="true" />
            <svg
              v-if="row.kind === 'directory'"
              class="tree-icon directory-icon"
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M1.75 4.25h4l1.3 1.5h7.2v6.5a1.5 1.5 0 0 1-1.5 1.5h-10a1.5 1.5 0 0 1-1.5-1.5v-6.5c0-.83.67-1.5 1.5-1.5Z"
                stroke="currentColor"
                stroke-width="1.2"
              />
            </svg>
            <svg
              v-else
              class="tree-icon"
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path d="M4 1.75h5l3 3v9.5H4v-12.5Z" stroke="currentColor" stroke-width="1.2" />
              <path d="M9 1.75v3h3" stroke="currentColor" stroke-width="1.2" />
            </svg>
            <span
              class="tree-label"
              :title="
                row.file
                  ? `${statusDescriptions[row.file.status]}文件：${row.file.filename}`
                  : row.name
              "
            >
              {{ row.name }}
            </span>
            <template v-if="row.file">
              <span class="file-review-indicators" aria-hidden="true">
                <span
                  v-if="isFileViewed(row.file.filename)"
                  class="viewed-indicator"
                  :title="`已查看（${viewedProgressSource}状态）`"
                  >✓</span
                >
                <span
                  v-if="threadSummary?.by_file[row.file.filename]?.unresolved"
                  class="unresolved-indicator"
                  :title="`${threadSummary.by_file[row.file.filename].unresolved} 个未解决线程`"
                >
                  {{ threadSummary.by_file[row.file.filename].unresolved }}
                </span>
                <span
                  v-else-if="threadSummary?.by_file[row.file.filename]?.comments"
                  class="comment-indicator"
                  :title="`${threadSummary.by_file[row.file.filename].comments} 条人工评论`"
                >
                  {{ threadSummary.by_file[row.file.filename].comments }}
                </span>
              </span>
              <span class="file-change-count" aria-hidden="true">
                <span v-if="row.file.additions" class="additions">+{{ row.file.additions }}</span>
                <span v-if="row.file.deletions" class="deletions">-{{ row.file.deletions }}</span>
              </span>
            </template>
          </button>
        </nav>
        <div
          class="navigator-resizer"
          role="separator"
          aria-label="调整文件列表宽度"
          aria-orientation="vertical"
          :aria-valuemin="MIN_NAVIGATOR_WIDTH"
          :aria-valuemax="MAX_NAVIGATOR_WIDTH"
          :aria-valuenow="navigatorWidth"
          tabindex="0"
          @pointerdown="startNavigatorResize"
          @keydown="resizeNavigatorWithKeyboard"
        />
      </aside>

      <section class="diff-context" aria-label="文件差异上下文">
        <header class="diff-toolbar">
          <button
            class="navigator-toggle"
            type="button"
            :aria-pressed="navigatorVisible"
            :title="navigatorVisible ? '隐藏文件列表' : '显示文件列表'"
            @click="navigatorVisible = !navigatorVisible"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" stroke="currentColor" />
              <path d="M5.25 2.5v11" stroke="currentColor" />
            </svg>
          </button>
          <div class="selected-file-heading">
            <span class="selected-file-name" :title="selectedFile?.filename">
              {{ selectedFile?.filename ?? "全部变更" }}
            </span>
            <span v-if="selectedFile" class="selected-file-status">
              {{ statusDescriptions[selectedFile.status] }}
            </span>
          </div>
          <div v-if="selectedFile" class="selected-file-stats" aria-label="当前文件变更统计">
            <span class="additions">+{{ selectedFile.additions }}</span>
            <span class="deletions">-{{ selectedFile.deletions }}</span>
          </div>
          <button
            class="navigator-toggle code-search-toggle"
            type="button"
            :aria-pressed="isCodeSearchOpen"
            :disabled="!canSearchCurrentFile"
            :title="canSearchCurrentFile ? '查找代码' : '当前文件没有可查找的代码'"
            aria-label="查找代码"
            aria-keyshortcuts="Meta+F Control+F"
            @click="toggleCodeSearch"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.75" cy="6.75" r="4.25" stroke="currentColor" stroke-width="1.4" />
              <path d="m10 10 3.5 3.5" stroke="currentColor" stroke-width="1.4" />
            </svg>
          </button>
          <div v-if="canPreviewImage" class="image-view-toggle" aria-label="图片显示方式">
            <button
              type="button"
              :aria-pressed="imageViewMode === 'source'"
              @click="setImageViewMode('source')"
            >
              代码
            </button>
            <button
              type="button"
              :aria-pressed="imageViewMode === 'preview'"
              @click="setImageViewMode('preview')"
            >
              预览
            </button>
          </div>
          <div v-if="reviewProgressContext && selectedFile" class="review-progress-actions">
            <span class="unviewed-summary">剩余 {{ unviewedFileCount }} 个未查看</span>
            <span
              v-if="viewedFilesError"
              class="review-progress-error"
              role="alert"
              :title="viewedFilesError"
            >
              远端同步失败：{{ viewedFilesError }}
            </span>
            <button
              type="button"
              class="review-progress-button progress-nav-button"
              :disabled="unviewedFileCount === 0"
              title="上一个未查看文件"
              aria-label="上一个未查看文件"
              @click="navigateUnviewed(-1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="review-progress-button progress-nav-button"
              :disabled="unviewedFileCount === 0"
              title="下一个未查看文件"
              aria-label="下一个未查看文件"
              @click="navigateUnviewed(1)"
            >
              ↓
            </button>
            <button
              type="button"
              class="review-progress-button viewed-toggle-button"
              :class="{ viewed: isFileViewed(selectedFile.filename) }"
              :aria-pressed="isFileViewed(selectedFile.filename)"
              :disabled="viewedFilesLoading || syncingViewedFiles.has(selectedFile.filename)"
              :title="viewedProgressDescription"
              @click="toggleSelectedFileViewed"
            >
              {{
                viewedFilesLoading || syncingViewedFiles.has(selectedFile.filename)
                  ? "同步中..."
                  : isFileViewed(selectedFile.filename)
                    ? "标记为未查看"
                    : "标记为已查看"
              }}
            </button>
          </div>
          <div
            v-if="hasControlledPatch && canExpandContext && !isShowingImagePreview"
            class="context-toolbar-actions"
          >
            <button
              v-if="hasExpandedContext"
              class="context-toolbar-button"
              type="button"
              :disabled="contextLoading"
              @click="collapseAllContext"
            >
              收起全部上下文
            </button>
            <button
              v-else
              class="context-toolbar-button"
              type="button"
              :disabled="contextLoading"
              @click="expandAllContext"
            >
              {{ contextLoading ? "加载上下文中..." : "展开全部上下文" }}
            </button>
          </div>
        </header>

        <CodeSearchBar
          v-if="isCodeSearchOpen"
          :visible-sides="visibleCodeSearchSides"
          :states="codeSearchStates"
          :register-input="registerSearchInput"
          @keydown="handleCodeSearchKeydown"
          @clear-query="clearCodeSearchQuery"
          @navigate="navigateCodeSearch"
          @close-side="closeCodeSearchSide"
          @update-query="updateCodeSearchQuery"
          @toggle-option="toggleCodeSearchOption"
        />

        <div
          v-if="!isShowingImagePreview"
          class="diff-top-scrollbars"
          :class="{ independent: !isDiffSyncScrollEnabled }"
        >
          <div
            v-if="isDiffSyncScrollEnabled"
            ref="topScrollbarRef"
            class="diff-top-scrollbar"
            role="region"
            aria-label="同步代码差异横向滚动条"
            tabindex="0"
            @scroll="handleTopScrollbarScroll"
          >
            <div
              class="diff-top-scrollbar-content"
              :class="unifiedScrollbarContentClass"
              aria-hidden="true"
            />
          </div>
          <template v-else>
            <div
              ref="leftTopScrollbarRef"
              class="diff-top-scrollbar"
              role="region"
              aria-label="左侧代码差异横向滚动条"
              tabindex="0"
              @scroll="handleIndependentTopScrollbarScroll(0)"
            >
              <div
                class="diff-top-scrollbar-content"
                :class="leftScrollbarContentClass"
                aria-hidden="true"
              />
            </div>
            <div
              ref="rightTopScrollbarRef"
              class="diff-top-scrollbar"
              role="region"
              aria-label="右侧代码差异横向滚动条"
              tabindex="0"
              @scroll="handleIndependentTopScrollbarScroll(1)"
            >
              <div
                class="diff-top-scrollbar-content"
                :class="rightScrollbarContentClass"
                aria-hidden="true"
              />
            </div>
          </template>
        </div>
        <div
          ref="diffScrollRef"
          class="diff-scroll-region"
          :class="{ 'image-preview-active': isShowingImagePreview }"
          @wheel="handleDiffWheel"
        >
          <div ref="containerRef" class="diff2html-container">
            <article
              v-if="selectedStandardPatch"
              class="controlled-file-wrapper"
              :data-file-path="selectedStandardPatch.filename"
            >
              <header class="controlled-file-header">
                <span class="controlled-file-paths">
                  {{ selectedStandardPatch.old_path ?? "/dev/null" }}
                  <span aria-hidden="true">→</span>
                  {{ selectedStandardPatch.new_path ?? "/dev/null" }}
                </span>
                <span class="controlled-file-summary">
                  <span class="additions">+{{ selectedStandardPatch.additions }}</span>
                  <span class="deletions">-{{ selectedStandardPatch.deletions }}</span>
                </span>
              </header>
              <p
                v-if="contextError && !isShowingImagePreview"
                class="context-load-error"
                role="alert"
              >
                {{ contextError }}
              </p>

              <div
                v-if="isShowingImagePreview"
                class="image-preview-grid"
                :class="{ 'single-panel': imagePreviewPanels.length === 1 }"
                aria-live="polite"
              >
                <div
                  v-if="!imagePreviewLoading && imagePreviewPanels.length === 0"
                  class="image-preview-error image-preview-empty"
                  role="alert"
                >
                  <span>图片预览未加载</span>
                  <button type="button" @click="loadImagePreview">重新加载预览</button>
                </div>
                <section
                  v-for="panel in imagePreviewPanels"
                  :key="imagePreviewPanelKey(panel)"
                  class="image-preview-panel"
                  :aria-label="`${panel.label}图片预览`"
                >
                  <header class="image-preview-header">
                    <strong>{{ panel.label }}</strong>
                    <span :title="panel.path">{{ panel.path }}</span>
                  </header>
                  <div class="image-preview-stage">
                    <span v-if="imagePreviewLoading" class="image-preview-status"
                      >加载预览中...</span
                    >
                    <div v-else-if="panel.error" class="image-preview-error" role="alert">
                      <span>{{ panel.error }}</span>
                      <button type="button" @click="loadImagePreview">重新加载预览</button>
                    </div>
                    <img
                      v-else-if="panel.src"
                      class="image-preview-image"
                      :src="panel.src"
                      :alt="`${panel.label}图片预览：${panel.path}`"
                      @error="handleImagePreviewError(panel)"
                    />
                  </div>
                </section>
              </div>

              <div
                v-else-if="
                  selectedStandardPatch.content_kind === 'text' && controlledHunks.length > 0
                "
                class="controlled-side-by-side"
              >
                <div
                  v-for="side in controlledSides"
                  :key="side"
                  class="controlled-file-side-diff"
                  :class="`controlled-side-${side}`"
                  :aria-label="side === 'left' ? '变更前代码' : '变更后代码'"
                  @pointerenter="setHoveredCodeSearchSide(side)"
                  @pointerleave="clearHoveredCodeSearchSide"
                >
                  <div class="controlled-side-content">
                    <template
                      v-for="controlledHunk in controlledHunks"
                      :key="`${controlledHunk.key}:${side}`"
                    >
                      <template v-if="controlledHunk.gapBefore">
                        <div
                          v-for="row in contextRowsFromStart(controlledHunk.gapBefore)"
                          :key="`${row.key}:${side}`"
                          class="controlled-line controlled-context-line"
                          :class="{
                            'diff-location-highlight': isHighlightedLine(
                              side,
                              side === 'left' ? row.left?.old_line : row.right?.new_line,
                            ),
                          }"
                          :data-side="side"
                          :data-line="side === 'left' ? row.left?.old_line : row.right?.new_line"
                        >
                          <span class="controlled-line-number" aria-hidden="true">
                            {{ side === "left" ? row.left?.old_line : row.right?.new_line }}
                          </span>
                          <span class="controlled-line-marker" aria-hidden="true"> </span>
                          <code class="controlled-code">{{
                            (side === "left" ? row.left : row.right)?.content ?? ""
                          }}</code>
                        </div>
                      </template>
                      <section class="controlled-hunk">
                        <div
                          class="controlled-hunk-header"
                          :aria-label="side === 'left' ? controlledHunk.hunk.header : undefined"
                          :aria-hidden="side === 'right' ? 'true' : undefined"
                        >
                          <template
                            v-if="
                              controlledHunk.gapBefore &&
                              !isContextGapExpanded(controlledHunk.gapBefore)
                            "
                          >
                            <div
                              v-if="side === 'left'"
                              class="context-gap-controls"
                              :class="{
                                'context-gap-controls-both':
                                  contextGapActions(controlledHunk.gapBefore).length > 1,
                              }"
                            >
                              <button
                                v-for="action in contextGapActions(controlledHunk.gapBefore)"
                                :key="action.edge"
                                class="context-gap-button"
                                type="button"
                                :disabled="contextLoading"
                                :aria-label="contextGapLabel(controlledHunk.gapBefore, action.edge)"
                                @click="expandContextGap(controlledHunk.gapBefore, action.edge)"
                              >
                                <span aria-hidden="true">{{ action.arrow }}</span>
                              </button>
                            </div>
                            <span
                              v-else
                              class="context-gap-placeholder"
                              :class="{
                                'context-gap-placeholder-both':
                                  contextGapActions(controlledHunk.gapBefore).length > 1,
                              }"
                              aria-hidden="true"
                            />
                          </template>
                          <span v-else class="controlled-hunk-gutter" aria-hidden="true" />
                          <span v-if="side === 'left'" class="controlled-hunk-header-text">
                            {{ controlledHunk.hunk.header }}
                          </span>
                        </div>
                        <template v-if="controlledHunk.gapBefore">
                          <div
                            v-for="row in contextRowsFromEnd(controlledHunk.gapBefore)"
                            :key="`${row.key}:${side}`"
                            class="controlled-line controlled-context-line"
                            :class="{
                              'diff-location-highlight': isHighlightedLine(
                                side,
                                side === 'left' ? row.left?.old_line : row.right?.new_line,
                              ),
                            }"
                            :data-side="side"
                            :data-line="side === 'left' ? row.left?.old_line : row.right?.new_line"
                          >
                            <span class="controlled-line-number" aria-hidden="true">
                              {{ side === "left" ? row.left?.old_line : row.right?.new_line }}
                            </span>
                            <span class="controlled-line-marker" aria-hidden="true"> </span>
                            <code class="controlled-code">{{
                              (side === "left" ? row.left : row.right)?.content ?? ""
                            }}</code>
                          </div>
                        </template>
                        <div
                          v-for="row in controlledHunk.rows"
                          :key="`${row.key}:${side}`"
                          class="controlled-line"
                          :class="[
                            `controlled-line-${(side === 'left' ? row.left : row.right)?.kind ?? 'empty'}`,
                            {
                              'diff-location-highlight': isHighlightedLine(
                                side,
                                side === 'left' ? row.left?.old_line : row.right?.new_line,
                              ),
                            },
                          ]"
                          :data-side="
                            (side === 'left' ? row.left?.old_line : row.right?.new_line)
                              ? side
                              : undefined
                          "
                          :data-line="side === 'left' ? row.left?.old_line : row.right?.new_line"
                        >
                          <span class="controlled-line-number" aria-hidden="true">
                            {{ side === "left" ? row.left?.old_line : row.right?.new_line }}
                          </span>
                          <span class="controlled-line-marker" aria-hidden="true">
                            {{
                              (side === "left" ? row.left : row.right)?.kind === "addition"
                                ? "+"
                                : (side === "left" ? row.left : row.right)?.kind === "deletion"
                                  ? "−"
                                  : " "
                            }}
                          </span>
                          <code class="controlled-code">{{
                            (side === "left" ? row.left : row.right)?.content ?? ""
                          }}</code>
                        </div>
                      </section>
                    </template>
                    <template v-if="trailingContextGap">
                      <div
                        v-for="row in contextRowsFromStart(trailingContextGap)"
                        :key="`${row.key}:${side}`"
                        class="controlled-line controlled-context-line"
                        :class="{
                          'diff-location-highlight': isHighlightedLine(
                            side,
                            side === 'left' ? row.left?.old_line : row.right?.new_line,
                          ),
                        }"
                        :data-side="side"
                        :data-line="side === 'left' ? row.left?.old_line : row.right?.new_line"
                      >
                        <span class="controlled-line-number" aria-hidden="true">
                          {{ side === "left" ? row.left?.old_line : row.right?.new_line }}
                        </span>
                        <span class="controlled-line-marker" aria-hidden="true"> </span>
                        <code class="controlled-code">{{
                          (side === "left" ? row.left : row.right)?.content ?? ""
                        }}</code>
                      </div>
                      <div
                        v-if="!isContextGapExpanded(trailingContextGap)"
                        class="controlled-context-gap controlled-context-gap-down"
                      >
                        <div v-if="side === 'left'" class="context-gap-controls">
                          <button
                            v-for="action in contextGapActions(trailingContextGap)"
                            :key="action.edge"
                            class="context-gap-button"
                            type="button"
                            :disabled="contextLoading"
                            :aria-label="contextGapLabel(trailingContextGap, action.edge)"
                            @click="expandContextGap(trailingContextGap, action.edge)"
                          >
                            <span aria-hidden="true">{{ action.arrow }}</span>
                          </button>
                        </div>
                        <span v-else class="context-gap-placeholder" aria-hidden="true" />
                      </div>
                      <div
                        v-for="row in contextRowsFromEnd(trailingContextGap)"
                        :key="`${row.key}:${side}`"
                        class="controlled-line controlled-context-line"
                        :class="{
                          'diff-location-highlight': isHighlightedLine(
                            side,
                            side === 'left' ? row.left?.old_line : row.right?.new_line,
                          ),
                        }"
                        :data-side="side"
                        :data-line="side === 'left' ? row.left?.old_line : row.right?.new_line"
                      >
                        <span class="controlled-line-number" aria-hidden="true">
                          {{ side === "left" ? row.left?.old_line : row.right?.new_line }}
                        </span>
                        <span class="controlled-line-marker" aria-hidden="true"> </span>
                        <code class="controlled-code">{{
                          (side === "left" ? row.left : row.right)?.content ?? ""
                        }}</code>
                      </div>
                    </template>
                  </div>
                </div>
              </div>

              <div v-else class="controlled-file-message" role="status">
                {{ selectedStandardPatch.message ?? "该文件没有可展示的文本 Diff" }}
              </div>
            </article>
            <div
              v-else
              class="legacy-diff"
              v-html="diffHtml"
              @pointerover="updateHoveredLegacyCodeSearchSide"
              @pointermove="updateHoveredLegacyCodeSearchSide"
              @pointerleave="clearHoveredCodeSearchSide"
            />
          </div>
        </div>
      </section>
    </section>

    <div v-else class="diff-empty">暂无 diff 数据</div>

    <Teleport to="body">
      <div
        v-if="quickComment"
        ref="popupRef"
        class="quick-comment-popup"
        :class="popupPositionClass"
        @click.stop
        @keydown="handleQuickKeydown"
      >
        <div class="popup-header">
          <span class="file-ref">
            {{ quickComment.path.split("/").pop() }}:L{{ quickComment.startLine
            }}{{
              quickComment.endLine !== quickComment.startLine ? "-L" + quickComment.endLine : ""
            }}
          </span>
          <button class="close-btn" @click="quickComment = null">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <pre v-if="quickComment.selectedText" class="selected-code">{{
          quickComment.selectedText
        }}</pre>

        <div class="popup-category">
          <AppSelect
            v-model="quickCategory"
            :options="Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))"
            @update:model-value="
              quickSubCategory = '';
              quickBody = '';
            "
          />
          <AppSelect
            v-if="categories[quickCategory]"
            v-model="quickSubCategory"
            :options="[
              { value: '', label: '-- 二级分类 --' },
              ...categories[quickCategory].map((sub: string) => ({ value: sub, label: sub })),
            ]"
            @update:model-value="onSubCategoryChange"
          />
        </div>

        <textarea
          v-model="quickBody"
          class="quick-comment-textarea"
          placeholder="输入评审意见... (⌘+Enter 提交, Esc 取消)"
          rows="3"
        />
        <div class="popup-actions">
          <button class="btn btn-sm" @click="quickComment = null">取消</button>
          <button
            class="btn btn-sm btn-primary"
            :disabled="!quickBody.trim() || quickSubmitting"
            @click="submitQuickComment"
          >
            {{ quickSubmitting ? "提交中..." : "提交" }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped src="./DiffViewer.css"></style>
