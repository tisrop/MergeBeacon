<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { currentLocale, useI18n } from "@/i18n";
import {
  notificationPermissionGranted,
  requestNotificationPermission,
  showDesktopTestNotification,
} from "@/services/desktopNotifications";
import { getDesktopNotificationErrorMessage } from "@/services/desktopNotificationErrors";
import { useNotificationStore, type NotificationEventType } from "@/stores/useNotificationStore";
import type { Platform } from "@/types";

const notifications = useNotificationStore();
const { t } = useI18n();
const permissionGranted = ref(false);
const requestingPermission = ref(false);
const permissionError = computed(() => notifications.permissionError);
const sendingTestNotification = ref(false);
const testNotificationStatus = ref("");
const testNotificationFailed = ref(false);

const platforms: Array<{ value: Platform; label: string }> = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "gitee", label: "Gitee" },
];
const events = computed<Array<{ value: NotificationEventType; label: string; hint: string }>>(
  () => [
    {
      value: "review_request",
      label: t("notification.eventReview"),
      hint: t("notification.eventReviewHint"),
    },
    {
      value: "checks_completed",
      label: t("notification.eventChecks"),
      hint: t("notification.eventChecksHint"),
    },
    {
      value: "new_commits",
      label: t("notification.eventCommits"),
      hint: t("notification.eventCommitsHint"),
    },
    {
      value: "new_comments",
      label: t("notification.eventComments"),
      hint: t("notification.eventCommentsHint"),
    },
    {
      value: "mergeable",
      label: t("notification.eventMergeable"),
      hint: t("notification.eventMergeableHint"),
    },
  ],
);
const categoryLabels = computed(() => ({
  review_requested: t("notification.categoryReviewRequested"),
  authored: t("notification.categoryAuthored"),
}));

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatTime(timestamp: number | null): string {
  if (timestamp == null) return t("notification.never");
  return new Date(timestamp).toLocaleTimeString(currentLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function platformStatus(platform: Platform): string {
  const observation = notifications.pollObservations[platform];
  const retrySeconds = notifications.retryCountdown[platform];
  if (!notifications.preferences.platforms[platform]) return t("notification.platformDisabled");
  if (retrySeconds > 0) {
    return t("notification.platformRetry", { countdown: formatCountdown(retrySeconds) });
  }
  if (observation.outcome === "success") return t("notification.checkNormal");
  if (observation.outcome === "partial") return t("notification.checkPartial");
  if (observation.outcome === "rate_limited") return t("notification.platformLimited");
  if (observation.outcome === "failed") return t("notification.checkFailed");
  return t("notification.platformWaiting");
}

function platformStatusDetail(platform: Platform): string {
  const observation = notifications.pollObservations[platform];
  if (observation.last_attempt_at == null) return t("notification.noPlatformRequest");
  const detail = [t("notification.lastAttempt", { time: formatTime(observation.last_attempt_at) })];
  if (
    observation.last_success_at != null &&
    observation.last_success_at !== observation.last_attempt_at
  ) {
    detail.push(t("notification.lastSuccess", { time: formatTime(observation.last_success_at) }));
  }
  if (observation.rate_limited_categories.length > 0) {
    detail.push(
      t("notification.rateLimitedCategories", {
        categories: observation.rate_limited_categories
          .map((category) => categoryLabels.value[category])
          .join(currentLocale() === "zh-CN" ? "、" : ", "),
      }),
    );
  }
  const failedCategories = observation.failed_categories.filter(
    (category) => !observation.rate_limited_categories.includes(category),
  );
  if (failedCategories.length > 0) {
    detail.push(
      t("notification.failedCategories", {
        categories: failedCategories
          .map((category) => categoryLabels.value[category])
          .join(currentLocale() === "zh-CN" ? "、" : ", "),
      }),
    );
  }
  if (observation.consecutive_degraded_polls > 1) {
    detail.push(
      t("notification.consecutiveDegraded", {
        count: observation.consecutive_degraded_polls,
      }),
    );
  }
  if (observation.rate_limited_polls > 0) {
    detail.push(t("notification.rateLimitedPolls", { count: observation.rate_limited_polls }));
  }
  return detail.join(" · ");
}

function platformStatusDegraded(platform: Platform): boolean {
  const outcome = notifications.pollObservations[platform].outcome;
  return (
    notifications.retryCountdown[platform] > 0 ||
    outcome === "partial" ||
    outcome === "rate_limited" ||
    outcome === "failed"
  );
}

onMounted(async () => {
  try {
    permissionGranted.value = await notificationPermissionGranted();
    if (!permissionGranted.value && notifications.preferences.enabled) {
      notifications.setEnabled(false);
      notifications.setManagerError("permission", () => t("notification.permissionRevoked"));
    } else if (!permissionGranted.value && notifications.permissionError) {
      return;
    } else {
      notifications.clearManagerError("permission");
    }
  } catch (error) {
    notifications.setManagerError("permission", () =>
      t("notification.checkPermissionFailed", {
        message: getDesktopNotificationErrorMessage(error, t("notification.systemUnavailable")),
      }),
    );
  }
});

async function setEnabled(event: Event): Promise<void> {
  const enabled = (event.target as HTMLInputElement).checked;
  notifications.clearManagerError("permission");
  if (!enabled) {
    notifications.setEnabled(false);
    notifications.clearManagerError("permission");
    return;
  }
  requestingPermission.value = true;
  try {
    permissionGranted.value = await requestNotificationPermission();
    if (permissionGranted.value) {
      notifications.clearManagerError("permission");
      notifications.setEnabled(true);
    } else {
      notifications.setManagerError("permission", () => t("notification.permissionDenied"));
    }
  } catch (error) {
    notifications.setManagerError("permission", () =>
      t("notification.checkPermissionFailed", {
        message: getDesktopNotificationErrorMessage(error, t("notification.systemUnavailable")),
      }),
    );
  } finally {
    requestingPermission.value = false;
  }
}

async function sendTestNotification(): Promise<void> {
  if (sendingTestNotification.value) return;
  sendingTestNotification.value = true;
  testNotificationStatus.value = "";
  testNotificationFailed.value = false;
  try {
    try {
      permissionGranted.value = await notificationPermissionGranted();
    } catch (error) {
      testNotificationFailed.value = true;
      notifications.setManagerError("permission", () =>
        t("notification.checkPermissionFailed", {
          message: getDesktopNotificationErrorMessage(error, t("notification.systemUnavailable")),
        }),
      );
      testNotificationStatus.value = notifications.permissionError;
      return;
    }
    if (!permissionGranted.value) {
      notifications.setEnabled(false);
      testNotificationFailed.value = true;
      notifications.setManagerError("permission", () => t("notification.permissionUnavailable"));
      testNotificationStatus.value = notifications.permissionError;
      return;
    }
    notifications.clearManagerError("permission");
    try {
      await showDesktopTestNotification();
      notifications.clearManagerError("delivery");
      testNotificationStatus.value = t("notification.testDelivered");
    } catch (error) {
      testNotificationFailed.value = true;
      testNotificationStatus.value = t("notification.testDeliveryFailed", {
        message: getDesktopNotificationErrorMessage(error, t("notification.systemUnavailable")),
      });
      notifications.setManagerError("delivery", () =>
        t("notification.testDeliveryFailed", {
          message: getDesktopNotificationErrorMessage(error, t("notification.systemUnavailable")),
        }),
      );
    }
  } finally {
    sendingTestNotification.value = false;
  }
}

function setPlatform(platform: Platform, event: Event): void {
  notifications.setPlatformEnabled(platform, (event.target as HTMLInputElement).checked);
}

function setEvent(type: NotificationEventType, event: Event): void {
  notifications.setEventEnabled(type, (event.target as HTMLInputElement).checked);
}
</script>

<template>
  <div class="notification-settings">
    <div class="setting-row primary-row">
      <span>
        <span class="setting-label">{{ t("notification.toggle") }}</span>
        <span class="setting-hint">{{ t("notification.toggleHint") }}</span>
      </span>
      <label class="toggle">
        <input
          type="checkbox"
          :aria-label="t('notification.toggle')"
          :checked="notifications.preferences.enabled && permissionGranted"
          :disabled="requestingPermission"
          @change="setEnabled"
        />
        <span class="toggle-slider" />
      </label>
    </div>

    <p v-if="permissionError" class="permission-error" role="alert">{{ permissionError }}</p>

    <div class="test-notification-row">
      <span>
        <span class="setting-label">{{ t("notification.test") }}</span>
        <span class="setting-hint">{{ t("notification.testHint") }}</span>
      </span>
      <button
        type="button"
        class="test-notification-button"
        :disabled="sendingTestNotification || !permissionGranted"
        @click="sendTestNotification"
      >
        {{ sendingTestNotification ? t("notification.testSending") : t("notification.testSend") }}
      </button>
    </div>
    <p
      v-if="testNotificationStatus"
      class="test-notification-status"
      :class="{ error: testNotificationFailed }"
      role="status"
      aria-live="polite"
    >
      {{ testNotificationStatus }}
    </p>

    <fieldset>
      <legend>{{ t("notification.platforms") }}</legend>
      <div class="setting-grid">
        <label v-for="platform in platforms" :key="platform.value" class="choice-row">
          <span class="platform-copy">
            <strong>{{ platform.label }}</strong>
            <small :class="{ degraded: platformStatusDegraded(platform.value) }">
              {{ platformStatus(platform.value) }}
            </small>
            <small>{{ platformStatusDetail(platform.value) }}</small>
          </span>
          <input
            type="checkbox"
            :checked="notifications.preferences.platforms[platform.value]"
            @change="setPlatform(platform.value, $event)"
          />
        </label>
      </div>
    </fieldset>

    <fieldset>
      <legend>{{ t("notification.eventTypes") }}</legend>
      <div class="event-list">
        <label v-for="event in events" :key="event.value" class="choice-row event-row">
          <span>
            <strong>{{ event.label }}</strong>
            <small>{{ event.hint }}</small>
          </span>
          <input
            type="checkbox"
            :checked="notifications.preferences.events[event.value]"
            @change="setEvent(event.value, $event)"
          />
        </label>
      </div>
    </fieldset>

    <label class="privacy-row">
      <input
        type="checkbox"
        :checked="notifications.preferences.hide_private_content"
        @change="notifications.setHidePrivateContent(($event.target as HTMLInputElement).checked)"
      />
      <span>
        <strong>{{ t("notification.hidePrivate") }}</strong>
        <small>{{ t("notification.hidePrivateHint") }}</small>
      </span>
    </label>
  </div>
</template>

<style scoped src="./NotificationSettings.css"></style>
