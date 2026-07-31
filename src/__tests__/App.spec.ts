import { createPinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdates } from "@/api";
import UpdateAvailableDialog from "@/components/update/UpdateAvailableDialog.vue";
import { useUpdateStore } from "@/stores/useUpdateStore";
import App from "../App.vue";

const storage = new Map<string, string>();
const scrollIntoView = vi.fn();

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: scrollIntoView,
});
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
}));

describe("App", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    storage.clear();
    scrollIntoView.mockReset();
    vi.mocked(checkForUpdates).mockReset();
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
    wrapper.unmount();
    expect(window.__goToSettings).toBeUndefined();
    expect(window.__openCommandPalette).toBeUndefined();
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
