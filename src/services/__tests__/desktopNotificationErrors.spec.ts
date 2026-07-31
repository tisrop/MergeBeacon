import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAppLocale } from "@/i18n";
import { getDesktopNotificationErrorMessage } from "@/services/desktopNotificationErrors";

const backendPrefixes = [
  "读取 macOS 通知权限失败：",
  "读取系统通知权限失败：",
  "请求 macOS 通知权限失败：",
  "请求系统通知权限失败：",
  "发送 macOS 通知失败：",
  "发送系统通知失败：",
] as const;

describe("desktopNotificationErrors", () => {
  beforeEach(() => setAppLocale("en-US"));
  afterEach(() => setAppLocale("zh-CN"));

  it.each(backendPrefixes)("英文界面剥离已知后端中文前缀：%s", (prefix) => {
    expect(
      getDesktopNotificationErrorMessage(new Error(`${prefix}native error 1`), "fallback"),
    ).toBe("native error 1");
  });

  it("已知前缀后没有错误详情时使用本地化回退文案", () => {
    expect(
      getDesktopNotificationErrorMessage(
        new Error("读取 macOS 通知权限失败：  "),
        "System unavailable",
      ),
    ).toBe("System unavailable");
  });

  it("英文界面保留未知错误正文，避免误删不相关内容", () => {
    expect(getDesktopNotificationErrorMessage(new Error("通知服务返回未知错误"), "fallback")).toBe(
      "通知服务返回未知错误",
    );
  });

  it("中文界面保留后端操作上下文", () => {
    setAppLocale("zh-CN");

    expect(
      getDesktopNotificationErrorMessage(
        new Error("读取 macOS 通知权限失败：UNErrorDomain error 1"),
        "系统通知服务暂不可用",
      ),
    ).toBe("读取 macOS 通知权限失败：UNErrorDomain error 1");
  });

  it("没有可用错误时返回调用方提供的回退文案", () => {
    expect(getDesktopNotificationErrorMessage(null, "System unavailable")).toBe(
      "System unavailable",
    );
  });
});
