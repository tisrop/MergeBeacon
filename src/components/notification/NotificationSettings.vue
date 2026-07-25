<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  notificationPermissionGranted,
  requestNotificationPermission,
  showDesktopTestNotification,
} from "@/services/desktopNotifications";
import { useNotificationStore, type NotificationEventType } from "@/stores/useNotificationStore";
import type { Platform } from "@/types";
import { getErrorMessage } from "@/utils/error";

const notifications = useNotificationStore();
const permissionGranted = ref(false);
const requestingPermission = ref(false);
const permissionError = ref("");
const sendingTestNotification = ref(false);
const testNotificationStatus = ref("");
const testNotificationFailed = ref(false);

const platforms: Array<{ value: Platform; label: string }> = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "gitee", label: "Gitee" },
];
const events: Array<{ value: NotificationEventType; label: string; hint: string }> = [
  { value: "review_request", label: "评审请求", hint: "有新的 PR/MR 需要你评审时通知" },
  { value: "checks_completed", label: "CI/测试完成", hint: "检查从进行中变为成功或失败时通知" },
  { value: "new_commits", label: "新提交", hint: "已跟踪的 PR/MR 推送新提交时通知" },
  { value: "new_comments", label: "新评论", hint: "已跟踪的 PR/MR 评论数量增加时通知" },
  { value: "mergeable", label: "可合并", hint: "PR/MR 从阻塞状态变为可合并时通知" },
];
const categoryLabels = {
  review_requested: "评审请求",
  authored: "我创建的",
} as const;

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function formatTime(timestamp: number | null): string {
  if (timestamp == null) return "尚无";
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function platformStatus(platform: Platform): string {
  const observation = notifications.pollObservations[platform];
  const retrySeconds = notifications.retryCountdown[platform];
  if (!notifications.preferences.platforms[platform]) return "已停用";
  if (retrySeconds > 0) return `限流退避 · ${formatCountdown(retrySeconds)} 后重试`;
  if (observation.outcome === "success") return "检查正常";
  if (observation.outcome === "partial") return "部分检查成功";
  if (observation.outcome === "rate_limited") return "平台限流";
  if (observation.outcome === "failed") return "检查失败";
  return "等待首次检查";
}

function platformStatusDetail(platform: Platform): string {
  const observation = notifications.pollObservations[platform];
  if (observation.last_attempt_at == null) return "尚未请求代码平台 API";
  const detail = [`最近检查 ${formatTime(observation.last_attempt_at)}`];
  if (
    observation.last_success_at != null &&
    observation.last_success_at !== observation.last_attempt_at
  ) {
    detail.push(`最近成功 ${formatTime(observation.last_success_at)}`);
  }
  if (observation.rate_limited_categories.length > 0) {
    detail.push(
      `${observation.rate_limited_categories.map((category) => categoryLabels[category]).join("、")}限流`,
    );
  }
  const failedCategories = observation.failed_categories.filter(
    (category) => !observation.rate_limited_categories.includes(category),
  );
  if (failedCategories.length > 0) {
    detail.push(`${failedCategories.map((category) => categoryLabels[category]).join("、")}失败`);
  }
  if (observation.consecutive_degraded_polls > 1) {
    detail.push(`连续异常 ${observation.consecutive_degraded_polls} 次`);
  }
  if (observation.rate_limited_polls > 0) {
    detail.push(`本次运行限流 ${observation.rate_limited_polls} 次`);
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
      permissionError.value = "桌面通知权限已被撤销，请重新授权后再启用通知。";
      notifications.setManagerError("permission", permissionError.value);
    } else if (!permissionGranted.value && notifications.permissionError) {
      permissionError.value = notifications.permissionError;
    } else {
      notifications.clearManagerError("permission");
    }
  } catch (error) {
    const message = `检查桌面通知权限失败：${getErrorMessage(error, "系统通知服务暂不可用")}`;
    permissionError.value = message;
    notifications.setManagerError("permission", message);
  }
});

async function setEnabled(event: Event): Promise<void> {
  const enabled = (event.target as HTMLInputElement).checked;
  permissionError.value = "";
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
      permissionError.value = "系统未授予通知权限，请在系统设置中允许 MergeBeacon 发送通知。";
      notifications.setManagerError("permission", permissionError.value);
    }
  } catch (error) {
    permissionError.value = `请求桌面通知权限失败：${getErrorMessage(
      error,
      "系统通知服务暂不可用",
    )}`;
    notifications.setManagerError("permission", permissionError.value);
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
      const message = `检查桌面通知权限失败：${getErrorMessage(error, "系统通知服务暂不可用")}`;
      permissionError.value = message;
      testNotificationFailed.value = true;
      testNotificationStatus.value = message;
      notifications.setManagerError("permission", message);
      return;
    }
    if (!permissionGranted.value) {
      const message = "系统通知权限不可用或已被撤销，请重新授权后再发送测试通知。";
      notifications.setEnabled(false);
      permissionError.value = message;
      testNotificationFailed.value = true;
      testNotificationStatus.value = message;
      notifications.setManagerError("permission", message);
      return;
    }
    permissionError.value = "";
    notifications.clearManagerError("permission");
    try {
      await showDesktopTestNotification();
      notifications.clearManagerError("delivery");
      testNotificationStatus.value = "测试通知已交给系统通知服务。";
    } catch (error) {
      testNotificationFailed.value = true;
      testNotificationStatus.value = `发送测试通知失败：${getErrorMessage(
        error,
        "系统通知服务暂不可用",
      )}`;
      notifications.setManagerError("delivery", testNotificationStatus.value);
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
        <span class="setting-label">启用桌面通知</span>
        <span class="setting-hint"
          >应用运行期间每 10 分钟低频检查一次；退出应用后停止检查，不提供系统级后台推送。</span
        >
      </span>
      <label class="toggle">
        <input
          type="checkbox"
          aria-label="启用桌面通知"
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
        <span class="setting-label">系统通知测试</span>
        <span class="setting-hint">直接调用当前系统通知服务，不请求代码平台 API。</span>
      </span>
      <button
        type="button"
        class="test-notification-button"
        :disabled="sendingTestNotification || !permissionGranted"
        @click="sendTestNotification"
      >
        {{ sendingTestNotification ? "正在发送..." : "发送测试通知" }}
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
      <legend>通知平台</legend>
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
      <legend>事件类型</legend>
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
        <strong>隐藏私有仓库通知内容</strong>
        <small>默认不显示仓库名、PR 标题或代码信息；无法确认可见性的仓库也按私有处理。</small>
      </span>
    </label>
  </div>
</template>

<style scoped src="./NotificationSettings.css"></style>
