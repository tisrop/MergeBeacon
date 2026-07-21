import {
  desktopNotificationPermissionGranted,
  isDesktopRuntime,
  listenDesktopNotificationActions,
  requestDesktopNotificationPermission,
  sendDesktopNotification,
} from "@/api";
import type { InboxNotificationEvent, NotificationEventType } from "@/stores/useNotificationStore";
import type { Platform } from "@/types";

export interface NotificationTarget {
  platform: Platform;
  owner: string;
  repo: string;
  number: number;
}

const eventTitles: Record<NotificationEventType, string> = {
  review_request: "新的评审请求",
  checks_completed: "CI/测试已完成",
  new_commits: "Pull Request 有新提交",
  new_comments: "Pull Request 有新评论",
  mergeable: "Pull Request 已可合并",
};

const TEST_NOTIFICATION_ID = 1_977_042_301;

function notificationId(event: InboxNotificationEvent): number {
  const value = `${event.type}:${event.platform}:${event.repository_full_name}:${event.number}`;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function targetFromExtra(extra: Record<string, unknown> | undefined): NotificationTarget | null {
  const platform = extra?.platform;
  const owner = extra?.owner;
  const repo = extra?.repo;
  const number = Number(extra?.number);
  if (
    (platform !== "github" && platform !== "gitlab" && platform !== "gitee") ||
    typeof owner !== "string" ||
    typeof repo !== "string" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    return null;
  }
  return { platform, owner, repo, number };
}

export async function notificationPermissionGranted(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  return desktopNotificationPermissionGranted();
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isDesktopRuntime()) return false;
  if (await desktopNotificationPermissionGranted()) return true;
  return requestDesktopNotificationPermission();
}

export async function showInboxNotification(
  event: InboxNotificationEvent,
  revealRepositoryDetails: boolean,
): Promise<void> {
  if (!isDesktopRuntime()) return;
  const body = revealRepositoryDetails
    ? `${event.repository_full_name} #${event.number} · ${event.title}`
    : "某个私有仓库的 Pull Request 有新动态";
  await sendDesktopNotification({
    id: notificationId(event),
    title: eventTitles[event.type],
    body,
    group: `${event.platform}:${event.repository_full_name}:${event.number}`,
    actionable: true,
    extra: {
      platform: event.platform,
      owner: event.owner,
      repo: event.repo,
      number: event.number,
    },
  });
}

export async function showDesktopTestNotification(): Promise<void> {
  if (!isDesktopRuntime()) return;
  await sendDesktopNotification({
    id: TEST_NOTIFICATION_ID,
    title: "MergeBeacon 测试通知",
    body: "系统通知已连接。退出 MergeBeacon 后不会继续检查 PR / MR 动态。",
    group: "mergebeacon:test",
    actionable: false,
    extra: {},
  });
}

export async function initializeNotificationActions(
  openTarget: (target: NotificationTarget) => void | Promise<void>,
): Promise<() => Promise<void>> {
  if (!isDesktopRuntime()) return async () => undefined;
  const unlisten = await listenDesktopNotificationActions((extra) => {
    const target = targetFromExtra(extra);
    if (target) void openTarget(target);
  });
  return async () => unlisten();
}
