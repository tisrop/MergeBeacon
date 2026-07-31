<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import AppLayout from "@/components/layout/AppLayout.vue";
import ReviewInboxCard from "@/components/inbox/ReviewInboxCard.vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePrStore } from "@/stores/usePrStore";
import { useRepoStore } from "@/stores/useRepoStore";
import { INBOX_BACKGROUND_REFRESH_MS, useReviewInboxStore } from "@/stores/useReviewInboxStore";
import type { Platform, ReviewInboxItem } from "@/types";
import { useI18n } from "@/i18n";

const router = useRouter();
const auth = useAuthStore();
const repo = useRepoStore();
const pr = usePrStore();
const inbox = useReviewInboxStore();
const { t } = useI18n();

const platformLabels: Record<Platform, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitee: "Gitee",
};
const categoryOptions = computed(() => [
  { value: "review_requested", label: t("inbox.requested") },
  { value: "authored", label: t("inbox.authored") },
]);
const relationshipOptions = computed(() => [
  { value: "all", label: t("inbox.allRelationships") },
  { value: "reviewer", label: t("inbox.relationshipReviewer") },
  { value: "assignee", label: t("inbox.relationshipAssignee") },
  { value: "tester", label: t("inbox.relationshipTester") },
]);
const readinessOptions = computed(() => [
  { value: "all", label: t("inbox.allReadiness") },
  { value: "ready", label: t("pr.readinessReady") },
  { value: "blocked", label: t("pr.readinessBlocked") },
  { value: "pending", label: t("pr.readinessPending") },
  { value: "unknown", label: t("pr.readinessUnknown") },
]);
const readOptions = computed(() => [
  { value: "all", label: t("inbox.allReadStates") },
  { value: "unread", label: t("inbox.unread") },
  { value: "read", label: t("inbox.readState") },
]);
const blockerOptions = computed(() => [
  { value: "all", label: t("inbox.allBlockers") },
  { value: "checks_failed", label: t("inbox.blockerChecksFailed") },
  { value: "checks_pending", label: t("inbox.blockerChecksPending") },
  { value: "changes_requested", label: t("inbox.blockerChanges") },
  { value: "approvals_required", label: t("inbox.blockerApprovals") },
  { value: "draft", label: "Draft" },
  { value: "conflicts", label: t("inbox.blockerConflicts") },
  { value: "branch_behind", label: t("inbox.blockerBehind") },
  { value: "discussions_unresolved", label: t("inbox.blockerDiscussions") },
]);
const sortOptions = computed(() => [
  { value: "updated", label: t("inbox.sortUpdated") },
  { value: "blocked", label: t("inbox.sortBlocked") },
  { value: "mergeable", label: t("inbox.sortMergeable") },
  { value: "checks_failed", label: t("inbox.sortChecksFailed") },
]);
const loggedInPlatforms = computed<Platform[]>(() =>
  (Object.keys(auth.platforms) as Platform[]).filter(
    (platform) => auth.platforms[platform].isLoggedIn,
  ),
);
const availablePlatforms = computed<Platform[]>(() =>
  loggedInPlatforms.value.filter((platform) => auth.platformVisibility[platform]),
);
const platformOptions = computed(() => [
  { value: "all", label: t("inbox.allEnabledPlatforms") },
  ...availablePlatforms.value.map((platform) => ({
    value: platform,
    label: platformLabels[platform],
  })),
]);
const visibleErrors = computed(() =>
  inbox.visiblePlatforms
    .filter((platform) => inbox.errors[platform])
    .map((platform) => ({
      platform,
      label: platformLabels[platform],
      message: inbox.errors[platform] ?? t("common.unknownError"),
    })),
);
const hasLoadedItems = computed(() =>
  inbox.visiblePlatforms.some((platform) => inbox.itemsByPlatform[platform].length > 0),
);

watch(
  [() => inbox.filters.category, () => availablePlatforms.value.join(",")],
  () => {
    if (
      inbox.filters.platform !== "all" &&
      !availablePlatforms.value.includes(inbox.filters.platform)
    ) {
      inbox.filters.platform = "all";
      return;
    }
    if (availablePlatforms.value.length > 0) {
      void inbox.refresh(availablePlatforms.value);
    } else {
      inbox.clear();
    }
  },
  { immediate: true },
);

watch(
  () => inbox.filters.platform,
  () => {
    if (availablePlatforms.value.length > 0) {
      void inbox.refresh(availablePlatforms.value);
    } else {
      inbox.clear();
    }
  },
);

function refresh(): void {
  void inbox.refresh(availablePlatforms.value);
}

function openItem(item: ReviewInboxItem): void {
  inbox.markRead(item);
  auth.setActivePlatform(item.platform);
  repo.setActiveRepo(item.owner, item.repo, item.platform);
  repo.setForkContext(null, item.platform);
  pr.clearContext();
  void router.push({
    name: "pr-detail",
    params: {
      platform: item.platform,
      owner: item.owner,
      repo: item.repo,
      number: item.summary.number,
    },
  });
}

function toggleRead(item: ReviewInboxItem): void {
  if (item.local_state?.unread) inbox.markRead(item);
  else inbox.markUnread(item);
}

function backgroundRefresh(): void {
  if (document.visibilityState === "hidden" || navigator.onLine === false) return;
  void inbox.backgroundRefresh(availablePlatforms.value);
}

let backgroundTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  backgroundTimer = setInterval(backgroundRefresh, INBOX_BACKGROUND_REFRESH_MS);
  document.addEventListener("visibilitychange", backgroundRefresh);
});
onUnmounted(() => {
  if (backgroundTimer) clearInterval(backgroundTimer);
  document.removeEventListener("visibilitychange", backgroundRefresh);
});
</script>

<template>
  <AppLayout>
    <template #header>
      <div class="header-row page-heading">
        <div>
          <h2>{{ t("inbox.title") }}</h2>
          <p class="subtitle">{{ t("inbox.subtitle") }}</p>
        </div>
        <div class="header-actions">
          <span v-if="inbox.items.length" class="result-count">{{
            t("inbox.resultCount", { count: inbox.items.length })
          }}</span>
          <button
            v-if="inbox.unreadCount > 0"
            type="button"
            class="mark-all-read-button"
            @click="inbox.markAllRead"
          >
            {{ t("inbox.markAllRead") }}
          </button>
          <button
            type="button"
            class="refresh-button"
            :disabled="inbox.loading || availablePlatforms.length === 0"
            :aria-label="t('layout.reviewInbox')"
            :title="t('layout.reviewInbox')"
            @click="refresh"
          >
            <svg
              :class="{ spinning: inbox.loading }"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>
      <div class="filter-bar" :aria-label="t('inbox.filterAria')">
        <div class="filter-field">
          <span>{{ t("inbox.category") }}</span>
          <AppSelect
            v-model="inbox.filters.category"
            size="sm"
            :options="categoryOptions"
            :aria-label="t('inbox.categoryAria')"
          />
        </div>
        <div class="filter-field">
          <span>{{ t("inbox.platform") }}</span>
          <AppSelect
            v-model="inbox.filters.platform"
            size="sm"
            :options="platformOptions"
            :aria-label="t('inbox.platformAria')"
          />
        </div>
        <div class="filter-field">
          <span>{{ t("inbox.relationship") }}</span>
          <AppSelect
            v-model="inbox.filters.relationship"
            size="sm"
            :options="relationshipOptions"
            :aria-label="t('inbox.relationshipAria')"
          />
        </div>
        <div class="filter-field">
          <span>{{ t("inbox.readiness") }}</span>
          <AppSelect
            v-model="inbox.filters.readiness"
            size="sm"
            :options="readinessOptions"
            :aria-label="t('inbox.readinessAria')"
          />
        </div>
        <div class="filter-field">
          <span>{{ t("inbox.read") }}</span>
          <AppSelect
            v-model="inbox.filters.read"
            size="sm"
            :options="readOptions"
            :aria-label="t('inbox.readAria')"
          />
        </div>
        <div class="filter-field">
          <span>{{ t("inbox.blocker") }}</span>
          <AppSelect
            v-model="inbox.filters.blocker"
            size="sm"
            :options="blockerOptions"
            :aria-label="t('inbox.blockerAria')"
          />
        </div>
        <div class="filter-field">
          <span>{{ t("inbox.sort") }}</span>
          <AppSelect
            v-model="inbox.filters.sort"
            size="sm"
            :options="sortOptions"
            :aria-label="t('inbox.sortAria')"
          />
        </div>
        <label class="repository-filter">
          <span>{{ t("inbox.repository") }}</span>
          <input
            v-model="inbox.filters.repository"
            class="input"
            type="search"
            :placeholder="t('inbox.repositoryPlaceholder')"
            autocomplete="off"
          />
        </label>
      </div>
    </template>

    <div v-if="availablePlatforms.length === 0" class="empty-state state-panel">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path d="M4 4h16v16H4z" />
        <path d="m4 8 8 5 8-5" />
      </svg>
      <p v-if="loggedInPlatforms.length === 0">{{ t("inbox.noLogin") }}</p>
      <p v-else>{{ t("inbox.loggedInDisabled") }}</p>
    </div>

    <div v-else>
      <div v-if="visibleErrors.length" class="platform-errors" aria-live="polite">
        <div v-for="error in visibleErrors" :key="error.platform" class="platform-error">
          <div>
            <strong>{{ t("inbox.error", { platform: error.label }) }}</strong>
            <span>{{ error.message }}</span>
          </div>
          <button type="button" @click="inbox.retry(error.platform)">
            {{ t("common.retry") }}
          </button>
        </div>
      </div>

      <div
        v-if="inbox.loading && !hasLoadedItems"
        class="loading-skeleton"
        :aria-label="t('inbox.loading')"
      >
        <div v-for="index in 5" :key="index" class="skeleton skeleton-card" />
      </div>

      <div v-else-if="inbox.items.length" class="inbox-list">
        <ReviewInboxCard
          v-for="item in inbox.items"
          :key="`${item.platform}:${item.repository_full_name}:${item.summary.number}`"
          :item="item"
          @click="openItem(item)"
          @toggle-read="toggleRead(item)"
        />
      </div>

      <div v-else-if="!inbox.loading" class="empty-state">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="M4 4h16v16H4z" />
          <path d="m4 8 8 5 8-5" />
        </svg>
        <p
          v-if="
            inbox.filters.repository ||
            inbox.filters.relationship !== 'all' ||
            inbox.filters.readiness !== 'all' ||
            inbox.filters.read !== 'all' ||
            inbox.filters.blocker !== 'all'
          "
        >
          {{ t("inbox.emptyFiltered") }}
        </p>
        <p v-else-if="visibleErrors.length">{{ t("inbox.emptyWithErrors") }}</p>
        <p v-else>{{ t("inbox.empty") }}</p>
      </div>

      <button
        v-if="inbox.hasMore"
        type="button"
        class="load-more-button"
        :disabled="inbox.loading"
        @click="inbox.loadMore"
      >
        {{ inbox.loading ? t("common.loading") : t("common.loadMore") }}
      </button>
    </div>
  </AppLayout>
</template>

<style scoped src="./ReviewInboxPage.css"></style>
