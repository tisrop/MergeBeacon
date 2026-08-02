<script setup lang="ts">
import { computed } from "vue";
import type { FileStatus, PrFile, ReviewThreadSummary } from "@/types";
import { getStaticCssClass } from "@/composables/useDynamicCssClass";
import { useI18n } from "@/i18n";
import {
  buildFileTree,
  MAX_NAVIGATOR_WIDTH,
  MIN_NAVIGATOR_WIDTH,
  visibleFileTreeRows,
  type FileTreeRow,
} from "./diffFileTree";

const props = defineProps<{
  files: PrFile[];
  selectedFilePath: string;
  expandedDirectories: Set<string>;
  viewedFilePaths: Set<string>;
  viewedProgressSource: string;
  viewedProgressDescription: string;
  viewedFileCount: number;
  showReviewProgress: boolean;
  threadSummary?: ReviewThreadSummary | null;
  navigatorWidth: number;
  resizing: boolean;
}>();

const emit = defineEmits<{
  selectFile: [path: string];
  toggleDirectory: [key: string];
  startResize: [event: PointerEvent];
  resizeKeydown: [event: KeyboardEvent];
}>();

const { t } = useI18n();
const statusDescriptions = computed<Record<FileStatus, string>>(() => ({
  added: t("diff.viewer.added"),
  modified: t("diff.viewer.modified"),
  removed: t("diff.viewer.removed"),
  renamed: t("diff.viewer.renamed"),
}));
const fileTree = computed(() => buildFileTree(props.files));
const visibleTreeRows = computed(() =>
  visibleFileTreeRows(fileTree.value, props.expandedDirectories),
);
const totalAdditions = computed(() =>
  props.files.reduce((total, file) => total + file.additions, 0),
);
const totalDeletions = computed(() =>
  props.files.reduce((total, file) => total + file.deletions, 0),
);

function treeRowDepthClass(depth: number): string {
  return getStaticCssClass("diff-tree-depth", { "--tree-depth": `${Math.max(1, depth)}` });
}

function isFileViewed(path: string): boolean {
  return props.viewedFilePaths.has(path);
}

function threadSummaryForFile(path: string) {
  return props.threadSummary?.by_file[path];
}

function fileTreeAriaLabel(row: FileTreeRow): string {
  if (!row.file) return t("diff.viewer.directoryLabel", { name: row.name });
  const summary = threadSummaryForFile(row.file.filename);
  const viewed = isFileViewed(row.file.filename)
    ? t("diff.viewer.fileViewedWithSource", { source: props.viewedProgressSource })
    : t("diff.viewer.fileUnviewed");
  const unresolved = summary?.unresolved
    ? `, ${t("diff.viewer.fileUnresolved", { count: summary.unresolved })}`
    : "";
  return `${t("diff.viewer.fileLabel", {
    status: statusDescriptions.value[row.file.status],
    path: row.file.filename,
  })}, ${viewed}${unresolved}`;
}

function fileTreeTitle(file: PrFile): string {
  return t("diff.viewer.fileLabel", {
    status: statusDescriptions.value[file.status],
    path: file.filename,
  });
}

function activateTreeRow(row: FileTreeRow): void {
  if (row.kind === "directory") emit("toggleDirectory", row.key);
  else if (row.file) emit("selectFile", row.file.filename);
}
</script>

<template>
  <aside class="file-navigator" :class="{ resizing }" :aria-label="t('diff.viewer.filesChanged')">
    <header class="navigator-header">
      <div>
        <strong>{{ t("diff.viewer.files") }}</strong>
        <span>{{ files.length }}</span>
        <span
          v-if="showReviewProgress"
          class="local-progress-label"
          :title="viewedProgressDescription"
        >
          {{
            t("diff.viewer.progressSummary", {
              source: viewedProgressSource,
              viewed: viewedFileCount,
              total: files.length,
            })
          }}
        </span>
      </div>
      <div class="change-summary" :aria-label="t('diff.viewer.changeSummary')">
        <span class="additions">+{{ totalAdditions }}</span>
        <span class="deletions">-{{ totalDeletions }}</span>
      </div>
    </header>

    <nav class="file-tree" role="tree" :aria-label="t('diff.viewer.fileTree')">
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
        :aria-label="fileTreeAriaLabel(row)"
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
        <span class="tree-label" :title="row.file ? fileTreeTitle(row.file) : row.name">
          {{ row.name }}
        </span>
        <template v-if="row.file">
          <span class="file-review-indicators" aria-hidden="true">
            <span
              v-if="isFileViewed(row.file.filename)"
              class="viewed-indicator"
              :title="t('diff.viewer.fileViewedWithSource', { source: viewedProgressSource })"
              >✓</span
            >
            <span
              v-if="threadSummary?.by_file[row.file.filename]?.unresolved"
              class="unresolved-indicator"
              :title="
                t('diff.viewer.fileUnresolved', {
                  count: threadSummary.by_file[row.file.filename].unresolved,
                })
              "
            >
              {{ threadSummary.by_file[row.file.filename].unresolved }}
            </span>
            <span
              v-else-if="threadSummary?.by_file[row.file.filename]?.comments"
              class="comment-indicator"
              :title="
                t('diff.viewer.fileComments', {
                  count: threadSummary.by_file[row.file.filename].comments,
                })
              "
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
      :aria-label="t('diff.viewer.navigatorResize')"
      aria-orientation="vertical"
      :aria-valuemin="MIN_NAVIGATOR_WIDTH"
      :aria-valuemax="MAX_NAVIGATOR_WIDTH"
      :aria-valuenow="navigatorWidth"
      tabindex="0"
      @pointerdown="emit('startResize', $event)"
      @keydown="emit('resizeKeydown', $event)"
    />
  </aside>
</template>

<style scoped src="./DiffFileNavigator.css"></style>
