import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CommandPalette from "@/components/command/CommandPalette.vue";
import { repoList } from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePrStore } from "@/stores/usePrStore";
import { APP_COMMAND_EVENT, type AppCommandDetail } from "@/types/commands";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock("@/api", () => ({
  repoList: vi.fn(),
}));

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/login", name: "login", component: {} },
      { path: "/inbox", name: "review-inbox", component: {} },
      { path: "/pr", name: "pr-list", component: {} },
      { path: "/pr/:platform/:owner/:repo/:number", name: "pr-detail", component: {} },
      { path: "/issue", name: "issue-list", component: {} },
      { path: "/settings", name: "settings", component: {} },
    ],
  });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
    vi.mocked(repoList).mockReset();
    vi.mocked(repoList).mockResolvedValue({ items: [], page: 1, total_pages: 1, total_count: 0 });
  });

  it("支持快捷键打开、搜索并切换平台", async () => {
    const router = createTestRouter();
    await router.push("/pr");
    await router.isReady();
    const auth = useAuthStore();
    auth.platforms.github.isLoggedIn = true;
    auth.platforms.gitlab.isLoggedIn = true;
    const wrapper = mount(CommandPalette, {
      attachTo: document.body,
      global: { plugins: [router], stubs: { teleport: true } },
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await wrapper.get('input[type="search"]').setValue("切换到 GitLab");
    await wrapper.get(".command-item").trigger("click");
    await flushPromises();

    expect(auth.activePlatform).toBe("gitlab");
    expect(router.currentRoute.value.name).toBe("pr-list");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("在 PR 详情中提供 Diff、AI 评审和提交评审命令", async () => {
    const router = createTestRouter();
    await router.push("/pr/github/team/repo/7");
    await router.isReady();
    const pr = usePrStore();
    pr.diff = {
      diff: "diff",
      files: [
        {
          filename: "src/main.ts",
          status: "modified",
          patch: "",
          additions: 3,
          deletions: 1,
        },
      ],
      patch_schema_version: 1,
      patches: [],
    };
    const received: AppCommandDetail[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<AppCommandDetail>).detail);
    };
    window.addEventListener(APP_COMMAND_EVENT, listener);
    const wrapper = mount(CommandPalette, {
      attachTo: document.body,
      global: { plugins: [router], stubs: { teleport: true } },
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    await flushPromises();
    await wrapper.get('input[type="search"]').setValue("开始 AI 评审");
    await wrapper.get(".command-item").trigger("click");

    expect(received).toEqual([{ type: "start_ai_review" }]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    await flushPromises();
    await wrapper.get('input[type="search"]').setValue("src/main.ts");
    await wrapper.get(".command-item").trigger("click");
    expect(received.at(-1)).toEqual({ type: "open_diff_file", path: "src/main.ts" });

    wrapper.unmount();
    window.removeEventListener(APP_COMMAND_EVENT, listener);
  });

  it("支持使用 owner/repo#number 直接打开 PR", async () => {
    const router = createTestRouter();
    await router.push("/pr");
    await router.isReady();
    const auth = useAuthStore();
    auth.platforms.github.isLoggedIn = true;
    const wrapper = mount(CommandPalette, {
      attachTo: document.body,
      global: { plugins: [router], stubs: { teleport: true } },
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    await flushPromises();
    await wrapper.get('input[type="search"]').setValue("team/repo#42");
    await wrapper.get(".command-item").trigger("click");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("pr-detail");
    expect(router.currentRoute.value.params).toMatchObject({
      platform: "github",
      owner: "team",
      repo: "repo",
      number: "42",
    });
    wrapper.unmount();
  });
});
