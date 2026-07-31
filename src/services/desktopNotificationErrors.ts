import { currentLocale } from "@/i18n";
import { getErrorMessage } from "@/utils/error";

const LOCALIZED_BACKEND_PREFIXES = [
  "读取 macOS 通知权限失败：",
  "读取系统通知权限失败：",
  "请求 macOS 通知权限失败：",
  "请求系统通知权限失败：",
  "发送 macOS 通知失败：",
  "发送系统通知失败：",
] as const;

export function getDesktopNotificationErrorMessage(error: unknown, fallback: string): string {
  const message = getErrorMessage(error, fallback);
  const backendMessage = message.startsWith("Error: ") ? message.slice("Error: ".length) : message;
  if (currentLocale() !== "en-US") return backendMessage;

  const prefix = LOCALIZED_BACKEND_PREFIXES.find((candidate) =>
    backendMessage.startsWith(candidate),
  );
  if (!prefix) return backendMessage;

  return backendMessage.slice(prefix.length).trim() || fallback;
}
