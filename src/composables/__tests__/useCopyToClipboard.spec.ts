import { defineComponent, h } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyToClipboard } from "@/composables/useCopyToClipboard";

const { clipboardWriteTextMock } = vi.hoisted(() => ({ clipboardWriteTextMock: vi.fn() }));

vi.mock("@/api", () => ({ clipboardWriteText: clipboardWriteTextMock }));

function mountCopyHost(fallbackErrorMessage?: string) {
  let api: ReturnType<typeof useCopyToClipboard> | null = null;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useCopyToClipboard(fallbackErrorMessage);
        return () => h("div");
      },
    }),
  );
  return { wrapper, api: api as unknown as ReturnType<typeof useCopyToClipboard> };
}

describe("useCopyToClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clipboardWriteTextMock.mockReset();
    clipboardWriteTextMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("写入原生剪贴板并在超时后收起已复制状态", async () => {
    const { api } = mountCopyHost();

    const copied = await api.copy("src/components/diff/DiffViewer.vue");

    expect(copied).toBe(true);
    expect(clipboardWriteTextMock).toHaveBeenCalledWith("src/components/diff/DiffViewer.vue");
    expect(api.copied.value).toBe(true);
    expect(api.copying.value).toBe(false);
    expect(api.errorMessage.value).toBe("");

    vi.advanceTimersByTime(1500);
    expect(api.copied.value).toBe(false);
  });

  it("复制失败时保留可读错误并不进入已复制状态", async () => {
    clipboardWriteTextMock.mockRejectedValue(new Error("clipboard denied"));
    const { api } = mountCopyHost("无法写入系统剪贴板");

    const copied = await api.copy("src/main.ts");

    expect(copied).toBe(false);
    expect(api.copied.value).toBe(false);
    expect(api.copying.value).toBe(false);
    expect(api.errorMessage.value).toContain("clipboard denied");
  });

  it("失败为空错误时回退到调用方提供的文案", async () => {
    clipboardWriteTextMock.mockRejectedValue("");
    const { api } = mountCopyHost("无法写入系统剪贴板");

    await api.copy("src/main.ts");

    expect(api.errorMessage.value).toBe("无法写入系统剪贴板");
  });

  it("复制进行中忽略重复触发", async () => {
    const pendingWrite: { resolve?: () => void } = {};
    clipboardWriteTextMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          pendingWrite.resolve = resolve;
        }),
    );
    const { api } = mountCopyHost();

    const first = api.copy("src/main.ts");
    await flushPromises();
    expect(api.copying.value).toBe(true);

    expect(await api.copy("src/main.ts")).toBe(false);
    expect(clipboardWriteTextMock).toHaveBeenCalledTimes(1);

    pendingWrite.resolve?.();
    expect(await first).toBe(true);
  });

  it("重置状态清除已复制提示和错误", async () => {
    const { api } = mountCopyHost();
    await api.copy("src/main.ts");
    expect(api.copied.value).toBe(true);

    api.resetCopyState();

    expect(api.copied.value).toBe(false);
    expect(api.errorMessage.value).toBe("");
  });

  it("卸载后不再触发已复制状态的延迟重置", async () => {
    const { wrapper, api } = mountCopyHost();
    await api.copy("src/main.ts");

    wrapper.unmount();
    vi.advanceTimersByTime(1500);

    // 计时器已在卸载时清理，状态不会在组件销毁后被再次写入。
    expect(api.copied.value).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
