import { ref } from "vue";
import type { Ref } from "vue";

export interface AsyncRequestState {
  loading: Ref<boolean>;
  /** 开启一个新请求并返回序号，作废在途请求。 */
  begin: () => number;
  /** 开启一个不点亮 loading 的新请求（无 loading 语义的请求），并作废在途请求。 */
  beginSilent: () => number;
  /** 仅当请求仍是最新时返回 true；迟到响应应丢弃结果。 */
  isCurrent: (current: number) => boolean;
  /** 请求收尾关闭 loading；仅当请求仍是最新时生效。 */
  finish: (current: number) => void;
  /** 作废在途请求并关闭 loading（例如上下文切换）。 */
  cancel: () => void;
}

/**
 * 单个异步请求的竞态序号管理。
 *
 * 用于无分页的请求（详情、Diff、提交列表、区间 Diff、合并就绪等）：
 * `begin()` 作废旧请求并开启 loading，`isCurrent`/`finish` 保证迟到响应
 * 不会覆盖新请求的结果。分页列表请使用 `useAsyncList`。
 */
export function useAsyncRequest(): AsyncRequestState {
  const loading = ref(false);
  let sequence = 0;

  function begin(): number {
    sequence += 1;
    loading.value = true;
    return sequence;
  }

  function beginSilent(): number {
    sequence += 1;
    loading.value = false;
    return sequence;
  }

  function isCurrent(current: number): boolean {
    return current === sequence;
  }

  function finish(current: number): void {
    if (isCurrent(current)) loading.value = false;
  }

  function cancel(): void {
    sequence += 1;
    loading.value = false;
  }

  return { loading, begin, beginSilent, isCurrent, finish, cancel };
}
