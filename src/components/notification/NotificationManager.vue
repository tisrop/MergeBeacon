<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePrStore } from "@/stores/usePrStore";
import { useRepoStore } from "@/stores/useRepoStore";
import {
  NOTIFICATION_POLL_INTERVAL_MS,
  useNotificationStore,
  type InboxNotificationEvent,
} from "@/stores/useNotificationStore";
import {
  initializeNotificationActions,
  notificationPermissionGranted,
  showInboxNotification,
  type NotificationTarget,
} from "@/services/desktopNotifications";
import { getDesktopNotificationErrorMessage } from "@/services/desktopNotificationErrors";
import type { Platform } from "@/types";
import { getErrorMessage } from "@/utils/error";

const router = useRouter();
const auth = useAuthStore();
const pr = usePrStore();
const repo = useRepoStore();
const notifications = useNotificationStore();
const { t } = useI18n();

const availablePlatforms = computed<Platform[]>(() =>
  (["github", "gitlab", "gitee"] as Platform[]).filter(
    (platform) =>
      auth.platforms[platform].isLoggedIn &&
      auth.platformVisibility[platform] &&
      notifications.preferences.platforms[platform],
  ),
);

async function openNotificationTarget(target: NotificationTarget): Promise<void> {
  if (!auth.platforms[target.platform].isLoggedIn) return;
  auth.setActivePlatform(target.platform);
  repo.setActiveRepo(target.owner, target.repo, target.platform);
  repo.setForkContext(null, target.platform);
  pr.clearContext();
  await router.push({
    name: "pr-detail",
    params: {
      platform: target.platform,
      owner: target.owner,
      repo: target.repo,
      number: target.number,
    },
  });
}

async function pollAndNotify(): Promise<void> {
  if (!notifications.preferences.enabled || availablePlatforms.value.length === 0) {
    return;
  }
  if (navigator.onLine === false) {
    notifications.setManagerError("network", () => t("notification.managerNetworkOffline"));
    return;
  }
  notifications.clearManagerError("network");

  let permissionGranted: boolean;
  try {
    permissionGranted = await notificationPermissionGranted();
  } catch (error) {
    notifications.setManagerError("permission", () =>
      t("notification.checkPermissionFailed", {
        message: getDesktopNotificationErrorMessage(error, t("notification.systemUnavailable")),
      }),
    );
    return;
  }
  if (!permissionGranted) {
    notifications.setEnabled(false);
    notifications.setManagerError("permission", () => t("notification.managerPermissionRevoked"));
    return;
  }
  notifications.clearManagerError("permission");

  let events: InboxNotificationEvent[];
  try {
    events = await notifications.poll(availablePlatforms.value);
    notifications.clearManagerError("poll");
  } catch (error) {
    notifications.setManagerError("poll", () =>
      t("notification.managerPollFailed", {
        message: getErrorMessage(error, t("notification.retryLater")),
      }),
    );
    return;
  }
  if (!notifications.preferences.enabled) return;
  let deliveryFailed = false;
  for (const event of events) {
    if (!auth.platforms[event.platform].isLoggedIn) continue;
    const repository = repo.reposCache[event.platform].find(
      (candidate) => candidate.full_name === event.repository_full_name,
    );
    const revealDetails =
      !notifications.preferences.hide_private_content || repository?.private === false;
    try {
      await showInboxNotification(event, revealDetails);
    } catch (error) {
      deliveryFailed = true;
      notifications.setManagerError("delivery", () =>
        t("notification.deliveryFailed", {
          message: getDesktopNotificationErrorMessage(error, t("notification.systemUnavailable")),
        }),
      );
    }
  }
  if (!deliveryFailed) notifications.clearManagerError("delivery");
}

let timer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let removeActionListener: (() => Promise<void>) | null = null;
let disposed = false;

onMounted(() => {
  timer = setInterval(() => void pollAndNotify(), NOTIFICATION_POLL_INTERVAL_MS);
  clockTimer = setInterval(() => notifications.updateClock(), 1000);
  window.addEventListener("online", pollAndNotify);
  void pollAndNotify();
  void initializeNotificationActions(openNotificationTarget)
    .then(async (removeListener) => {
      if (disposed) {
        await removeListener();
        return;
      }
      removeActionListener = removeListener;
      notifications.clearManagerError("actions");
    })
    .catch((error) => {
      if (disposed) return;
      notifications.setManagerError("actions", () =>
        t("notification.managerActionInitFailed", {
          message: getErrorMessage(error, t("notification.actionListenUnavailable")),
        }),
      );
    });
});

watch(
  [() => notifications.preferences.enabled, () => availablePlatforms.value.join(",")],
  () => void pollAndNotify(),
);

onUnmounted(() => {
  disposed = true;
  if (timer) clearInterval(timer);
  if (clockTimer) clearInterval(clockTimer);
  window.removeEventListener("online", pollAndNotify);
  if (removeActionListener) {
    void removeActionListener().catch((error) => {
      notifications.setManagerError("actions", () =>
        t("notification.managerActionCleanupFailed", {
          message: getErrorMessage(error, t("notification.actionStopUnavailable")),
        }),
      );
    });
  }
});
</script>

<template><span class="notification-manager" aria-hidden="true" /></template>

<style scoped src="./NotificationManager.css"></style>
