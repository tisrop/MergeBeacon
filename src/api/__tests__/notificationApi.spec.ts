import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { sendDesktopNotification } from "@/api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  Visibility: { Private: 0, Public: 1 },
  isPermissionGranted: vi.fn(),
  onAction: vi.fn(),
  registerActionTypes: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

describe("desktop notification API", () => {
  beforeEach(() => {
    vi.mocked(sendNotification).mockReset();
  });

  it("测试通知不注册 PR action，收件箱通知保留点击动作", () => {
    sendDesktopNotification({
      id: 1,
      title: "Test",
      body: "Test body",
      group: "test",
      private: false,
      actionable: false,
      extra: {},
    });
    sendDesktopNotification({
      id: 2,
      title: "Review",
      body: "Review body",
      group: "github:team/repo:7",
      private: true,
      actionable: true,
      extra: { platform: "github", owner: "team", repo: "repo", number: 7 },
    });

    expect(sendNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        actionTypeId: undefined,
        visibility: 1,
      }),
    );
    expect(sendNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        actionTypeId: "mergebeacon-open-pr",
        visibility: 0,
      }),
    );
  });
});
