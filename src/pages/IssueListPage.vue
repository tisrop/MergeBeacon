<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useAuthStore } from "@/stores/useAuthStore";
import { useIssueStore } from "@/stores/useIssueStore";
import { useRepoStore } from "@/stores/useRepoStore";
import AppLayout from "@/components/layout/AppLayout.vue";
import IssueCard from "@/components/issue/IssueCard.vue";
import type { IssueSummary } from "@/types";
import { issueList } from "@/api";
import { getErrorMessage } from "@/utils/error";
import { useI18n } from "@/i18n";

const auth = useAuthStore();
const issueStore = useIssueStore();
const repo = useRepoStore();
const { t } = useI18n();

const issues = ref<IssueSummary[]>([]);
const loading = ref(false);
const error = ref("");

let requestSequence = 0;

function issueDetailRoute(issue: IssueSummary) {
  if (!repo.activeRepo) return "/issue";
  return {
    name: "issue-detail",
    params: {
      platform: auth.activePlatform,
      owner: repo.activeRepo.owner,
      repo: repo.activeRepo.repo,
      number: issue.number,
    },
  };
}

async function fetchIssues() {
  const sequence = ++requestSequence;
  issues.value = [];
  if (!repo.activeRepo) {
    loading.value = false;
    return;
  }
  const platform = auth.activePlatform;
  const { owner, repo: repoName } = repo.activeRepo;
  loading.value = true;
  error.value = "";
  try {
    const result = await issueList(platform, owner, repoName);
    if (
      sequence === requestSequence &&
      auth.activePlatform === platform &&
      repo.activeRepo?.owner === owner &&
      repo.activeRepo?.repo === repoName
    ) {
      issues.value = issueStore.mergePendingCreatedIssue(platform, owner, repoName, result.items);
    }
  } catch (cause) {
    if (
      sequence === requestSequence &&
      auth.activePlatform === platform &&
      repo.activeRepo?.owner === owner &&
      repo.activeRepo?.repo === repoName
    ) {
      issues.value = [];
      error.value = getErrorMessage(cause, t("issue.listFailed"));
    }
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

onMounted(fetchIssues);
watch(() => [auth.activePlatform, repo.activeRepo] as const, fetchIssues);
</script>

<template>
  <AppLayout>
    <template #header>
      <div class="issue-header page-heading">
        <div>
          <h2>{{ t("layout.issues") }}</h2>
          <p v-if="repo.activeFullName">{{ repo.activeFullName }}</p>
          <p v-else>{{ t("issue.listDescription") }}</p>
        </div>
        <component
          :is="repo.activeRepo ? 'router-link' : 'button'"
          :to="repo.activeRepo ? '/issue/new' : undefined"
          :type="repo.activeRepo ? undefined : 'button'"
          :disabled="repo.activeRepo ? undefined : true"
          :title="repo.activeRepo ? undefined : t('issue.noRepository')"
          class="btn btn-success btn-sm"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {{ t("issue.new") }}
        </component>
      </div>
    </template>

    <div v-if="loading" class="loading-skeleton">
      <div class="skeleton skeleton-card" v-for="i in 4" :key="i" />
    </div>

    <div v-else-if="!repo.activeRepo" class="empty-state state-panel">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M13 12H3" />
      </svg>
      <p>{{ t("issue.selectRepository") }}</p>
    </div>

    <div v-else-if="error" class="error-box" data-testid="issue-list-error">
      <p class="error-title">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
        {{ t("issue.listFailed") }}
      </p>
      <p class="error-msg">{{ error }}</p>
      <button class="btn btn-sm" type="button" @click="fetchIssues">
        {{ t("common.retry") }}
      </button>
    </div>

    <div v-else-if="issues.length === 0" class="empty-state state-panel">
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p>{{ t("issue.empty") }}</p>
    </div>

    <div v-else class="issue-list">
      <router-link
        v-for="item in issues"
        :key="item.number"
        :to="issueDetailRoute(item)"
        class="issue-card-link"
      >
        <IssueCard :issue="item" />
      </router-link>
    </div>
  </AppLayout>
</template>

<style scoped src="./IssueListPage.css"></style>
