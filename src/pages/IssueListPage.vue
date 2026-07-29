<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useAuthStore } from "@/stores/useAuthStore";
import { useIssueStore } from "@/stores/useIssueStore";
import { useRepoStore } from "@/stores/useRepoStore";
import AppLayout from "@/components/layout/AppLayout.vue";
import IssueCard from "@/components/issue/IssueCard.vue";
import type { IssueSummary } from "@/types";
import { issueList } from "@/api";

const auth = useAuthStore();
const issueStore = useIssueStore();
const repo = useRepoStore();

const issues = ref<IssueSummary[]>([]);
const loading = ref(false);

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
          <h2>Issues</h2>
          <p v-if="repo.activeFullName">{{ repo.activeFullName }}</p>
          <p v-else>选择仓库后查看与管理 Issue</p>
        </div>
        <router-link v-if="repo.activeRepo" to="/issue/new" class="btn btn-success btn-sm">
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
          新建 Issue
        </router-link>
        <button v-else type="button" class="btn btn-success btn-sm" disabled title="请先选择仓库">
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
          新建 Issue
        </button>
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
      <p>请先在左侧选择一个仓库</p>
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
      <p>暂无 Issue</p>
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
