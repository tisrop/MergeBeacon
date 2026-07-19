import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  desktopNotificationPermissionGranted,
  isDesktopRuntime,
  listenDesktopNotificationActions,
  sendDesktopNotification,
} from "@/api";
import {
  initializeNotificationActions,
  notificationPermissionGranted,
  showInboxNotification,
} from "@/services/desktopNotifications";

vi.mock("@/api", () => ({
  isDesktopRuntime: vi.fn(),
  desktopNotificationPermissionGranted: vi.fn(),
  requestDesktopNotificationPermission: vi.fn(),
  listenDesktopNotificationActions: vi.fn(),
  sendDesktopNotification: vi.fn(),
}));

const event = {
  type: "new_comments" as const,
  platform: "github" as const,
  owner: "private-team",
  repo: "secret",
  repository_full_name: "private-team/secret",
  number: 7,
  title: "Do not expose this title",
};

describe("desktopNotifications", () => {
  beforeEach(() => {
    vi.mocked(isDesktopRuntime).mockReturnValue(true);
    vi.mocked(sendDesktopNotification).mockReset();
    vi.mocked(listenDesktopNotificationActions).mockReset();
    vi.mocked(desktopNotificationPermissionGranted).mockReset();
  });

  it("私有仓库通知不包含仓库名和标题", () => {
    showInboxNotification(event, false);

    expect(sendDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Pull Request 有新评论",
        body: "某个私有仓库的 Pull Request 有新动态",
        private: true,
        extra: { platform: "github", owner: "private-team", repo: "secret", number: 7 },
      }),
    );
    const payload = vi.mocked(sendDesktopNotification).mock.calls[0][0];
    expect(payload.body).not.toContain("private-team");
    expect(payload.body).not.toContain("Do not expose");
  });

  it("通知点击只接受完整合法的 PR 定位信息", async () => {
    let action: ((extra: Record<string, unknown>) => void) | null = null;
    vi.mocked(listenDesktopNotificationActions).mockImplementation(async (callback) => {
      action = callback;
      const unlisten: Awaited<ReturnType<typeof listenDesktopNotificationActions>> = () =>
        undefined;
      return unlisten;
    });
    const openTarget = vi.fn();
    await initializeNotificationActions(openTarget);

    const invokeAction = action as unknown as (extra: Record<string, unknown>) => void;
    invokeAction({ platform: "github", owner: "team", repo: "repo", number: 9 });
    invokeAction({ platform: "unknown", owner: "team", repo: "repo", number: 9 });

    expect(openTarget).toHaveBeenCalledOnce();
    expect(openTarget).toHaveBeenCalledWith({
      platform: "github",
      owner: "team",
      repo: "repo",
      number: 9,
    });
  });

  it("向调用方暴露权限检查和点击监听错误", async () => {
    vi.mocked(desktopNotificationPermissionGranted).mockRejectedValue(new Error("permission API"));
    vi.mocked(listenDesktopNotificationActions).mockRejectedValue(new Error("action listener"));

    await expect(notificationPermissionGranted()).rejects.toThrow("permission API");
    await expect(initializeNotificationActions(vi.fn())).rejects.toThrow("action listener");
  });
});
