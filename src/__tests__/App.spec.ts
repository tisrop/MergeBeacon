import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates, isDesktopRuntime, setNativeMenuLabels } from "@/api";
import UpdateAvailableDialog from "@/components/update/UpdateAvailableDialog.vue";
import { setAppLocale } from "@/i18n";
import { useUpdateStore } from "@/stores/useUpdateStore";
import App from "../App.vue";

const storage = new Map<string, string>();
const scrollIntoView = vi.fn();
const matchMedia = vi.fn();

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});
vi.stubGlobal("matchMedia", matchMedia);
const noUpdate = {
  current_version: "0.7.0",
  available: false,
  version: null,
  notes: null,
  published_at: null,
  update_mode: "installer" as const,
};
const availableUpdate = {
  current_version: "0.3.5",
  available: true,
  version: "0.4.0",
  notes: "更新说明",
  published_at: "2026-07-13",
  update_mode: "installer" as const,
};

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock("@/api", () => ({
  checkForUpdates: vi.fn(),
  isDesktopRuntime: vi.fn(),
  setNativeMenuLabels: vi.fn(),
}));

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storage.clear();
    setAppLocale("zh-CN");
    scrollIntoView.mockReset();
    matchMedia.mockReset();
    matchMedia.mockReturnValue({ matches: true });
    vi.mocked(checkForUpdates).mockReset();
    vi.mocked(isDesktopRuntime).mockReset();
    vi.mocked(isDesktopRuntime).mockReturnValue(false);
    vi.mocked(setNativeMenuLabels).mockReset();
    vi.mocked(setNativeMenuLabels).mockResolvedValue();
  });

  it("未进入设置页也会在应用挂载时执行后台更新检查", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    const pinia = createPinia();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/pr", component: { template: "<div>PR 列表</div>" } }],
    });
    await router.push("/pr");
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/pr");
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(useUpdateStore(pinia).updateResult?.version).toBe("0.4.0");
    expect(useUpdateStore(pinia).updatePromptVersion).toBe("0.4.0");
    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(true);
    expect(window.__goToSettings).toBeTypeOf("function");
    expect(window.__openCommandPalette).toBeTypeOf("function");
    expect(window.__handleNativeMenuAction).toBeTypeOf("function");
    wrapper.unmount();
    expect(window.__goToSettings).toBeUndefined();
    expect(window.__openCommandPalette).toBeUndefined();
    expect(window.__handleNativeMenuAction).toBeUndefined();
  });

  it("已持久化忽略的版本在后续后台检查中不再打开更新弹窗", async () => {
    storage.set("mergebeacon:dismissed-update-version", "0.4.0");
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    const pinia = createPinia();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/pr", component: { template: "<div>PR 列表</div>" } }],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    const updates = useUpdateStore(pinia);
    expect(updates.updateResult).toEqual(availableUpdate);
    expect(updates.updatePromptVersion).toBeNull();
    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(false);
    wrapper.unmount();
  });

  it("在桌面端启动和切换语言时同步对应的原生菜单文案", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(noUpdate);
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/pr", component: { template: "<div>PR 列表</div>" } }],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    expect(setNativeMenuLabels).toHaveBeenCalledOnce();
    expect(setNativeMenuLabels).toHaveBeenLastCalledWith(
      expect.objectContaining({
        about: "关于 MergeBeacon",
        file: "文件",
        undo: "撤销",
        enter_fullscreen: "进入全屏",
        github_homepage: "GitHub 主页",
        quit: "退出 MergeBeacon",
      }),
    );

    setAppLocale("en-US");
    await flushPromises();

    expect(setNativeMenuLabels).toHaveBeenCalledTimes(2);
    expect(setNativeMenuLabels).toHaveBeenLastCalledWith(
      expect.objectContaining({
        about: "About MergeBeacon",
        file: "File",
        undo: "Undo",
        enter_fullscreen: "Enter Full Screen",
        github_homepage: "GitHub Homepage",
        quit: "Quit MergeBeacon",
      }),
    );

    wrapper.unmount();
  });

  it("原生菜单文案同步失败时记录错误而不是静默忽略", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(noUpdate);
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
    const syncError = new Error("menu IPC unavailable");
    vi.mocked(setNativeMenuLabels).mockRejectedValue(syncError);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/pr", component: { template: "<div>PR 列表</div>" } }],
    });
    await router.push("/pr");
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith("同步原生菜单文案失败", syncError);
    wrapper.unmount();
  });

  it("提示版本与更新结果版本不一致时不展示更新弹窗", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    const pinia = createPinia();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/pr", component: { template: "<div>PR 列表</div>" } }],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      global: {
        plugins: [pinia, router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    const updates = useUpdateStore(pinia);
    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(true);

    updates.updateResult = { ...availableUpdate, version: "0.5.0" };
    await flushPromises();

    expect(updates.updatePromptVersion).toBe("0.4.0");
    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(false);
    wrapper.unmount();
  });

  it("后台检查完成时不打断正在编辑的输入控件", async () => {
    let resolveCheck!: (result: typeof availableUpdate) => void;
    vi.mocked(checkForUpdates).mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const pinia = createPinia();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/editor",
          component: { template: '<input data-testid="editor" aria-label="编辑内容" />' },
        },
      ],
    });
    await router.push("/editor");
    await router.isReady();
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [pinia, router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    const editor = wrapper.get<HTMLInputElement>('[data-testid="editor"]');
    editor.element.focus();
    await flushPromises();

    resolveCheck(availableUpdate);
    await flushPromises();

    expect(useUpdateStore(pinia).updatePromptVersion).toBe("0.4.0");
    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(false);
    expect(document.activeElement).toBe(editor.element);

    editor.element.blur();
    await flushPromises();

    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(true);
    expect(document.activeElement).toBe(
      document.body.querySelector<HTMLButtonElement>(".update-dialog-primary"),
    );
    wrapper.unmount();
  });

  it("命令面板打开时挂起更新提示，关闭后再展示且禁止双模态", async () => {
    let resolveCheck!: (result: typeof availableUpdate) => void;
    vi.mocked(checkForUpdates).mockReturnValue(
      new Promise((resolve) => {
        resolveCheck = resolve;
      }),
    );
    const pinia = createPinia();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/pr", component: { template: "<div>PR 列表</div>" } }],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [pinia, router],
        stubs: { NotificationManager: true },
      },
    });

    window.__openCommandPalette?.();
    await flushPromises();
    const commandInput = document.body.querySelector<HTMLInputElement>(
      '.command-palette input[type="search"]',
    );
    expect(document.activeElement).toBe(commandInput);

    resolveCheck(availableUpdate);
    await flushPromises();

    expect(useUpdateStore(pinia).updatePromptVersion).toBe("0.4.0");
    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(false);
    expect(document.body.querySelector('[data-testid="update-available-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(commandInput);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();

    expect(document.body.querySelector(".command-palette")).toBeNull();
    expect(wrapper.getComponent(UpdateAvailableDialog).props("open")).toBe(true);
    expect(document.activeElement).toBe(
      document.body.querySelector<HTMLButtonElement>(".update-dialog-primary"),
    );

    window.__openCommandPalette?.();
    await flushPromises();
    expect(document.body.querySelector(".command-palette")).toBeNull();
    wrapper.unmount();
  });

  it("从更新提示进入设置页并关闭本次提示", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(availableUpdate);
    const pinia = createPinia();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/pr", component: { template: "<div>PR 列表</div>" } },
        {
          path: "/settings",
          component: {
            template: '<div id="settings-page-start"><section id="app-update">设置</section></div>',
          },
        },
      ],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [pinia, router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    wrapper.getComponent(UpdateAvailableDialog).vm.$emit("confirm");
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe("/settings#app-update");
    expect(useUpdateStore(pinia).updatePromptVersion).toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect((scrollIntoView.mock.instances[0] as HTMLElement).id).toBe("app-update");
    wrapper.unmount();
  });

  it("从应用菜单打开普通设置时停留在设置页顶部", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(noUpdate);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/pr", component: { template: "<div>PR 列表</div>" } },
        {
          path: "/settings",
          component: {
            template: '<div id="settings-page-start"><section id="app-update">设置</section></div>',
          },
        },
      ],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [createPinia(), router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    await window.__goToSettings?.();
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe("/settings");
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect((scrollIntoView.mock.instances[0] as HTMLElement).id).toBe("settings-page-start");
    wrapper.unmount();
  });

  it("减少动态效果时从应用菜单打开设置不使用平滑滚动", async () => {
    matchMedia.mockReturnValue({ matches: false });
    vi.mocked(checkForUpdates).mockResolvedValue(noUpdate);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/pr", component: { template: "<div>PR 列表</div>" } },
        {
          path: "/settings",
          component: { template: '<div id="settings-page-start">设置</div>' },
        },
      ],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [createPinia(), router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    await window.__goToSettings?.();
    await flushPromises();

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
    wrapper.unmount();
  });

  it("响应原生菜单的新建、检查更新和诊断操作", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(noUpdate);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/pr", component: { template: "<div>PR 列表</div>" } },
        {
          path: "/pr/new",
          name: "pr-new",
          component: { template: "<div>新建 PR</div>" },
        },
        {
          path: "/issue/new",
          name: "issue-new",
          component: { template: "<div>新建 Issue</div>" },
        },
        {
          path: "/settings",
          component: {
            template:
              '<div id="settings-page-start"><section id="app-update">更新</section><section id="diagnostics">诊断</section></div>',
          },
        },
      ],
    });
    await router.push("/pr");
    await router.isReady();
    const wrapper = mount(App, {
      attachTo: document.body,
      global: {
        plugins: [createPinia(), router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await flushPromises();

    await window.__handleNativeMenuAction?.("new-pull-request");
    expect(router.currentRoute.value.fullPath).toBe("/pr/new");

    await window.__handleNativeMenuAction?.("new-issue");
    expect(router.currentRoute.value.fullPath).toBe("/issue/new");

    await window.__handleNativeMenuAction?.("check-updates");
    expect(router.currentRoute.value.fullPath).toBe("/settings#app-update");
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect((scrollIntoView.mock.instances.at(-1) as HTMLElement).id).toBe("app-update");

    await window.__handleNativeMenuAction?.("open-diagnostics");
    expect(router.currentRoute.value.fullPath).toBe("/settings#diagnostics");
    expect((scrollIntoView.mock.instances.at(-1) as HTMLElement).id).toBe("diagnostics");

    wrapper.unmount();
  });

  it("普通参数路由变化时复用页面组件", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(noUpdate);
    const mounted = vi.fn();
    const page = {
      data: () => ({ marker: "" }),
      mounted,
      template: '<input data-testid="route-marker" v-model="marker" />',
    };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/workspace/:section", name: "workspace", component: page }],
    });
    await router.push("/workspace/first");
    await router.isReady();
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });
    await wrapper.get<HTMLInputElement>('[data-testid="route-marker"]').setValue("保留状态");

    await router.push("/workspace/second");
    await flushPromises();

    expect(mounted).toHaveBeenCalledOnce();
    expect(wrapper.get<HTMLInputElement>('[data-testid="route-marker"]').element.value).toBe(
      "保留状态",
    );
    wrapper.unmount();
  });

  it("切换 PR 详情编号时重新挂载详情组件", async () => {
    vi.mocked(checkForUpdates).mockResolvedValue(noUpdate);
    const mounted = vi.fn();
    const detailPage = { mounted, template: "<div>PR 详情</div>" };
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/pr/:platform/:owner/:repo/:number",
          name: "pr-detail",
          component: detailPage,
        },
      ],
    });
    await router.push("/pr/github/team/repo/1");
    await router.isReady();
    const wrapper = mount(App, {
      global: {
        plugins: [createPinia(), router],
        stubs: { CommandPalette: true, NotificationManager: true },
      },
    });

    await router.push("/pr/github/team/repo/2");
    await flushPromises();

    expect(mounted).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
