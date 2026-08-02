import { computed, ref } from "vue";
import type { ComputedRef, Ref } from "vue";

export interface AsyncListState {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  page: Ref<number>;
  totalPages: Ref<number>;
  failedPage: Ref<number | null>;
  hasMore: ComputedRef<boolean>;
  /** 开启一个新请求并返回序号；作废在途请求。openLoading 允许加载更多时不点亮主 loading。 */
  begin: (openLoading?: boolean) => number;
  isCurrent: (current: number) => boolean;
  /** 作废在途请求并关闭 loading（例如上下文切换）。 */
  cancel: () => void;
  /** 重置整个列表状态：作废在途请求、关 loading、清空错误与失败页、分页归零。 */
  reset: () => void;
  /** 请求成功推进分页；序号过期返回 false，调用方应丢弃结果。 */
  succeed: (current: number, nextPage: number, nextTotalPages: number) => boolean;
  /** 记录错误与失败页；记录成功返回 true，序号过期返回 false。markFailedPage 可跳过失败页标记（后台刷新）。 */
  fail: (
    current: number,
    requestedPage: number,
    message: string,
    markFailedPage?: boolean,
  ) => boolean;
  /** 收尾关闭 loading；仅当请求仍是最新时生效。 */
  finish: (current: number) => void;
}

/**
 * 竞态安全的分页列表状态机。
 *
 * 管理单个列表源的序号竞态与 loading/error/page/totalPages/failedPage 状态；
 * 列表条目与业务副作用（追加/替换、去重、上下文重置、状态补充）由调用方持有，
 * 避免把不同平台的分页语义塞进同一个抽象。
 *
 * 每个列表源（平台）一个实例：`begin()` 开启新请求并作废旧请求，
 * `succeed`/`fail`/`finish` 仅在请求仍是最新时更新状态，迟到响应不会覆盖新结果。
 */
export function useAsyncList(): AsyncListState {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const page = ref(0);
  const totalPages = ref(1);
  const failedPage = ref<number | null>(null);
  let sequence = 0;

  const hasMore = computed(() => page.value < totalPages.value);

  function begin(openLoading: boolean = true): number {
    sequence += 1;
    loading.value = openLoading;
    error.value = null;
    failedPage.value = null;
    return sequence;
  }

  function isCurrent(current: number): boolean {
    return current === sequence;
  }

  function cancel(): void {
    sequence += 1;
    loading.value = false;
  }

  function reset(): void {
    cancel();
    error.value = null;
    page.value = 0;
    totalPages.value = 1;
    failedPage.value = null;
  }

  function succeed(current: number, nextPage: number, nextTotalPages: number): boolean {
    if (!isCurrent(current)) return false;
    page.value = nextPage;
    totalPages.value = Math.max(nextTotalPages, nextPage);
    return true;
  }

  function fail(
    current: number,
    requestedPage: number,
    message: string,
    markFailedPage: boolean = true,
  ): boolean {
    if (!isCurrent(current)) return false;
    error.value = message;
    if (markFailedPage) failedPage.value = requestedPage;
    return true;
  }

  function finish(current: number): void {
    if (isCurrent(current)) loading.value = false;
  }

  return {
    loading,
    error,
    page,
    totalPages,
    failedPage,
    hasMore,
    begin,
    isCurrent,
    cancel,
    reset,
    succeed,
    fail,
    finish,
  };
}
