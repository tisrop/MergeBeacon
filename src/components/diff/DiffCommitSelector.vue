<script setup lang="ts">
import { computed, toRef } from "vue";
import { useSelectDropdown } from "@/composables/useSelectDropdown";
import type { PrCommitSummary, PrCommitTruncatedEnd } from "@/types";
import type { CommitRangeSelection } from "@/utils/commitRange";
import {
  formatCommitDate,
  formatCommitTime,
  shortCommitSha,
  useDiffCommitRange,
} from "./useDiffCommitRange";

const props = defineProps<{
  commits: PrCommitSummary[];
  truncatedEnd: PrCommitTruncatedEnd | null;
  commitsLoading: boolean;
  commitsError: string | null;
  selection: CommitRangeSelection | null;
  rangeLoading: boolean;
  rangeError: string | null;
}>();

const emit = defineEmits<{
  "update:selection": [selection: CommitRangeSelection | null];
  retry: [];
}>();

/** 菜单项：第一项固定是「所有提交」，其余是提交本身。 */
type ScopeOption =
  | { kind: "all"; disabled?: boolean }
  | { kind: "commit"; index: number; commit: PrCommitSummary; disabled?: boolean };

const { normalizedSelection, selectedCount, isInRange, selectAll, selectSingle, extendTo } =
  useDiffCommitRange(toRef(props, "commits"), toRef(props, "selection"), (next) =>
    emit("update:selection", next),
  );

const isAllSelected = computed(() => normalizedSelection.value === null);

const scopeOptions = computed<ScopeOption[]>(() => [
  { kind: "all" },
  ...props.commits.map((commit, index) => ({ kind: "commit" as const, index, commit })),
]);

// 扩选是「按住 Shift 的那一次操作」的属性，而不是持久状态。
// selectOption 是同步调用，这里在调用前后成对设置即可，不会跨事件泄漏。
let extendRequested = false;

const {
  open,
  searchQuery,
  highlightIndex,
  wrapperRef,
  triggerRef,
  searchInputRef,
  listRef,
  filteredOptions,
  closeDropdown,
  toggleDropdown,
  selectOption,
  onTriggerKeydown,
  onSearchKeydown,
} = useSelectDropdown<ScopeOption>({
  options: scopeOptions,
  searchText: (option) =>
    option.kind === "all"
      ? "所有提交 all"
      : `${option.commit.sha} ${option.commit.title} ${option.commit.author_name}`,
  isSelected: (option) => (option.kind === "all" ? isAllSelected.value : isInRange(option.index)),
  onSelect: (option) => {
    if (option.kind === "all") {
      selectAll();
      closeDropdown(true);
      return;
    }
    if (extendRequested) {
      // 扩选后保持展开，便于确认选中的区间。
      extendTo(option.index);
      return;
    }
    selectSingle(option.index);
    closeDropdown(true);
  },
  searchable: () => props.commits.length > 0,
  closeOnSelect: false,
  optionSelector: ".commit-scope-option",
});

function chooseOption(option: ScopeOption, extend: boolean): void {
  extendRequested = extend;
  selectOption(option);
  extendRequested = false;
}

/** Shift + Enter 与 Shift + 单击等价，保证键盘也能选出区间。 */
function onMenuKeydown(event: KeyboardEvent, handler: (event: KeyboardEvent) => void): void {
  extendRequested = event.key === "Enter" && event.shiftKey;
  handler(event);
  extendRequested = false;
}

const triggerLabel = computed(() => {
  if (props.commitsLoading && props.commits.length === 0) return "读取提交中…";
  const range = normalizedSelection.value;
  if (!range) return `所有提交的变更（${props.commits.length}）`;
  const from = shortCommitSha(props.commits[range.startIndex].sha);
  if (range.startIndex === range.endIndex) {
    return `${from} ${props.commits[range.startIndex].title || "无标题提交"}`;
  }
  return `${selectedCount.value} 个提交 · ${from} → ${shortCommitSha(props.commits[range.endIndex].sha)}`;
});

// 丢弃方向按平台不同：GitHub / Gitee 最早在前，超限丢最新；GitLab 相反。
const truncationWarning = computed(() => {
  if (props.truncatedEnd === "oldest") {
    return "提交数量超过读取上限，列表缺少更早的提交：首项不一定是第一个提交。";
  }
  if (props.truncatedEnd === "newest") {
    return "提交数量超过读取上限，列表缺少更新的提交：最近的变更可能选不到。";
  }
  return "";
});

function isOptionSelected(option: ScopeOption): boolean {
  return option.kind === "all" ? isAllSelected.value : isInRange(option.index);
}
</script>

<template>
  <div ref="wrapperRef" class="diff-commit-scope">
    <div class="commit-scope-row">
      <span class="commit-scope-caption">变更范围</span>
      <button
        ref="triggerRef"
        class="commit-scope-trigger"
        type="button"
        role="combobox"
        :disabled="commitsLoading && commits.length === 0"
        :aria-expanded="open"
        aria-haspopup="listbox"
        aria-label="选择要查看的提交范围"
        @click="toggleDropdown"
        @keydown="onMenuKeydown($event, onTriggerKeydown)"
      >
        <span class="commit-scope-trigger-label">{{ triggerLabel }}</span>
        <span class="commit-scope-caret" aria-hidden="true">▾</span>
      </button>

      <button v-if="!isAllSelected" class="commit-scope-reset" type="button" @click="selectAll">
        查看所有变更
      </button>

      <span v-if="rangeLoading" class="commit-scope-status" role="status">
        正在读取所选提交的变更…
      </span>
      <span v-else-if="truncationWarning" class="commit-scope-flag" :title="truncationWarning">
        ⚠ 列表不完整
      </span>

      <!-- listbox 只允许 option 子元素，因此搜索框与提示留在浮层上、列表容器之外。 -->
      <div v-if="open" class="commit-scope-menu">
        <input
          v-if="commits.length > 0"
          ref="searchInputRef"
          v-model="searchQuery"
          class="commit-scope-search"
          type="text"
          placeholder="搜索提交号、标题或作者"
          aria-label="搜索提交"
          @keydown="onMenuKeydown($event, onSearchKeydown)"
        />

        <p v-if="truncationWarning" class="commit-scope-warning" role="alert">
          {{ truncationWarning }}
        </p>

        <div ref="listRef" class="commit-scope-list" role="listbox" aria-label="提交范围">
          <template
            v-for="(option, index) in filteredOptions"
            :key="option.kind === 'all' ? 'all' : option.commit.sha"
          >
            <button
              class="commit-scope-option"
              :class="{
                selected: isOptionSelected(option),
                highlighted: index === highlightIndex,
                'all-option': option.kind === 'all',
              }"
              type="button"
              role="option"
              :aria-selected="isOptionSelected(option)"
              @click="chooseOption(option, $event.shiftKey)"
            >
              <span class="commit-scope-check" aria-hidden="true">
                {{ isOptionSelected(option) ? "✓" : "" }}
              </span>
              <template v-if="option.kind === 'all'">
                <strong class="commit-scope-title">所有提交的变更</strong>
                <small class="commit-scope-meta">{{ commits.length }} 个提交</small>
              </template>
              <template v-else>
                <code>{{ shortCommitSha(option.commit.sha) }}</code>
                <strong class="commit-scope-title" :title="option.commit.title">
                  {{ option.commit.title || "无标题提交" }}
                </strong>
                <small
                  class="commit-scope-meta"
                  :title="formatCommitTime(option.commit.authored_at)"
                >
                  {{ option.commit.author_name || "未知作者" }}
                  <time v-if="option.commit.authored_at" :datetime="option.commit.authored_at">
                    {{ formatCommitDate(option.commit.authored_at) }}
                  </time>
                </small>
              </template>
            </button>
          </template>
          <p v-if="filteredOptions.length === 0" class="commit-scope-empty">没有匹配的提交</p>
        </div>

        <p v-if="commits.length > 0" class="commit-scope-hint">
          单击查看单个提交，Shift + 单击（或 Shift + Enter）扩选出区间。
        </p>
      </div>
    </div>

    <p v-if="commitsError" class="commit-scope-error" role="alert">
      <span>{{ commitsError }}</span>
      <button class="commit-scope-reset" type="button" @click="emit('retry')">重试</button>
    </p>
    <p v-else-if="rangeError" class="commit-scope-error" role="alert">{{ rangeError }}</p>
  </div>
</template>

<style scoped src="./DiffCommitSelector.css"></style>
