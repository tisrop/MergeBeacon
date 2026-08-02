import { describe, expect, it } from "vitest";
import { useAsyncRequest } from "@/composables/useAsyncRequest";

describe("useAsyncRequest", () => {
  it("begin/finish 控制 loading 生命周期", () => {
    const request = useAsyncRequest();
    expect(request.loading.value).toBe(false);

    const sequence = request.begin();
    expect(request.loading.value).toBe(true);

    request.finish(sequence);
    expect(request.loading.value).toBe(false);
  });

  it("beginSilent 不点亮 loading（无 loading 态的请求）", () => {
    const request = useAsyncRequest();
    request.beginSilent();
    expect(request.loading.value).toBe(false);
  });

  it("迟到完成不影响新请求的 loading", () => {
    const request = useAsyncRequest();
    const stale = request.begin();
    request.begin();

    request.finish(stale);
    expect(request.loading.value).toBe(true);
  });

  it("cancel 作废在途请求并关闭 loading", () => {
    const request = useAsyncRequest();
    const sequence = request.begin();

    request.cancel();
    expect(request.isCurrent(sequence)).toBe(false);
    expect(request.loading.value).toBe(false);
  });

  it("isCurrent 区分新请求与过期请求", () => {
    const request = useAsyncRequest();
    const stale = request.begin();
    const current = request.begin();

    expect(request.isCurrent(stale)).toBe(false);
    expect(request.isCurrent(current)).toBe(true);
  });
});
