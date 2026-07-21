import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationSettings from "@/components/notification/NotificationSettings.vue";
import {
  notificationPermissionGranted,
  requestNotificationPermission,
  showDesktopTestNotification,
} from "@/services/desktopNotifications";
import { useNotificationStore } from "@/stores/useNotificationStore";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock("@/services/desktopNotifications", () => ({
  notificationPermissionGranted: vi.fn(),
  requestNotificationPermission: vi.fn(),
  showDesktopTestNotification: vi.fn(),
}));

describe("NotificationSettings", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
    vi.mocked(notificationPermissionGranted).mockReset();
    vi.mocked(requestNotificationPermission).mockReset();
    vi.mocked(showDesktopTestNotification).mockReset();
    vi.mocked(showDesktopTestNotification).mockResolvedValue(undefined);
    vi.mocked(notificationPermissionGranted).mockResolvedValue(false);
    vi.mocked(requestNotificationPermission).mockResolvedValue(true);
  });

  it("获得系统权限后启用通知，并允许按事件关闭", async () => {
    const wrapper = mount(NotificationSettings);
    await flushPromises();
    const store = useNotificationStore();

    await wrapper.get('[aria-label="启用桌面通知"]').setValue(true);
    await flushPromises();

    expect(requestNotificationPermission).toHaveBeenCalledOnce();
    expect(store.preferences.enabled).toBe(true);
    expect(store.preferences.hide_private_content).toBe(true);

    const eventInputs = wrapper.findAll(".event-row input");
    await eventInputs[0].setValue(false);
    expect(store.preferences.events.review_request).toBe(false);
  });

  it("权限被拒绝时保持关闭并显示说明", async () => {
    vi.mocked(requestNotificationPermission).mockResolvedValue(false);
    const wrapper = mount(NotificationSettings);
    await flushPromises();

    await wrapper.get('[aria-label="启用桌面通知"]').setValue(true);
    await flushPromises();

    expect(useNotificationStore().preferences.enabled).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain("系统未授予通知权限");
  });

  it("权限 API 异常时同时更新设置页和全局通知错误", async () => {
    vi.mocked(notificationPermissionGranted).mockRejectedValue(new Error("permission unavailable"));

    const wrapper = mount(NotificationSettings);
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain("permission unavailable");
    expect(useNotificationStore().notificationError).toContain("permission unavailable");
  });

  it("设置页检测到系统权限被撤销时停止通知轮询并提示重新授权", async () => {
    const store = useNotificationStore();
    store.setEnabled(true);

    const wrapper = mount(NotificationSettings);
    await flushPromises();

    expect(store.preferences.enabled).toBe(false);
    expect(store.showNotificationError).toBe(true);
    expect(wrapper.get('[role="alert"]').text()).toContain("权限已被撤销");
  });

  it("权限有效时发送不请求平台 API 的系统测试通知", async () => {
    vi.mocked(notificationPermissionGranted).mockResolvedValue(true);
    const wrapper = mount(NotificationSettings);
    await flushPromises();

    await wrapper.get(".test-notification-button").trigger("click");
    await flushPromises();

    expect(showDesktopTestNotification).toHaveBeenCalledOnce();
    expect(wrapper.get(".test-notification-status").text()).toContain("已交给系统通知服务");
  });

  it("测试通知发送失败时写入全局通知错误", async () => {
    vi.mocked(notificationPermissionGranted).mockResolvedValue(true);
    vi.mocked(showDesktopTestNotification).mockRejectedValue(
      new Error("notification daemon unavailable"),
    );
    const wrapper = mount(NotificationSettings);
    await flushPromises();

    await wrapper.get(".test-notification-button").trigger("click");
    await flushPromises();

    expect(wrapper.get(".test-notification-status").text()).toContain(
      "notification daemon unavailable",
    );
    expect(useNotificationStore().notificationError).toContain("notification daemon unavailable");
  });

  it("发送测试通知前权限被撤销时写入 permission 错误通道", async () => {
    vi.mocked(notificationPermissionGranted)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const wrapper = mount(NotificationSettings);
    await flushPromises();
    const store = useNotificationStore();

    await wrapper.get(".test-notification-button").trigger("click");
    await flushPromises();

    expect(showDesktopTestNotification).not.toHaveBeenCalled();
    expect(store.preferences.enabled).toBe(false);
    expect(store.notificationError).toContain("权限不可用或已被撤销");
    store.clearManagerError("permission");
    expect(store.notificationError).not.toContain("权限不可用或已被撤销");
  });

  it("展示平台限流类别、连续异常次数和重试倒计时", async () => {
    const store = useNotificationStore();
    store.pollObservations.github = {
      last_attempt_at: 1_000_000,
      last_success_at: 900_000,
      outcome: "partial",
      successful_categories: ["authored"],
      failed_categories: ["review_requested"],
      rate_limited_categories: ["review_requested"],
      consecutive_degraded_polls: 3,
      rate_limited_polls: 2,
    };
    store.rateLimitedUntil.github = 1_900_000;
    store.updateClock(1_000_000);

    const wrapper = mount(NotificationSettings);
    await flushPromises();

    const githubStatus = wrapper.get(".setting-grid .choice-row").text();
    expect(githubStatus).toContain("限流退避");
    expect(githubStatus).toContain("15:00 后重试");
    expect(githubStatus).toContain("评审请求限流");
    expect(githubStatus).toContain("连续异常 3 次");
    expect(githubStatus).toContain("本次运行限流 2 次");
  });
});
