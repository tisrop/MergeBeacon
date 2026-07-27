import { computed, ref, watch, type Ref } from "vue";
import type { PrCommitSummary } from "@/types";
import { normalizeCommitRange, type CommitRangeSelection } from "@/utils/commitRange";

export function shortCommitSha(sha: string): string {
  return sha.slice(0, 8);
}

/** 完整时间戳，用于悬停提示。 */
export function formatCommitTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

/** 列表内联展示的短日期；提交列表是紧凑单行，放不下完整时间戳。 */
export function formatCommitDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

/**
 * 提交区间选择的交互编排。
 *
 * 选择状态由调用方持有（Pinia），这里只负责把「选中单个提交」和「从锚点扩选」
 * 归一成同一个闭区间，并保留扩选锚点。
 */
export function useDiffCommitRange(
  commits: Ref<PrCommitSummary[]>,
  selection: Ref<CommitRangeSelection | null>,
  onSelect: (next: CommitRangeSelection | null) => void,
) {
  const anchorIndex = ref<number | null>(null);

  // 选择可能被组件之外重置（AI 建议定位、评论定位、命令面板都直接调 store）。
  // 那些路径不经过 selectAll，锚点必须在这里一并失效，
  // 否则下一次 Shift 扩选会从一个界面上已经看不见的锚点开始。
  watch(selection, (value) => {
    if (!value) anchorIndex.value = null;
  });

  const normalizedSelection = computed(() =>
    selection.value ? normalizeCommitRange(commits.value, selection.value) : null,
  );

  const selectedCount = computed(() =>
    normalizedSelection.value
      ? normalizedSelection.value.endIndex - normalizedSelection.value.startIndex + 1
      : commits.value.length,
  );

  function isInRange(index: number): boolean {
    const range = normalizedSelection.value;
    if (!range) return false;
    return index >= range.startIndex && index <= range.endIndex;
  }

  /** 回到整体 Diff。 */
  function selectAll(): void {
    anchorIndex.value = null;
    onSelect(null);
  }

  function selectSingle(index: number): void {
    anchorIndex.value = index;
    onSelect({ startIndex: index, endIndex: index });
  }

  /** 从锚点扩选到目标提交；没有锚点时退化为选中单个提交。 */
  function extendTo(index: number): void {
    const anchor = anchorIndex.value ?? normalizedSelection.value?.startIndex;
    if (anchor === undefined) {
      selectSingle(index);
      return;
    }
    onSelect({ startIndex: anchor, endIndex: index });
  }

  return {
    anchorIndex,
    normalizedSelection,
    selectedCount,
    isInRange,
    selectAll,
    selectSingle,
    extendTo,
  };
}
