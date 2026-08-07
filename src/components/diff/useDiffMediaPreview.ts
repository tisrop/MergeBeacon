import { computed, nextTick, onUnmounted, ref, watch, type ComputedRef } from "vue";
import { prFileContent } from "@/api";
import { useI18n } from "@/i18n";
import type { Platform, PrFileContent, StandardPatchFile } from "@/types";
import { getErrorMessage } from "@/utils/error";

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
const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
};

export interface DiffMediaPreviewContext {
  platform?: Platform;
  owner?: string;
  repo?: string;
  baseSha?: string;
  headSha?: string;
  baseOwner?: string;
  baseRepo?: string;
  headOwner?: string;
  headRepo?: string;
  patch: StandardPatchFile | null;
}

export interface MediaPreviewTarget {
  side: "base" | "head";
  label: string;
  kind: "image" | "video";
  owner: string;
  repo: string;
  path: string;
  revision: string;
  mimeType: string;
}

export interface MediaPreviewPanel extends MediaPreviewTarget {
  src: string | null;
  error: string | null;
}

interface DiffMediaPreviewOptions {
  context: ComputedRef<DiffMediaPreviewContext>;
}

function mediaPreviewType(path: string): Pick<MediaPreviewTarget, "kind" | "mimeType"> | null {
  const extension = path.toLowerCase().split(".").at(-1) ?? "";
  const imageMimeType = IMAGE_MIME_TYPES[extension];
  if (imageMimeType) return { kind: "image", mimeType: imageMimeType };
  const videoMimeType = VIDEO_MIME_TYPES[extension];
  return videoMimeType ? { kind: "video", mimeType: videoMimeType } : null;
}

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

function createMediaPreviewSource(file: PrFileContent, mimeType: string): string | null {
  // `media-src data:` in tauri.conf.json is reserved for URLs assembled here from bounded
  // backend file bytes. Markdown and other user-provided `data:` URLs remain rejected.
  if (mimeType === "image/svg+xml") {
    return file.content_base64
      ? `data:image/svg+xml;base64,${file.content_base64}`
      : createSvgPreviewSource(file.content);
  }
  return file.binary && file.content_base64
    ? `data:${mimeType};base64,${file.content_base64}`
    : null;
}

export function useDiffMediaPreview(options: DiffMediaPreviewOptions) {
  const { t } = useI18n();
  const mediaViewMode = ref<"source" | "preview">("preview");
  const mediaPreviewPanels = ref<MediaPreviewPanel[]>([]);
  const mediaPreviewLoading = ref(false);
  let mediaPreviewRequestSequence = 0;

  const mediaPreviewTargets = computed<MediaPreviewTarget[]>(() => {
    const context = options.context.value;
    const patch = context.patch;
    if (!patch || !context.platform) return [];

    const targets: MediaPreviewTarget[] = [];
    const baseOwner = context.baseOwner ?? context.owner;
    const baseRepo = context.baseRepo ?? context.repo;
    const baseMediaType = patch.old_path ? mediaPreviewType(patch.old_path) : null;
    if (patch.old_path && context.baseSha && baseMediaType && baseOwner && baseRepo) {
      targets.push({
        side: "base",
        label: t("diff.viewer.before"),
        kind: baseMediaType.kind,
        owner: baseOwner,
        repo: baseRepo,
        path: patch.old_path,
        revision: context.baseSha,
        mimeType: baseMediaType.mimeType,
      });
    }
    const headOwner = context.headOwner ?? context.owner;
    const headRepo = context.headRepo ?? context.repo;
    const headMediaType = patch.new_path ? mediaPreviewType(patch.new_path) : null;
    if (patch.new_path && context.headSha && headMediaType && headOwner && headRepo) {
      targets.push({
        side: "head",
        label: t("diff.viewer.mediaAfter"),
        kind: headMediaType.kind,
        owner: headOwner,
        repo: headRepo,
        path: patch.new_path,
        revision: context.headSha,
        mimeType: headMediaType.mimeType,
      });
    }
    return targets;
  });
  const canPreviewMedia = computed(() => mediaPreviewTargets.value.length > 0);
  const isShowingMediaPreview = computed(
    () => canPreviewMedia.value && mediaViewMode.value === "preview",
  );
  const mediaPreviewIdentity = computed(() => {
    const context = options.context.value;
    return [
      context.platform ?? "",
      context.owner ?? "",
      context.repo ?? "",
      context.baseOwner ?? "",
      context.baseRepo ?? "",
      context.headOwner ?? "",
      context.headRepo ?? "",
      context.patch?.old_path ?? "",
      context.patch?.new_path ?? "",
      context.baseSha ?? "",
      context.headSha ?? "",
    ].join("\0");
  });

  async function loadMediaPreview(): Promise<void> {
    const targets = mediaPreviewTargets.value;
    const identity = mediaPreviewIdentity.value;
    const platform = options.context.value.platform;
    if (!canPreviewMedia.value || !platform) return;

    const requestSequence = ++mediaPreviewRequestSequence;
    mediaPreviewLoading.value = true;
    mediaPreviewPanels.value = targets.map((target) => ({ ...target, src: null, error: null }));

    const panels = await Promise.all(
      targets.map(async (target): Promise<MediaPreviewPanel> => {
        try {
          const file = await prFileContent(
            platform,
            target.owner,
            target.repo,
            target.path,
            target.revision,
            { mediaPreview: true },
          );
          if (file.truncated) {
            return { ...target, src: null, error: t("diff.viewer.mediaTooLarge") };
          }
          const src = createMediaPreviewSource(file, target.mimeType);
          return src
            ? { ...target, src, error: null }
            : { ...target, src: null, error: t("diff.viewer.mediaInvalid") };
        } catch (error) {
          return {
            ...target,
            src: null,
            error: getErrorMessage(error, t("diff.viewer.mediaLoadFailed")),
          };
        }
      }),
    );

    if (requestSequence !== mediaPreviewRequestSequence || identity !== mediaPreviewIdentity.value)
      return;
    mediaPreviewPanels.value = panels;
    mediaPreviewLoading.value = false;
  }

  function setMediaViewMode(mode: "source" | "preview"): void {
    mediaViewMode.value = mode;
  }

  function mediaPreviewPanelKey(panel: MediaPreviewTarget): string {
    return [panel.side, panel.owner, panel.repo, panel.path, panel.revision].join("\0");
  }

  function handleMediaPreviewError(failedPanel: MediaPreviewPanel): void {
    mediaPreviewPanels.value = mediaPreviewPanels.value.map((currentPanel) =>
      mediaPreviewPanelKey(currentPanel) === mediaPreviewPanelKey(failedPanel) &&
      currentPanel.src === failedPanel.src
        ? { ...currentPanel, src: null, error: t("diff.viewer.mediaDecodeFailed") }
        : currentPanel,
    );
  }

  watch(
    [mediaPreviewIdentity, isShowingMediaPreview],
    async ([identity, showingPreview]) => {
      mediaPreviewRequestSequence += 1;
      mediaPreviewPanels.value = [];
      mediaPreviewLoading.value = false;
      if (!showingPreview) return;
      await nextTick();
      if (identity === mediaPreviewIdentity.value && isShowingMediaPreview.value) {
        void loadMediaPreview();
      }
    },
    { immediate: true, flush: "post" },
  );

  onUnmounted(() => {
    mediaPreviewRequestSequence += 1;
  });

  return {
    mediaViewMode,
    mediaPreviewPanels,
    mediaPreviewLoading,
    canPreviewMedia,
    isShowingMediaPreview,
    loadMediaPreview,
    setMediaViewMode,
    mediaPreviewPanelKey,
    handleMediaPreviewError,
  };
}
