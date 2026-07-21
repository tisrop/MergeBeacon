import { beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import {
  desktopNotificationPermissionGranted,
  listenDesktopNotificationActions,
  requestDesktopNotificationPermission,
  sendDesktopNotification,
} from "@/api";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));
describe("desktop notification API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    vi.mocked(listen).mockReset();
  });

  it("权限和发送统一通过自定义 IPC 命令调用原生实现", async () => {
    invokeMock.mockResolvedValue(undefined);
    await desktopNotificationPermissionGranted();
    await requestDesktopNotificationPermission();
    await sendDesktopNotification({
      id: 1,
      title: "Test",
      body: "Test body",
      group: "test",
      actionable: false,
      extra: {},
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "desktop_notification_permission_granted");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "desktop_notification_request_permission");
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "desktop_notification_send",
      expect.objectContaining({
        payload: expect.objectContaining({ actionable: false }),
      }),
    );
  });

  it("使用标准 Tauri 事件监听原生通知点击", async () => {
    const unlisten = vi.fn();
    let eventHandler: ((event: { payload: Record<string, unknown> }) => void) | undefined;
    vi.mocked(listen).mockImplementation(async (_event, callback) => {
      eventHandler = callback as typeof eventHandler;
      return unlisten;
    });
    const callback = vi.fn();

    const remove = await listenDesktopNotificationActions(callback);
    eventHandler?.({ payload: { platform: "github", number: 7 } });
    remove();

    expect(listen).toHaveBeenCalledWith("desktop-notification-action", expect.any(Function));
    expect(callback).toHaveBeenCalledWith({ platform: "github", number: 7 });
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
