import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationSettings from "@/components/notification/NotificationSettings.vue";
import {
  notificationPermissionGranted,
  requestNotificationPermission,
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
}));

describe("NotificationSettings", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
    vi.mocked(notificationPermissionGranted).mockReset();
    vi.mocked(requestNotificationPermission).mockReset();
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
});
