import {
  desktopNotificationPermissionGranted,
  isDesktopRuntime,
  listenDesktopNotificationActions,
  requestDesktopNotificationPermission,
  sendDesktopNotification,
} from "@/api";
import { translate } from "@/i18n";
import type { InboxNotificationEvent, NotificationEventType } from "@/stores/useNotificationStore";
import type { Platform } from "@/types";

export interface NotificationTarget {
  platform: Platform;
  owner: string;
  repo: string;
  number: number;
}

const eventTitleKeys: Record<NotificationEventType, Parameters<typeof translate>[0]> = {
  review_request: "notification.titleReview",
  checks_completed: "notification.titleChecks",
  new_commits: "notification.titleCommits",
  new_comments: "notification.titleComments",
  mergeable: "notification.titleMergeable",
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
    : translate("notification.privateBody");
  await sendDesktopNotification({
    id: notificationId(event),
    title: translate(eventTitleKeys[event.type]),
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
    title: translate("notification.testTitle"),
    body: translate("notification.testBody"),
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
