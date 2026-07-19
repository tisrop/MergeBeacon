import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import AppLayout from "@/components/layout/AppLayout.vue";
import { useNotificationStore } from "@/stores/useNotificationStore";

const storage = new Map<string, string>();

function mountLayout() {
  return mount(AppLayout, {
    global: {
      stubs: {
        Sidebar: true,
        RouterLink: {
          props: ["to"],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  });
}

describe("AppLayout", () => {
  beforeEach(() => {
    storage.clear();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
        clear: () => storage.clear(),
      },
    });
    setActivePinia(createPinia());
  });

  it("通知启用且发生错误时展示不可关闭的全局 banner 和 429 倒计时", () => {
    const notifications = useNotificationStore();
    notifications.setEnabled(true);
    notifications.setManagerError("poll", "后台轮询失败");
    notifications.errors.github = "HTTP 429 rate limit";
    notifications.rateLimitedUntil.github = 65_000;
    notifications.updateClock(0);

    const wrapper = mountLayout();
    const banner = wrapper.get('[role="alert"]');

    expect(banner.text()).toContain("桌面通知异常");
    expect(banner.text()).toContain("后台轮询失败");
    expect(banner.text()).toContain("GitHub 将在 1:05 后重试");
    expect(banner.get("a").attributes("href")).toBe("/settings");
    expect(banner.find("button").exists()).toBe(false);
  });

  it("通知关闭时不展示遗留错误", () => {
    const notifications = useNotificationStore();
    notifications.setManagerError("poll", "后台轮询失败");

    const wrapper = mountLayout();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("权限被撤销而自动停用通知后仍展示重新授权提示", () => {
    const notifications = useNotificationStore();
    notifications.setManagerError("permission", "桌面通知权限已被撤销");

    const wrapper = mountLayout();

    expect(notifications.preferences.enabled).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain("桌面通知权限已被撤销");
  });
});
