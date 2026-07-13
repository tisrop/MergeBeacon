import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates, copySupportInfo, getAppVersion } from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";
import SettingsPage from "../SettingsPage.vue";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock("@/api", () => ({
  copySupportInfo: vi.fn(),
  getAppVersion: vi.fn(),
  checkForUpdates: vi.fn(),
}));

function mountPage() {
  return mount(SettingsPage, {
    global: {
      stubs: {
        AppLayout: { template: "<main><slot name='header' /><slot /></main>" },
        AiSettings: true,
      },
    },
  });
}

describe("SettingsPage 诊断信息", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
    vi.mocked(copySupportInfo).mockReset();
    vi.mocked(getAppVersion).mockResolvedValue("0.3.0");
    vi.mocked(checkForUpdates).mockReset();
  });

  it("使用当前平台获取后端脱敏文本并复制", async () => {
    vi.mocked(copySupportInfo).mockResolvedValue(undefined);
    const wrapper = mountPage();
    useAuthStore().setActivePlatform("gitlab");

    await wrapper.get("button.copy-support-button").trigger("click");
    await flushPromises();

    expect(copySupportInfo).toHaveBeenCalledWith("gitlab");
    expect(wrapper.get(".support-status").text()).toContain("诊断信息已复制");
    expect(
      wrapper.findAll(".privacy-note").some((node) => node.text().includes("不包含 Token")),
    ).toBe(true);
  });

  it("剪贴板拒绝时显示可重试的中文错误且恢复按钮", async () => {
    vi.mocked(copySupportInfo).mockRejectedValue(new Error("clipboard denied"));
    const wrapper = mountPage();

    await wrapper.get("button.copy-support-button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".support-status.error").text()).toContain(
      "复制失败：Error: clipboard denied",
    );
    expect(wrapper.get<HTMLButtonElement>("button.copy-support-button").element.disabled).toBe(
      false,
    );
    expect(wrapper.get("button.copy-support-button").text()).toBe("复制诊断信息");
  });

  it("后端失败时显示错误并恢复按钮", async () => {
    vi.mocked(copySupportInfo).mockRejectedValue("诊断信息暂不可用");
    const wrapper = mountPage();

    await wrapper.get("button.copy-support-button").trigger("click");
    await flushPromises();

    expect(copySupportInfo).toHaveBeenCalledOnce();
    expect(wrapper.get(".support-status.error").text()).toContain("诊断信息暂不可用");
  });
  it("显示当前版本并提示已是最新版本", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({
      current_version: "0.3.0",
      available: false,
      version: null,
      notes: null,
      published_at: null,
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(getAppVersion).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("当前版本：v0.3.0");

    await wrapper.get("button.check-update-button").trigger("click");
    await flushPromises();

    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain("当前已是最新版本");
  });

  it("将远端版本说明按不可信文本渲染", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue({
      current_version: "0.3.0",
      available: true,
      version: "0.4.0",
      notes: "<script>危险说明</script>",
      published_at: "2026-07-13",
    });
    const wrapper = mountPage();

    await wrapper.get("button.check-update-button").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("发现新版本 v0.4.0");
    expect(wrapper.get(".update-notes").text()).toBe("<script>危险说明</script>");
    expect(wrapper.find(".update-notes script").exists()).toBe(false);
  });

  it("检查更新失败后恢复按钮并允许重试", async () => {
    vi.mocked(checkForUpdates).mockRejectedValueOnce("签名验证失败").mockResolvedValueOnce({
      current_version: "0.3.0",
      available: false,
      version: null,
      notes: null,
      published_at: null,
    });
    const wrapper = mountPage();
    const button = wrapper.get<HTMLButtonElement>("button.check-update-button");

    await button.trigger("click");
    await flushPromises();

    expect(wrapper.get(".support-status.error").text()).toContain("签名验证失败");
    expect(button.element.disabled).toBe(false);
    expect(button.text()).toBe("检查更新");

    await button.trigger("click");
    await flushPromises();

    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("当前已是最新版本");
  });
});
