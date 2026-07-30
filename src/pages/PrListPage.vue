<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/useAuthStore";
import { useRepoStore } from "@/stores/useRepoStore";
import { usePrStore } from "@/stores/usePrStore";
import type { Platform, PrListQuery } from "@/types";
import AppLayout from "@/components/layout/AppLayout.vue";
import PrFilterBar from "@/components/pr/PrFilterBar.vue";
import PrSearchBar from "@/components/pr/PrSearchBar.vue";
import {
  labelFilterOptions,
  userFilterOptions,
  usePrListFilterOptions,
} from "@/components/pr/usePrListFilterOptions";
import PrCard from "@/components/pr/PrCard.vue";
import AppSelect from "@/components/shared/AppSelect.vue";

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const repo = useRepoStore();
const pr = usePrStore();
const listFilterOptions = usePrListFilterOptions();
let ignoreNextFilterChange = false;
const createLabel = computed(() => (auth.activePlatform === "gitlab" ? "创建 MR" : "创建 PR"));
const pageInput = ref("1");
const pageJumpTarget = computed(() => Number(pageInput.value));
const canJumpToPage = computed(
  () =>
    Number.isInteger(pageJumpTarget.value) &&
    pageJumpTarget.value >= 1 &&
    pageJumpTarget.value <= pr.totalPages &&
    pageJumpTarget.value !== pr.filters.page &&
    !pr.loading,
);
const participantCandidates = computed(() => [
  ...listFilterOptions.participants.value,
  ...pr.list.map((item) => item.author),
]);
const authorOptions = computed(() =>
  userFilterOptions(participantCandidates.value, pr.listQuery.author),
);
const assigneeOptions = computed(() =>
  userFilterOptions(listFilterOptions.participants.value, pr.listQuery.assignee),
);
const repositoryLabelOptions = computed(() =>
  labelFilterOptions(
    [
      ...listFilterOptions.labels.value,
      ...pr.list.flatMap((item) =>
        item.labels.map((name) => ({ name, color: null, description: null })),
      ),
    ],
    pr.listQuery.label,
  ),
);
const truncatedListNotice = computed(() => {
  if (!pr.listTruncated) return "";
  if (auth.activePlatform === "github") {
    const total = pr.listTotalCount.toLocaleString("zh-CN");
    if (pr.hasListQuery) {
      return `共 ${total} 条符合条件的 Pull Request，仅可浏览前 1,000 条。`;
    }
    return `共 ${total} 条已关闭或已合并 Pull Request，仅可浏览前 1,000 条。`;
  }
  if (auth.activePlatform === "gitlab") {
    return "GitLab 当前仅返回部分 Merge Request，更多历史记录暂不可分页查看。";
  }
  return "Gitee 当前仅返回部分 Pull Request，更多历史记录暂不可分页查看。";
});

function isCurrentRepoContext(platform: Platform, owner: string, repoName: string): boolean {
  return (
    auth.activePlatform === platform &&
    repo.activeRepo?.owner === owner &&
    repo.activeRepo.repo === repoName
  );
}

async function fetchPrs() {
  if (!auth.isLoggedIn || !repo.activeRepo) return;
  const { owner, repo: repoName } = repo.activeRepo;
  const platform = auth.activePlatform;
  if (platform === "github") {
    void listFilterOptions.load(platform, owner, repoName);
  } else {
    listFilterOptions.clear();
  }
  await pr.fetchPrList(platform, owner, repoName);
  if (!isCurrentRepoContext(platform, owner, repoName)) return;
  await pr.fetchStateCounts(platform, owner, repoName);
}

async function fetchPrPage(refreshStateCounts = false) {
  if (!auth.isLoggedIn || !repo.activeRepo) return;
  const { owner, repo: repoName } = repo.activeRepo;
  const platform = auth.activePlatform;
  await pr.fetchPrList(platform, owner, repoName);
  if (!refreshStateCounts || !isCurrentRepoContext(platform, owner, repoName)) return;
  await pr.fetchStateCounts(platform, owner, repoName);
}

function switchToFork() {
  repo.switchForkView(auth.activePlatform);
}

function jumpToPage() {
  if (!canJumpToPage.value) return;
  pr.setPage(pageJumpTarget.value);
}

function goToPreviousPage() {
  if (pr.filters.page <= 1 || pr.loading) return;
  pr.prevPage();
}

function goToNextPage() {
  if (pr.filters.page >= pr.totalPages || pr.loading) return;
  pr.nextPage();
}

function changePageSize(value: string) {
  pageInput.value = "1";
  pr.setPerPage(Number(value));
}

function applyListQuery(query: PrListQuery) {
  pr.setListQuery(query);
}

function clearListQuery() {
  pr.clearListQuery();
}

function retryFilterOptions() {
  if (!auth.isLoggedIn || !repo.activeRepo) return;
  void listFilterOptions.load(
    auth.activePlatform,
    repo.activeRepo.owner,
    repo.activeRepo.repo,
    true,
  );
}

onMounted(() => {
  if (auth.isLoggedIn) {
    fetchPrs();
  }
});

watch(
  () => auth.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) fetchPrs();
    else listFilterOptions.clear();
  },
);

watch(
  () => [auth.activePlatform, repo.activeRepo] as const,
  () => {
    listFilterOptions.clear();
    if (pr.clearContext()) {
      ignoreNextFilterChange = true;
    }
    fetchPrs();
  },
);
watch(
  () => ({
    state: pr.filters.state,
    page: pr.filters.page,
    perPage: pr.perPage,
    query: pr.listQuery,
  }),
  ({ state }, { state: previousState }) => {
    if (ignoreNextFilterChange) {
      ignoreNextFilterChange = false;
      return;
    }
    fetchPrPage(state !== previousState);
  },
  { deep: true },
);
watch(
  () => pr.filters.page,
  (page) => {
    pageInput.value = String(page);
  },
  { immediate: true },
);
watch(
  () => route.query._t,
  () => fetchPrs(),
);

function onSelectPr(prNumber: number) {
  if (!repo.activeRepo) return;
  router.push({
    name: "pr-detail",
    params: {
      platform: auth.activePlatform,
      owner: repo.activeRepo.owner,
      repo: repo.activeRepo.repo,
      number: prNumber,
    },
  });
}
</script>

<template>
  <AppLayout>
    <template #header>
      <div class="header-row page-heading">
        <div>
          <h2>Pull Requests</h2>
          <p v-if="repo.activeFullName" class="repo-name">{{ repo.activeFullName }}</p>
          <p v-else class="repo-name">选择仓库后查看合并请求</p>
        </div>
        <div class="header-actions">
          <RouterLink
            v-if="auth.isLoggedIn"
            class="btn btn-sm btn-primary"
            :to="{
              name: 'pr-new',
              params: { platform: auth.activePlatform },
              query: { target: repo.activeFullName ?? undefined },
            }"
          >
            {{ createLabel }}
          </RouterLink>
        </div>
      </div>
      <div v-if="repo.forkContext" class="fork-banner">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
        </svg>
        <template v-if="!repo.hasUpstreamInfo">
          这是一个 Fork 仓库，但未获取到上游仓库信息 （请确认 Token
          有足够的仓库权限，或检查终端日志中的 parent 数据）
        </template>
        <template v-else-if="repo.viewingUpstream">
          正在查看上游仓库 <strong>{{ repo.forkContext.upstreamFullName }}</strong> 的 PR
          <button class="fork-switch" @click="switchToFork">查看本仓库 PR</button>
        </template>
        <template v-else>
          正在查看本仓库 PR
          <button class="fork-switch" @click="switchToFork">
            查看上游 {{ repo.forkContext.upstreamFullName }}
          </button>
        </template>
      </div>
      <PrFilterBar />
      <PrSearchBar
        v-if="auth.activePlatform === 'github'"
        :query="pr.listQuery"
        :loading="pr.loading"
        :options-loading="listFilterOptions.loading.value"
        :options-error="listFilterOptions.error.value"
        :author-options="authorOptions"
        :label-options="repositoryLabelOptions"
        :assignee-options="assigneeOptions"
        @apply="applyListQuery"
        @clear="clearListQuery"
        @retry-options="retryFilterOptions"
      />
    </template>

    <div v-if="pr.loading" class="loading-skeleton">
      <div class="skeleton skeleton-card" v-for="i in 5" :key="i" />
    </div>

    <div v-else-if="pr.error" class="error-box">
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
        获取 PR 列表失败
      </p>
      <p class="error-msg">{{ pr.error }}</p>
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

    <div v-else-if="pr.list.length === 0" class="empty-state state-panel">
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
        <circle cx="18" cy="18" r="3" />
        <circle cx="6" cy="6" r="3" />
        <path d="M18 15V9" />
        <path d="M6 9v9" />
        <path d="M13 6h3a2 2 0 0 1 2 2v3" />
      </svg>
      <p>{{ pr.hasListQuery ? "没有符合筛选条件的 Pull Request" : "暂无 Pull Request" }}</p>
      <button v-if="pr.hasListQuery" class="btn btn-sm" type="button" @click="clearListQuery">
        清除筛选条件
      </button>
      <p v-if="repo.activeFullName" class="empty-repo text-secondary font-mono">
        当前仓库：{{ repo.activeFullName }}
      </p>
    </div>

    <div v-else class="pr-list">
      <p v-if="pr.listTruncated" class="search-limit-notice" role="status">
        {{ truncatedListNotice }}
      </p>
      <PrCard
        v-for="item in pr.list"
        :key="item.number"
        :pr="item"
        @click="onSelectPr(item.number)"
      />
    </div>

    <div v-if="pr.list.length > 0 && pr.totalPages > 1" class="pagination">
      <button
        class="btn btn-sm"
        :disabled="pr.filters.page <= 1 || pr.loading"
        @click="goToPreviousPage"
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
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        上一页
      </button>
      <span class="page-info">{{ pr.filters.page }} / {{ pr.totalPages }}</span>
      <button
        class="btn btn-sm"
        :disabled="pr.filters.page >= pr.totalPages || pr.loading"
        @click="goToNextPage"
      >
        下一页
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <AppSelect
        size="sm"
        :modelValue="String(pr.perPage)"
        :options="pr.pageSizes.map((s: number) => ({ value: String(s), label: s + ' 条/页' }))"
        @update:modelValue="changePageSize"
      />
      <div class="page-jump">
        <input
          v-model="pageInput"
          class="input page-jump-input"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          autocomplete="off"
          aria-label="跳转页码"
          @keydown.enter.prevent="jumpToPage"
        />
        <button class="btn btn-sm" type="button" :disabled="!canJumpToPage" @click="jumpToPage">
          跳转
        </button>
      </div>
    </div>
  </AppLayout>
</template>

<style scoped src="./PrListPage.css"></style>
