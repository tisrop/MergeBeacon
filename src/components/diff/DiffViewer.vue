<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { storeToRefs } from "pinia";
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
  ReviewThreadSummary,
  StandardPatchFile,
} from "@/types";
import { prFileContent, reviewFileSetViewed, reviewViewedFilesList } from "@/api";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";
import {
  useReviewProgressStore,
  type ReviewProgressContext,
} from "@/stores/useReviewProgressStore";
import { getErrorMessage } from "@/utils/error";
import { findPatchLocation as findStandardPatchLocation } from "@/utils/diffHunk";
import CodeSearchBar from "./CodeSearchBar.vue";
import ControlledContextLine from "./ControlledContextLine.vue";
import DiffFileNavigator from "./DiffFileNavigator.vue";
import LegacyDiffRenderer from "./LegacyDiffRenderer.vue";
import QuickCommentPopup from "./QuickCommentPopup.vue";
import {
  buildFileTree,
  collectDirectoryKeys,
  expandedDirectoryKeysForFile,
  firstFilePath,
  MAX_NAVIGATOR_WIDTH,
  MIN_NAVIGATOR_WIDTH,
} from "./diffFileTree";
import { renderLegacyDiffHtml } from "./legacyDiffHtml";
import { useDiffCodeSearch } from "./useDiffCodeSearch";
import { useDiffViewportStyles } from "./useDiffLayoutStyles";
import { useDiffQuickComment, type QuickCommentTarget } from "./useDiffQuickComment";
import { useDiffMediaPreview } from "./useDiffMediaPreview";
import { useCopyToClipboard } from "@/composables/useCopyToClipboard";
import { useDocumentStateClass } from "@/composables/useDynamicCssClass";
import { useI18n } from "@/i18n";

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

const { t } = useI18n();
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

const statusDescriptions = computed<Record<FileStatus, string>>(() => ({
  added: t("diff.viewer.added"),
  modified: t("diff.viewer.modified"),
  removed: t("diff.viewer.removed"),
  renamed: t("diff.viewer.renamed"),
}));

function expandDirectoriesForFile(path: string): void {
  expandedDirectories.value = expandedDirectoryKeysForFile(path, expandedDirectories.value);
}

const fileTree = computed(() => buildFileTree(props.diff?.files ?? []));
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
  if (!props.canSyncViewedFiles) return t("diff.viewer.progressLocal");
  if (viewedFilesLoading.value) return t("diff.viewer.progressSyncing");
  if (!viewedFilesLoadedRemotely.value) return t("diff.viewer.progressCached");
  return t("diff.viewer.progressRemote");
});
const viewedProgressDescription = computed(() => {
  if (!props.canSyncViewedFiles) return t("diff.viewer.progressLocalDescription");
  if (viewedFilesLoading.value) return t("diff.viewer.progressSyncingDescription");
  if (!viewedFilesLoadedRemotely.value) return t("diff.viewer.progressCachedDescription");
  return t("diff.viewer.progressRemoteDescription");
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

const mediaPreviewContext = computed(() => ({
  platform: props.platform,
  owner: props.owner,
  repo: props.repo,
  baseSha: props.baseSha,
  headSha: props.headSha,
  baseOwner: props.baseOwner,
  baseRepo: props.baseRepo,
  headOwner: props.headOwner,
  headRepo: props.headRepo,
  patch: selectedStandardPatch.value,
}));
const {
  mediaViewMode,
  mediaPreviewPanels,
  mediaPreviewLoading,
  canPreviewMedia,
  isShowingMediaPreview,
  loadMediaPreview,
  setMediaViewMode: setMediaPreviewViewMode,
  mediaPreviewPanelKey,
  handleMediaPreviewError,
} = useDiffMediaPreview({
  context: mediaPreviewContext,
});

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
    emitLocationFailure(request, t("diff.viewer.locateMissingPath"));
    return;
  }

  const resolved = resolveLocationFile(path);
  if (!resolved) {
    emitLocationFailure(request, t("diff.viewer.locatePathMissing", { path }));
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
    emitLocationFailure(request, t("diff.viewer.locateInvalidLine", { line: request.line }));
    return;
  }
  if (!resolved.patch || resolved.patch.content_kind !== "text") {
    emitLocationFailure(request, t("diff.viewer.locateNoPatch", { path: resolved.file.filename }));
    return;
  }

  const target = findStandardPatchLocation(resolved.patch, request.line, path, request.side);
  if (!target) {
    emitLocationFailure(
      request,
      t("diff.viewer.locateLineMissing", {
        path: resolved.file.filename,
        line: request.line,
      }),
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
    emitLocationFailure(
      request,
      t("diff.viewer.locateTargetHidden", { path: resolved.file.filename }),
    );
    return;
  }
  const diffScroll = diffScrollRef.value;
  if (!diffScroll) {
    highlightedLocation.value = null;
    emitLocationFailure(
      request,
      t("diff.viewer.locateScrollMissing", { path: resolved.file.filename }),
    );
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
    return t("diff.viewer.contextExpandBoth", {
      direction: t(
        edge === "start" ? "diff.viewer.contextDirectionDown" : "diff.viewer.contextDirectionUp",
      ),
      count: CONTEXT_EXPANSION_STEP,
    });
  }
  return t("diff.viewer.contextExpandOne", {
    direction: t(
      edge === "start" ? "diff.viewer.contextDirectionBelow" : "diff.viewer.contextDirectionAbove",
    ),
    count: CONTEXT_EXPANSION_STEP,
  });
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
    contextError.value = t("diff.viewer.contextMissingRevisions");
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
      contextError.value = t("diff.viewer.contextTooLarge");
      return false;
    }
    if (base?.binary || head?.binary) {
      contextError.value = t("diff.viewer.contextBinary");
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
const fileSignature = computed(() =>
  (props.diff?.files ?? []).map((file) => file.filename).join("\0"),
);

const renderedDiff = computed(() => props.diff?.diff ?? "");

const diffHtml = computed(() => {
  if (!renderedDiff.value) return "";
  const options = {
    drawFileList: false,
    matching: "lines" as const,
    outputFormat: "side-by-side" as const,
    renderNothingWhenEmpty: false,
  };
  try {
    return renderLegacyDiffHtml(renderedDiff.value, options);
  } catch {
    // 后端 patch 解析失败时始终回退到平台原始 diff，不能用空字符串覆盖视图。
    if (props.diff?.diff && renderedDiff.value !== props.diff.diff) {
      try {
        return renderLegacyDiffHtml(props.diff.diff, options);
      } catch {
        return "";
      }
    }
    return "";
  }
});

const hasDiffContent = computed(() => hasControlledPatch.value || Boolean(diffHtml.value));
const canSearchCurrentFile = computed(() => {
  if (!selectedFile.value || isShowingMediaPreview.value) return false;
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
    if (isShowingMediaPreview.value && !mediaPreviewLoading.value) void loadMediaPreview();
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

const {
  copying: copyingFilePath,
  copied: filePathCopied,
  errorMessage: filePathCopyError,
  copy: copyText,
  resetCopyState: resetFilePathCopyState,
} = useCopyToClipboard(() => t("common.copyUnavailable"));
const filePathCopyTitle = computed(() => {
  if (copyingFilePath.value) return t("diff.viewer.copyPathCopying");
  if (filePathCopied.value) return t("diff.viewer.copyPathCopied");
  return t("diff.viewer.copyPath");
});

async function copySelectedFilePath(): Promise<void> {
  const path = selectedFile.value?.filename;
  if (path) await copyText(path);
}

// 切换文件后，上一个文件的复制结果不能继续挂在新文件的路径旁边。
watch(selectedFilePath, resetFilePathCopyState);

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
      viewedFilesError.value = getErrorMessage(error, t("diff.viewer.reviewSyncFailed"));
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
        viewedFilesError.value = getErrorMessage(error, t("diff.viewer.reviewLoadFailed"));
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

const quickCommentReadOnly = computed(() => props.readOnly === true);
const { quickComment } = useDiffQuickComment({
  containerRef,
  readOnly: quickCommentReadOnly,
});

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
  isShowingMediaPreview,
  canSearchCurrentFile,
  isDiffSyncScrollEnabled,
  quickComment,
  setSideDiffScrollLeft,
  setSideDiffScrollerScrollLeft,
  updateTopScrollbar,
  scrollElementWithinContainer,
});

function setMediaViewMode(mode: "source" | "preview"): void {
  setMediaPreviewViewMode(mode);
  if (mode === "preview") closeCodeSearch();
}

function submitQuickComment(target: QuickCommentTarget, body: string): void {
  emit("addComment", target.path, target.startLine, target.endLine, target.side, body);
}

onMounted(() => {
  updateTopScrollbar();
  observeDiffSize();
  bindSideDiffScrollers();
});

onUnmounted(() => {
  stopNavigatorResize();
  diffResizeObserver?.disconnect();
  for (const scroller of visibleSideDiffScrollers()) {
    scroller.removeEventListener("scroll", handleSideDiffScroll);
  }
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
      :aria-label="t('diff.viewer.browser')"
    >
      <DiffFileNavigator
        v-if="navigatorVisible"
        :files="diff?.files ?? []"
        :selected-file-path="selectedFilePath"
        :expanded-directories="expandedDirectories"
        :viewed-file-paths="viewedFilePaths"
        :viewed-progress-source="viewedProgressSource"
        :viewed-progress-description="viewedProgressDescription"
        :viewed-file-count="viewedFileCount"
        :show-review-progress="Boolean(reviewProgressContext)"
        :thread-summary="threadSummary"
        :navigator-width="navigatorWidth"
        :resizing="resizingNavigator"
        @select-file="selectFile"
        @toggle-directory="toggleDirectory"
        @start-resize="startNavigatorResize"
        @resize-keydown="resizeNavigatorWithKeyboard"
      />

      <section class="diff-context" :aria-label="t('diff.viewer.context')">
        <header class="diff-toolbar">
          <button
            class="navigator-toggle"
            type="button"
            :aria-pressed="navigatorVisible"
            :title="navigatorVisible ? t('diff.viewer.hideFiles') : t('diff.viewer.showFiles')"
            @click="navigatorVisible = !navigatorVisible"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1.75" y="2.25" width="12.5" height="11.5" rx="1.5" stroke="currentColor" />
              <path d="M5.25 2.5v11" stroke="currentColor" />
            </svg>
          </button>
          <div class="selected-file-heading">
            <span class="selected-file-name" :title="selectedFile?.filename">
              {{ selectedFile?.filename ?? t("diff.viewer.allChanges") }}
            </span>
            <button
              v-if="selectedFile"
              class="navigator-toggle copy-file-path-button"
              :class="{ copied: filePathCopied }"
              type="button"
              :disabled="copyingFilePath"
              :title="filePathCopyTitle"
              :aria-label="filePathCopyTitle"
              @click="copySelectedFilePath"
            >
              <svg
                v-if="filePathCopied"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="m3.5 8.5 3 3 6-6.5"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect
                  x="5.75"
                  y="5.75"
                  width="7.5"
                  height="7.5"
                  rx="1.5"
                  stroke="currentColor"
                  stroke-width="1.3"
                />
                <path
                  d="M10.25 5.75V4.25a1.5 1.5 0 0 0-1.5-1.5h-4.5a1.5 1.5 0 0 0-1.5 1.5v4.5a1.5 1.5 0 0 0 1.5 1.5h1.5"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                />
              </svg>
            </button>
            <span v-if="selectedFile" class="selected-file-status">
              {{ statusDescriptions[selectedFile.status] }}
            </span>
            <span
              v-if="filePathCopyError"
              class="file-path-copy-error"
              role="alert"
              aria-atomic="true"
              :title="filePathCopyError"
            >
              {{ filePathCopyError }}
            </span>
          </div>
          <div
            v-if="selectedFile"
            class="selected-file-stats"
            :aria-label="t('diff.viewer.currentFileStats')"
          >
            <span class="additions">+{{ selectedFile.additions }}</span>
            <span class="deletions">-{{ selectedFile.deletions }}</span>
          </div>
          <button
            class="navigator-toggle code-search-toggle"
            type="button"
            :aria-pressed="isCodeSearchOpen"
            :disabled="!canSearchCurrentFile"
            :title="canSearchCurrentFile ? t('diff.viewer.find') : t('diff.viewer.findUnavailable')"
            :aria-label="t('diff.viewer.find')"
            aria-keyshortcuts="Meta+F Control+F"
            @click="toggleCodeSearch"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.75" cy="6.75" r="4.25" stroke="currentColor" stroke-width="1.4" />
              <path d="m10 10 3.5 3.5" stroke="currentColor" stroke-width="1.4" />
            </svg>
          </button>
          <div
            v-if="canPreviewMedia"
            class="media-view-toggle"
            :aria-label="t('diff.viewer.mediaViewMode')"
          >
            <button
              type="button"
              :aria-pressed="mediaViewMode === 'source'"
              @click="setMediaViewMode('source')"
            >
              {{ t("diff.viewer.code") }}
            </button>
            <button
              type="button"
              :aria-pressed="mediaViewMode === 'preview'"
              @click="setMediaViewMode('preview')"
            >
              {{ t("diff.viewer.preview") }}
            </button>
          </div>
          <div v-if="reviewProgressContext && selectedFile" class="review-progress-actions">
            <span class="unviewed-summary">
              {{ t("diff.viewer.progressUnviewed", { count: unviewedFileCount }) }}
            </span>
            <span
              v-if="viewedFilesError"
              class="review-progress-error"
              role="alert"
              :title="viewedFilesError"
            >
              {{ t("diff.viewer.progressSyncFailed", { message: viewedFilesError }) }}
            </span>
            <button
              type="button"
              class="review-progress-button progress-nav-button"
              :disabled="unviewedFileCount === 0"
              :title="t('diff.viewer.previousUnviewed')"
              :aria-label="t('diff.viewer.previousUnviewed')"
              @click="navigateUnviewed(-1)"
            >
              ↑
            </button>
            <button
              type="button"
              class="review-progress-button progress-nav-button"
              :disabled="unviewedFileCount === 0"
              :title="t('diff.viewer.nextUnviewed')"
              :aria-label="t('diff.viewer.nextUnviewed')"
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
                  ? t("diff.viewer.syncing")
                  : isFileViewed(selectedFile.filename)
                    ? t("diff.viewer.markUnviewed")
                    : t("diff.viewer.markViewed")
              }}
            </button>
          </div>
          <div
            v-if="hasControlledPatch && canExpandContext && !isShowingMediaPreview"
            class="context-toolbar-actions"
          >
            <button
              v-if="hasExpandedContext"
              class="context-toolbar-button"
              type="button"
              :disabled="contextLoading"
              @click="collapseAllContext"
            >
              {{ t("diff.viewer.contextCollapseAll") }}
            </button>
            <button
              v-else
              class="context-toolbar-button"
              type="button"
              :disabled="contextLoading"
              @click="expandAllContext"
            >
              {{
                contextLoading ? t("diff.viewer.contextLoading") : t("diff.viewer.contextExpandAll")
              }}
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
          v-if="!isShowingMediaPreview"
          class="diff-top-scrollbars"
          :class="{ independent: !isDiffSyncScrollEnabled }"
        >
          <div
            v-if="isDiffSyncScrollEnabled"
            ref="topScrollbarRef"
            class="diff-top-scrollbar"
            role="region"
            :aria-label="t('diff.viewer.scrollBoth')"
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
              :aria-label="t('diff.viewer.scrollLeft')"
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
              :aria-label="t('diff.viewer.scrollRight')"
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
          :class="{ 'media-preview-active': isShowingMediaPreview }"
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
                v-if="contextError && !isShowingMediaPreview"
                class="context-load-error"
                role="alert"
              >
                {{ contextError }}
              </p>

              <div
                v-if="isShowingMediaPreview"
                class="media-preview-grid"
                :class="{ 'single-panel': mediaPreviewPanels.length === 1 }"
                aria-live="polite"
              >
                <div
                  v-if="!mediaPreviewLoading && mediaPreviewPanels.length === 0"
                  class="media-preview-error media-preview-empty"
                  role="alert"
                >
                  <span>{{ t("diff.viewer.mediaNotLoaded") }}</span>
                  <button type="button" @click="loadMediaPreview">
                    {{ t("diff.viewer.mediaReload") }}
                  </button>
                </div>
                <section
                  v-for="panel in mediaPreviewPanels"
                  :key="mediaPreviewPanelKey(panel)"
                  class="media-preview-panel"
                  :aria-label="t('diff.viewer.mediaPanel', { label: panel.label })"
                >
                  <header class="media-preview-header">
                    <strong>{{ panel.label }}</strong>
                    <span :title="panel.path">{{ panel.path }}</span>
                  </header>
                  <div class="media-preview-stage">
                    <span v-if="mediaPreviewLoading" class="media-preview-status">
                      {{ t("diff.viewer.mediaLoading") }}
                    </span>
                    <div v-else-if="panel.error" class="media-preview-error" role="alert">
                      <span>{{ panel.error }}</span>
                      <button type="button" @click="loadMediaPreview">
                        {{ t("diff.viewer.mediaReload") }}
                      </button>
                    </div>
                    <img
                      v-else-if="panel.src && panel.kind === 'image'"
                      class="media-preview-image"
                      :src="panel.src"
                      :alt="
                        t('diff.viewer.mediaImageAlt', { label: panel.label, path: panel.path })
                      "
                      @error="handleMediaPreviewError(panel)"
                    />
                    <video
                      v-else-if="panel.src && panel.kind === 'video'"
                      class="media-preview-video"
                      :src="panel.src"
                      :aria-label="
                        t('diff.viewer.videoLabel', { label: panel.label, path: panel.path })
                      "
                      controls
                      playsinline
                      preload="metadata"
                      @error="handleMediaPreviewError(panel)"
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
                  :aria-label="
                    side === 'left' ? t('diff.viewer.beforeCode') : t('diff.viewer.afterCode')
                  "
                  @pointerenter="setHoveredCodeSearchSide(side)"
                  @pointerleave="clearHoveredCodeSearchSide"
                >
                  <div class="controlled-side-content">
                    <template
                      v-for="controlledHunk in controlledHunks"
                      :key="`${controlledHunk.key}:${side}`"
                    >
                      <template v-if="controlledHunk.gapBefore">
                        <ControlledContextLine
                          v-for="row in contextRowsFromStart(controlledHunk.gapBefore)"
                          :key="`${row.key}:${side}`"
                          :row="row"
                          :side="side"
                          :highlighted="
                            isHighlightedLine(
                              side,
                              side === 'left' ? row.left?.old_line : row.right?.new_line,
                            )
                          "
                        />
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
                          <ControlledContextLine
                            v-for="row in contextRowsFromEnd(controlledHunk.gapBefore)"
                            :key="`${row.key}:${side}`"
                            :row="row"
                            :side="side"
                            :highlighted="
                              isHighlightedLine(
                                side,
                                side === 'left' ? row.left?.old_line : row.right?.new_line,
                              )
                            "
                          />
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
                      <ControlledContextLine
                        v-for="row in contextRowsFromStart(trailingContextGap)"
                        :key="`${row.key}:${side}`"
                        :row="row"
                        :side="side"
                        :highlighted="
                          isHighlightedLine(
                            side,
                            side === 'left' ? row.left?.old_line : row.right?.new_line,
                          )
                        "
                      />
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
                      <ControlledContextLine
                        v-for="row in contextRowsFromEnd(trailingContextGap)"
                        :key="`${row.key}:${side}`"
                        :row="row"
                        :side="side"
                        :highlighted="
                          isHighlightedLine(
                            side,
                            side === 'left' ? row.left?.old_line : row.right?.new_line,
                          )
                        "
                      />
                    </template>
                  </div>
                </div>
              </div>

              <div v-else class="controlled-file-message" role="status">
                {{ selectedStandardPatch.message ?? t("diff.viewer.noTextDiff") }}
              </div>
            </article>
            <LegacyDiffRenderer
              v-else
              :sanitized-html="diffHtml"
              @pointerover="updateHoveredLegacyCodeSearchSide"
              @pointermove="updateHoveredLegacyCodeSearchSide"
              @pointerleave="clearHoveredCodeSearchSide"
            />
          </div>
        </div>
      </section>
    </section>

    <div v-else class="diff-empty">{{ t("diff.viewer.empty") }}</div>

    <QuickCommentPopup v-model="quickComment" @submit="submitQuickComment" />
  </div>
</template>

<style scoped src="./DiffViewer.css"></style>
