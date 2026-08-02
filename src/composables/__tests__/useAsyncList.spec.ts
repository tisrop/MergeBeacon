import { describe, expect, it } from "vitest";
import { useAsyncList } from "@/composables/useAsyncList";

describe("useAsyncList", () => {
  it("begin/finish 控制 loading 生命周期", () => {
    const list = useAsyncList();
    expect(list.loading.value).toBe(false);

    const sequence = list.begin();
    expect(list.loading.value).toBe(true);
    expect(list.error.value).toBeNull();
    expect(list.failedPage.value).toBeNull();

    list.finish(sequence);
    expect(list.loading.value).toBe(false);
  });

  it("begin 可关闭 loading（加载更多场景）", () => {
    const list = useAsyncList();
    list.begin(false);
    expect(list.loading.value).toBe(false);
  });

  it("succeed 推进分页并派生 hasMore", () => {
    const list = useAsyncList();
    const sequence = list.begin();

    expect(list.succeed(sequence, 1, 3)).toBe(true);
    expect(list.page.value).toBe(1);
    expect(list.totalPages.value).toBe(3);
    expect(list.hasMore.value).toBe(true);
  });

  it("succeed 保护 totalPages 不小于当前页", () => {
    const list = useAsyncList();
    const sequence = list.begin();
    list.succeed(sequence, 2, 1);
    expect(list.totalPages.value).toBe(2);
    expect(list.hasMore.value).toBe(false);
  });

  it("fail 记录错误与失败页", () => {
    const list = useAsyncList();
    const sequence = list.begin();

    expect(list.fail(sequence, 3, "boom")).toBe(false);
    expect(list.error.value).toBe("boom");
    expect(list.failedPage.value).toBe(3);
  });

  it("fail 可通过选项跳过失败页标记（后台刷新场景）", () => {
    const list = useAsyncList();
    const sequence = list.begin();
    list.fail(sequence, 2, "boom", false);
    expect(list.error.value).toBe("boom");
    expect(list.failedPage.value).toBeNull();
  });

  it("迟到成功结果不覆盖新请求", () => {
    const list = useAsyncList();
    const stale = list.begin();
    const current = list.begin();

    expect(list.succeed(stale, 1, 5)).toBe(false);
    list.succeed(current, 1, 2);
    expect(list.page.value).toBe(1);
    expect(list.totalPages.value).toBe(2);
  });

  it("迟到失败不污染错误状态", () => {
    const list = useAsyncList();
    const stale = list.begin();
    const current = list.begin();
    list.succeed(current, 1, 2);

    expect(list.fail(stale, 1, "late error")).toBe(false);
    expect(list.error.value).toBeNull();
    expect(list.failedPage.value).toBeNull();
  });

  it("cancel 作废在途请求并关闭 loading", () => {
    const list = useAsyncList();
    const sequence = list.begin();
    list.cancel();
    expect(list.isCurrent(sequence)).toBe(false);
    expect(list.loading.value).toBe(false);
  });

  it("finish 只关闭最新请求的 loading", () => {
    const list = useAsyncList();
    const stale = list.begin();
    list.begin();
    list.finish(stale);
    expect(list.loading.value).toBe(true);
  });
});
