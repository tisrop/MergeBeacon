import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NotificationManager from "@/components/notification/NotificationManager.vue";
import {
  initializeNotificationActions,
  notificationPermissionGranted,
  showInboxNotification,
  type NotificationTarget,
} from "@/services/desktopNotifications";
import { useAuthStore } from "@/stores/useAuthStore";
import { useNotificationStore, NOTIFICATION_POLL_INTERVAL_MS } from "@/stores/useNotificationStore";
import { useRepoStore } from "@/stores/useRepoStore";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock("@/services/desktopNotifications", () => ({
  initializeNotificationActions: vi.fn(),
  notificationPermissionGranted: vi.fn(),
  showInboxNotification: vi.fn(),
}));

const notificationEvent = {
  type: "new_commits" as const,
  platform: "github" as const,
  owner: "team",
  repo: "repo",
  repository_full_name: "team/repo",
  number: 7,
  title: "Update dependency",
};

async function mountManager(pinia = createPinia()) {
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/pr", name: "pr-list", component: {} },
      { path: "/pr/:platform/:owner/:repo/:number", name: "pr-detail", component: {} },
    ],
  });
  await router.push("/pr");
  await router.isReady();
  const auth = useAuthStore();
  auth.platforms.github.isLoggedIn = true;
  const notifications = useNotificationStore();
  notifications.setEnabled(true);
  const wrapper = mount(NotificationManager, { global: { plugins: [pinia, router] } });
  await flushPromises();
  return { wrapper, router, notifications };
}

describe("NotificationManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    storage.clear();
    vi.mocked(notificationPermissionGranted).mockReset();
    vi.mocked(notificationPermissionGranted).mockResolvedValue(true);
    vi.mocked(showInboxNotification).mockReset();
    vi.mocked(initializeNotificationActions).mockReset();
    vi.mocked(initializeNotificationActions).mockResolvedValue(async () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("定时轮询、处理通知点击并在卸载后清理资源", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const repo = useRepoStore();
    repo.reposCache.github = [
      {
        id: 1,
        name: "repo",
        full_name: "team/repo",
        owner: "team",
        owner_type: "organization",
        owner_display_name: "Team",
        description: "",
        private: false,
        fork: false,
        parent_full_name: null,
        parent_owner: null,
      },
    ];
    const notifications = useNotificationStore();
    notifications.setEnabled(true);
    const poll = vi.spyOn(notifications, "poll").mockResolvedValue([notificationEvent]);
    const cleanup = vi.fn();
    let openTarget: ((target: NotificationTarget) => void | Promise<void>) | null = null;
    vi.mocked(initializeNotificationActions).mockImplementation(async (callback) => {
      openTarget = callback;
      return async () => cleanup();
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/pr", name: "pr-list", component: {} },
        { path: "/pr/:platform/:owner/:repo/:number", name: "pr-detail", component: {} },
      ],
    });
    await router.push("/pr");
    await router.isReady();
    const auth = useAuthStore();
    auth.platforms.github.isLoggedIn = true;
    const wrapper = mount(NotificationManager, { global: { plugins: [pinia, router] } });
    await flushPromises();

    expect(poll).toHaveBeenCalledWith(["github"]);
    expect(showInboxNotification).toHaveBeenCalledWith(notificationEvent, true);

    vi.mocked(showInboxNotification).mockClear();
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(showInboxNotification).toHaveBeenCalledOnce();

    const invokeTarget = openTarget as unknown as (target: NotificationTarget) => Promise<void>;
    await invokeTarget({ platform: "github", owner: "team", repo: "repo", number: 7 });
    expect(router.currentRoute.value.name).toBe("pr-detail");
    expect(router.currentRoute.value.params.number).toBe("7");

    wrapper.unmount();
    await flushPromises();
    expect(cleanup).toHaveBeenCalledOnce();
    poll.mockClear();
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(poll).not.toHaveBeenCalled();
  });

  it("权限被撤销时展示全局错误且不启动轮询", async () => {
    vi.mocked(notificationPermissionGranted).mockResolvedValue(false);
    const pinia = createPinia();
    setActivePinia(pinia);
    const notifications = useNotificationStore();
    const poll = vi.spyOn(notifications, "poll");

    const { wrapper } = await mountManager(pinia);

    expect(useNotificationStore().notificationError).toContain("通知权限不可用或已被撤销");
    expect(useNotificationStore().preferences.enabled).toBe(false);
    expect(useNotificationStore().showNotificationError).toBe(true);
    expect(poll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(notificationPermissionGranted).toHaveBeenCalledOnce();
    expect(poll).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("轮询和通知发送异常不会被静默丢弃", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const notifications = useNotificationStore();
    vi.spyOn(notifications, "poll")
      .mockRejectedValueOnce(new Error("network poll failed"))
      .mockResolvedValueOnce([notificationEvent]);

    const { wrapper } = await mountManager(pinia);
    expect(useNotificationStore().notificationError).toContain("network poll failed");

    vi.mocked(showInboxNotification).mockImplementation(() => {
      throw new Error("system delivery failed");
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);

    expect(useNotificationStore().notificationError).toContain("system delivery failed");
    wrapper.unmount();
  });

  it("点击监听初始化失败后仍保持轮询和倒计时 timer 生命周期", async () => {
    vi.mocked(initializeNotificationActions).mockRejectedValue(new Error("listener unavailable"));
    const pinia = createPinia();
    setActivePinia(pinia);
    const notifications = useNotificationStore();
    const poll = vi.spyOn(notifications, "poll").mockResolvedValue([]);
    const updateClock = vi.spyOn(notifications, "updateClock");

    const { wrapper } = await mountManager(pinia);
    expect(useNotificationStore().notificationError).toContain("listener unavailable");
    expect(poll).toHaveBeenCalledOnce();

    poll.mockClear();
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(poll).toHaveBeenCalledOnce();
    expect(updateClock).toHaveBeenCalled();

    wrapper.unmount();
    poll.mockClear();
    updateClock.mockClear();
    await vi.advanceTimersByTimeAsync(NOTIFICATION_POLL_INTERVAL_MS);
    expect(poll).not.toHaveBeenCalled();
    expect(updateClock).not.toHaveBeenCalled();
  });
});
