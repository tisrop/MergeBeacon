<script setup lang="ts">
import { computed } from "vue";
import Sidebar from "./Sidebar.vue";
import { useNotificationStore } from "@/stores/useNotificationStore";
import type { Platform } from "@/types";
import { useI18n } from "@/i18n";

withDefaults(
  defineProps<{
    isDiffFocusMode?: boolean;
    compactSidebar?: boolean;
  }>(),
  {
    isDiffFocusMode: false,
    compactSidebar: false,
  },
);

const notifications = useNotificationStore();
const { t } = useI18n();
const platformLabels: Record<Platform, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitee: "Gitee",
};
const retryPlatforms = computed(() =>
  (Object.keys(platformLabels) as Platform[]).filter(
    (platform) => notifications.retryCountdown[platform] > 0,
  ),
);

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
</script>

<template>
  <div class="app-layout">
    <a class="skip-link" href="#main-content">{{ t("layout.skipToContent") }}</a>
    <Sidebar :is-diff-focus-mode="isDiffFocusMode" :compact-sidebar="compactSidebar" />
    <main id="main-content" class="main-content" tabindex="-1">
      <section
        v-if="notifications.showNotificationError"
        class="notification-error-banner"
        role="alert"
        aria-live="assertive"
      >
        <div class="notification-error-copy">
          <strong>{{ t("layout.notificationError") }}</strong>
          <span>{{ notifications.notificationError }}</span>
          <span v-for="platform in retryPlatforms" :key="platform" class="retry-countdown">
            {{
              t("layout.notificationRetry", {
                platform: platformLabels[platform],
                countdown: formatCountdown(notifications.retryCountdown[platform]),
              })
            }}
          </span>
        </div>
        <RouterLink class="notification-settings-link" to="/settings">
          {{ t("layout.notificationSettings") }}
        </RouterLink>
      </section>
      <div class="content-header" v-if="$slots.header">
        <slot name="header" />
      </div>
      <div class="content-body">
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped src="./AppLayout.css"></style>
