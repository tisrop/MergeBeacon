<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePrStore } from "@/stores/usePrStore";
import { useReviewInboxStore } from "@/stores/useReviewInboxStore";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";
import { issueDetail, openExternalUrl, reviewCommentAdd } from "@/api";
import { useCapabilityStore } from "@/stores/useCapabilityStore";
import { getErrorMessage } from "@/utils/error";
import { currentLocale, useI18n } from "@/i18n";
import { extractDiffHunk, findStandardPatch } from "@/utils/diffHunk";
import { resolvePrContentLink, type PrContentRouteTarget } from "@/utils/prContentLinks";
import {
  clearPrCreateWarnings,
  PR_CREATE_WARNING_QUERY,
  readPrCreateWarnings,
} from "@/utils/prCreateWarnings";
import AppLayout from "@/components/layout/AppLayout.vue";
import DiffCommitSelector from "@/components/diff/DiffCommitSelector.vue";
import ReviewForm from "@/components/review/ReviewForm.vue";
import ReviewList from "@/components/review/ReviewList.vue";
import MergeReadinessPanel from "@/components/pr/MergeReadinessPanel.vue";
import PrMetadataPanel from "@/components/pr/PrMetadataPanel.vue";
import CloseConfirmDialog from "@/components/shared/CloseConfirmDialog.vue";
import { APP_COMMAND_EVENT, type AppCommandDetail } from "@/types/commands";
import type {
  AiSuggestion,
  DiffSide,
  DiffLocationRequest,
  DiffLocationResult,
  MergeStrategy,
  Platform,
  PrMetadataUpdate,
  ReviewThreadSummary,
} from "@/types";
import type { CommitRangeSelection } from "@/utils/commitRange";

const DiffViewer = defineAsyncComponent(() => import("@/components/diff/DiffViewer.vue"));
const AiReviewPanel = defineAsyncComponent(() => import("@/components/ai/AiReviewPanel.vue"));
const PrDependenciesPanel = defineAsyncComponent(
  () => import("@/components/pr/PrDependenciesPanel.vue"),
);
const PrMergeQueuePanel = defineAsyncComponent(
  () => import("@/components/pr/PrMergeQueuePanel.vue"),
);

interface AiReviewPanelHandle {
  startReview: () => Promise<void> | void;
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const pr = usePrStore();
const reviewInbox = useReviewInboxStore();
const capabilityStore = useCapabilityStore();
const uiSettings = useUiSettingsStore();
const { t } = useI18n();

const platform = route.params.platform as Platform;
const owner = route.params.owner as string;
const repo = route.params.repo as string;
const number = Number(route.params.number);

interface RepositoryCoordinates {
  owner: string;
  repo: string;
}

function repositoryCoordinates(fullName: string | null | undefined): RepositoryCoordinates | null {
  const normalized = fullName?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const separator = normalized.lastIndexOf("/");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  return {
    owner: normalized.slice(0, separator),
    repo: normalized.slice(separator + 1),
  };
}

const baseRepository = computed(
  () => repositoryCoordinates(pr.currentPr?.base_repository_full_name) ?? { owner, repo },
);
const headRepository = computed<RepositoryCoordinates | null>(() => {
  const fullName = pr.currentPr?.head_repository_full_name;
  if (fullName === undefined) return { owner, repo };
  return repositoryCoordinates(fullName);
});

type PrDetailTab = "diff" | "dependencies" | "reviews" | "ai";

const activeTab = ref<PrDetailTab>("reviews");
const aiPanelMounted = ref(false);
const dependencyPanelMounted = ref(false);
const locatingAiSuggestion = ref(false);
const tabsRef = ref<HTMLElement | null>(null);
const isMergeContextVisible = computed(() => uiSettings.isPrDependenciesVisible);
let aiReviewScrollTop: number | null = null;
let commitsRequested = false;

function ensurePrCommits(): void {
  if (
    commitsRequested ||
    pr.commitsLoading ||
    pr.commits.length > 0 ||
    pr.currentPr?.summary.number !== number
  ) {
    return;
  }
  commitsRequested = true;
  void pr.fetchPrCommits(platform, owner, repo, number);
}

function contentScrollContainer(): HTMLElement | null {
  return tabsRef.value?.closest<HTMLElement>(".content-body") ?? null;
}

function scrollTabBarIntoView(): void {
  const tabs = tabsRef.value;
  const container = contentScrollContainer();
  if (!tabs || !container) return;
  const tabsRect = tabs.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  container.scrollTop = Math.max(0, container.scrollTop + tabsRect.top - containerRect.top);
}

function selectTab(tab: PrDetailTab) {
  if (tab === "dependencies" && !isMergeContextVisible.value) return;
  const returningToAiSuggestion = tab === "ai" && locatingAiSuggestion.value;
  activeTab.value = tab;
  if (tab === "diff") ensurePrCommits();
  if (tab === "dependencies") dependencyPanelMounted.value = true;
  if (tab === "ai") {
    aiPanelMounted.value = true;
    locatingAiSuggestion.value = false;
    if (returningToAiSuggestion && aiReviewScrollTop != null) {
      const savedScrollTop = aiReviewScrollTop;
      aiReviewScrollTop = null;
      void nextTick(() => {
        const container = contentScrollContainer();
        if (container) container.scrollTop = savedScrollTop;
      });
    }
  } else if (tab !== "diff") {
    locatingAiSuggestion.value = false;
    aiReviewScrollTop = null;
  }
}

watch(isMergeContextVisible, (visible) => {
  if (!visible && activeTab.value === "dependencies") selectTab("reviews");
});

const diffLocationRequest = ref<DiffLocationRequest | null>(null);
const diffLocationError = ref("");
let diffLocationRequestId = 0;

// 选中提交区间时展示区间 Diff；未选中（null）时仍是 PR / MR 的整体 Diff。
const isCommitRangeView = computed(() => pr.commitRange !== null);
const displayedDiff = computed(() => (isCommitRangeView.value ? pr.rangeDiff : pr.diff));
// 区间两端都是源分支上的提交，Fork PR 必须在源仓库里比较，base 仓库不一定有这些提交。
const commitRangeRepository = computed(() => headRepository.value ?? baseRepository.value);
const displayedBaseRepository = computed(() =>
  isCommitRangeView.value ? commitRangeRepository.value : baseRepository.value,
);
const displayedBaseSha = computed(() =>
  isCommitRangeView.value ? (pr.rangeRevisions?.baseSha ?? "") : (pr.currentPr?.base_sha ?? ""),
);
const displayedHeadSha = computed(() =>
  isCommitRangeView.value ? (pr.rangeRevisions?.headSha ?? "") : (pr.currentPr?.head_sha ?? ""),
);

function handleCommitRangeChange(selection: CommitRangeSelection | null): void {
  diffLocationError.value = "";
  const target = commitRangeRepository.value;
  void pr.selectCommitRange(platform, target.owner, target.repo, selection);
}

function reloadPrCommits(): void {
  commitsRequested = true;
  void pr.fetchPrCommits(platform, owner, repo, number);
}

function handleAiSuggestionLocate(suggestion: AiSuggestion): void {
  const path = suggestion.file.trim();
  aiReviewScrollTop = contentScrollContainer()?.scrollTop ?? null;
  diffLocationError.value = "";
  // AI 建议基于整体 Diff，定位前先回到整体视图，否则会落在没有该文件的区间里。
  pr.resetCommitSelection();
  diffLocationRequest.value = {
    id: ++diffLocationRequestId,
    path,
    line: suggestion.line_start ?? suggestion.line_end ?? null,
  };
  selectTab("diff");
  locatingAiSuggestion.value = true;
  void nextTick(scrollTabBarIntoView);
}

function handleDiffLocationResult(result: DiffLocationResult): void {
  if (result.id !== diffLocationRequest.value?.id) return;
  diffLocationError.value = result.success ? "" : (result.message ?? t("prDetail.aiLocateFailed"));
}

function handleReviewCommentLocate(path: string, line: number | null, side: DiffSide | null): void {
  diffLocationError.value = "";
  // 评论定位在整体 Diff 上，区间视图里不一定包含该文件。
  pr.resetCommitSelection();
  diffLocationRequest.value = {
    id: ++diffLocationRequestId,
    path,
    line,
    side,
  };
  selectTab("diff");
  void nextTick(scrollTabBarIntoView);
}

const reviewListRef = ref<InstanceType<typeof ReviewList> | null>(null);
const reviewFormRef = ref<InstanceType<typeof ReviewForm> | null>(null);
const aiPanelRef = ref<AiReviewPanelHandle | null>(null);
let pendingAiReviewStart = false;
const reviewThreadSummary = ref<ReviewThreadSummary | null>(null);
const unviewedFileCount = ref(0);
const commentError = ref("");
const commentSuccess = ref(false);

const selectedStrategy = ref<MergeStrategy>("merge");
const closeRelatedIssues = ref(false);
const dropdownOpen = ref(false);
const operating = ref(false);
const statusMsg = ref("");
const closeConfirmOpen = ref(false);
const closeError = ref("");
const mergeWarning = ref("");
const metadataSaving = ref(false);
const metadataStatus = ref("");
const metadataError = ref("");
const titleLinkError = ref("");

function flushPendingAiReviewStart(): void {
  if (
    !pendingAiReviewStart ||
    !aiPanelRef.value ||
    typeof aiPanelRef.value.startReview !== "function"
  ) {
    return;
  }
  pendingAiReviewStart = false;
  void aiPanelRef.value.startReview();
}

watch(aiPanelRef, flushPendingAiReviewStart);

const defaultCommitMessage = computed(
  () => `Merge pull request #${number} from ${pr.currentPr?.source_branch ?? ""}`,
);
const commitMessage = ref("");

const strategyLabels: Record<MergeStrategy, string> = {
  merge: "Merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};
const platformCapabilities = computed(() => capabilityStore.values[platform]);
const availableStrategies = computed(() =>
  (platformCapabilities.value?.merge_strategies ?? []).map((value) => ({
    value,
    label: strategyLabels[value],
  })),
);

const mergeButtonLabel = computed(() => {
  const s = availableStrategies.value.find((s) => s.value === selectedStrategy.value);
  return s ? s.label : t("prDetail.merge");
});

watch(
  () => pr.currentPr,
  (val) => {
    if (val) commitMessage.value = defaultCommitMessage.value;
  },
  { immediate: true },
);

const isOpen = computed(() => pr.currentPr?.summary.state === "open");
const isClosed = computed(() => pr.currentPr?.summary.state === "closed");
const isMerged = computed(() => pr.currentPr?.summary.state === "merged");
const canAttemptMergeWithUnknownState = computed(() => {
  const readiness = pr.mergeReadiness;
  if (!readiness || readiness.status !== "unknown") return false;

  return (
    readiness.mergeable !== false &&
    readiness.draft !== true &&
    readiness.has_conflicts !== true &&
    readiness.has_merge_permission !== false &&
    readiness.checks_status !== "blocked" &&
    readiness.checks_status !== "pending" &&
    readiness.approvals_status !== "blocked" &&
    readiness.blocking_reasons.length === 0
  );
});
const canMerge = computed(
  () =>
    isOpen.value &&
    (pr.mergeReadiness?.status === "ready" || canAttemptMergeWithUnknownState.value) &&
    (platformCapabilities.value?.merge_strategies.includes(selectedStrategy.value) ?? false),
);
const isPrAuthor = computed(() => {
  const currentUser = auth.platforms[platform].user;
  const author = pr.currentPr?.summary.author;
  if (!currentUser || !author) return false;

  const currentUserId = String(currentUser.id ?? "");
  const authorId = String(author.id ?? "");
  if (currentUserId && authorId && currentUserId === authorId) return true;

  const currentLogin = currentUser.login.trim().toLocaleLowerCase();
  const authorLogin = author.login.trim().toLocaleLowerCase();
  return currentLogin.length > 0 && currentLogin === authorLogin;
});
const hasClosePermission = computed(
  () => isPrAuthor.value || pr.mergeReadiness?.has_merge_permission === true,
);
const canClose = computed(() => isOpen.value && hasClosePermission.value);
const closeDisabledReason = computed(() => {
  if (operating.value) return t("prDetail.operationInProgress");
  if (!isOpen.value) return t("prDetail.closeOnlyOpen");
  if (hasClosePermission.value) return "";
  if (pr.readinessLoading) return t("prDetail.closePermissionLoading");
  if (pr.readinessError) return t("prDetail.closePermissionFailed");
  if (pr.mergeReadiness?.has_merge_permission == null) return t("prDetail.closePermissionUnknown");
  return t("prDetail.closePermissionRequired");
});
const canReopen = computed(() => isClosed.value && !isMerged.value);

async function handleOpenInBrowser(url: string): Promise<void> {
  titleLinkError.value = "";
  try {
    await openExternalUrl(url);
  } catch (error) {
    titleLinkError.value = getErrorMessage(error, t("prDetail.openLinkFailed"));
  }
}

async function handleOpenIssueTarget(target: PrContentRouteTarget): Promise<void> {
  titleLinkError.value = "";
  try {
    await router.push({
      name: "issue-detail",
      params: { platform, owner: target.owner, repo: target.repo, number: target.number },
    });
  } catch (error) {
    titleLinkError.value = getErrorMessage(error, t("prDetail.openIssueFailed"));
  }
}

function handleOpenIssueDetail(issueNumber: number): Promise<void> {
  return handleOpenIssueTarget({ owner, repo, number: issueNumber });
}

async function handleOpenPrDetail(target: PrContentRouteTarget): Promise<void> {
  titleLinkError.value = "";
  try {
    await router.push({
      name: "pr-detail",
      params: { platform, owner: target.owner, repo: target.repo, number: target.number },
    });
  } catch (error) {
    titleLinkError.value = getErrorMessage(error, t("prDetail.openPrFailed"));
  }
}

async function handlePrContentLink(href: string): Promise<void> {
  const resolved = resolvePrContentLink(href, {
    platform,
    owner,
    repo,
    webUrl: pr.currentPr?.web_url,
  });
  if (!resolved) return;
  if (resolved.kind === "reference") {
    const target = { owner, repo, number: resolved.number };
    if (resolved.reference === "bang") {
      await handleOpenPrDetail(target);
      return;
    }
    if (platform === "gitlab") {
      await handleOpenIssueTarget(target);
      return;
    }
    titleLinkError.value = "";
    try {
      const referenced = await issueDetail(platform, owner, repo, resolved.number);
      if (referenced.is_pull_request) await handleOpenPrDetail(target);
      else await handleOpenIssueTarget(target);
    } catch (error) {
      titleLinkError.value = getErrorMessage(error, t("prDetail.referenceFailed"));
    }
    return;
  }
  if (resolved.kind === "issue") {
    await handleOpenIssueTarget(resolved.target);
  } else if (resolved.kind === "pr") {
    await handleOpenPrDetail(resolved.target);
  } else {
    await handleOpenInBrowser(resolved.url);
  }
}

async function handleMetadataSave(update: PrMetadataUpdate): Promise<void> {
  metadataSaving.value = true;
  metadataStatus.value = "";
  metadataError.value = "";
  try {
    const outcome = await pr.updateMetadata(platform, owner, repo, number, update);
    if (!outcome) return;
    if (outcome.detail) {
      reviewInbox.applyPrSummary(platform, owner, repo, outcome.detail.summary);
    }
    if (outcome.failures.length > 0) {
      metadataError.value = outcome.failures
        .map((failure) => failure.message)
        .join(currentLocale() === "zh-CN" ? "；" : "; ");
      metadataStatus.value = outcome.updated_fields.length > 0 ? t("prDetail.metadataPartial") : "";
    } else {
      metadataStatus.value = t("prDetail.metadataUpdated");
    }
  } catch (error) {
    metadataError.value = getErrorMessage(error, t("prDetail.metadataSaveFailed"));
  } finally {
    metadataSaving.value = false;
  }
}

async function handleMerge() {
  if (!pr.currentPr || !canMerge.value) return;
  operating.value = true;
  statusMsg.value = t("prDetail.merging");
  try {
    const outcome = await pr.mergePr(
      platform,
      owner,
      repo,
      number,
      selectedStrategy.value,
      undefined,
      commitMessage.value.trim() || undefined,
      closeRelatedIssues.value || undefined,
    );
    const failedIssues = outcome.issue_close_failures.map((failure) => `#${failure.number}`);
    mergeWarning.value =
      failedIssues.length > 0
        ? t("prDetail.mergeIssueCloseFailed", {
            issues: failedIssues.join(currentLocale() === "zh-CN" ? "、" : ", "),
          })
        : "";
    statusMsg.value = "";
  } catch (e) {
    statusMsg.value = "";
  } finally {
    operating.value = false;
    dropdownOpen.value = false;
  }
}

function requestClose(): void {
  if (!pr.currentPr || !canClose.value || operating.value) return;
  closeError.value = "";
  closeConfirmOpen.value = true;
}

function cancelClose(): void {
  if (!operating.value) closeConfirmOpen.value = false;
}

async function handleClose() {
  if (!pr.currentPr || !canClose.value || operating.value) return;
  operating.value = true;
  statusMsg.value = t("prDetail.closing");
  closeError.value = "";
  try {
    await pr.closePr(platform, owner, repo, number);
    statusMsg.value = "";
    closeConfirmOpen.value = false;
  } catch (error) {
    statusMsg.value = "";
    closeError.value = getErrorMessage(error, t("prDetail.closeFailed"));
  } finally {
    operating.value = false;
  }
}

async function handleReopen() {
  if (!pr.currentPr) return;
  operating.value = true;
  statusMsg.value = t("prDetail.reopening");
  try {
    await pr.reopenPr(platform, owner, repo, number);
    statusMsg.value = "";
  } catch (e) {
    statusMsg.value = "";
  } finally {
    operating.value = false;
  }
}

async function handleAddComment(
  path: string,
  startLine: number,
  endLine: number,
  side: DiffSide,
  body?: string,
) {
  if (!body?.trim()) return;
  if (!pr.currentPr?.head_sha) {
    commentError.value = t("prDetail.missingHeadSha");
    return;
  }
  commentError.value = "";
  commentSuccess.value = false;
  try {
    const sl = startLine !== endLine ? startLine : null;
    const targetLine = endLine;
    const patch = findStandardPatch(pr.diff?.patches ?? [], path);
    const diffHunk = patch ? extractDiffHunk(patch, targetLine, side) : undefined;
    await reviewCommentAdd(
      platform,
      owner,
      repo,
      number,
      pr.currentPr.head_sha,
      path,
      sl,
      targetLine,
      side,
      body,
      diffHunk,
    );
    commentSuccess.value = true;
    setTimeout(() => {
      commentSuccess.value = false;
    }, 3000);
    if (reviewListRef.value) {
      reviewListRef.value.refresh();
    }
  } catch (e) {
    commentError.value = getErrorMessage(e, t("prDetail.inlineCommentFailed"));
  }
}

function handleAppCommand(event: Event): void {
  const detail = (event as CustomEvent<AppCommandDetail>).detail;
  if (!detail) return;
  if (detail.type === "open_diff_file") {
    diffLocationError.value = "";
    pr.resetCommitSelection();
    diffLocationRequest.value = {
      id: ++diffLocationRequestId,
      path: detail.path,
      line: null,
    };
    selectTab("diff");
    void nextTick(scrollTabBarIntoView);
  } else if (detail.type === "start_ai_review") {
    pendingAiReviewStart = true;
    selectTab("ai");
    flushPendingAiReviewStart();
  } else if (detail.type === "prepare_review") {
    selectTab("diff");
    void nextTick(() => {
      if (typeof reviewFormRef.value?.focusComposer === "function") {
        reviewFormRef.value.focusComposer();
      }
    });
  }
}

onMounted(async () => {
  window.addEventListener(APP_COMMAND_EVENT, handleAppCommand);
  if (route.query[PR_CREATE_WARNING_QUERY] === "1") {
    const createWarnings = readPrCreateWarnings(platform, owner, repo, number);
    metadataStatus.value = t("prDetail.createPartial");
    metadataError.value =
      createWarnings.length > 0
        ? createWarnings.join(currentLocale() === "zh-CN" ? "；" : "; ")
        : t("prDetail.createPartialFallback");
    const nextQuery = { ...route.query };
    delete nextQuery[PR_CREATE_WARNING_QUERY];
    void Promise.resolve(router.replace({ query: nextQuery })).then(() => {
      clearPrCreateWarnings(platform, owner, repo, number);
    });
  }
  const capabilityRequest = capabilityStore.load(platform).catch(() => null);
  await pr.fetchPrDetail(platform, owner, repo, number);
  if (pr.currentPr?.summary.number === number) {
    await nextTick();
    void Promise.allSettled([
      pr.fetchPrDiff(platform, owner, repo, number),
      pr.fetchMergeReadiness(platform, owner, repo, number),
    ]);
    if (activeTab.value === "diff") ensurePrCommits();
  }
  void capabilityRequest.then(() => {
    if (!platformCapabilities.value?.merge_strategies.includes(selectedStrategy.value)) {
      selectedStrategy.value = platformCapabilities.value?.merge_strategies[0] ?? "merge";
    }
  });
});
onUnmounted(() => window.removeEventListener(APP_COMMAND_EVENT, handleAppCommand));
</script>

<template>
  <AppLayout :is-diff-focus-mode="activeTab === 'diff'">
    <template #header>
      <div class="pr-header">
        <div class="pr-header-top">
          <button
            class="pr-back-button"
            type="button"
            :title="t('prDetail.back')"
            :aria-label="t('prDetail.back')"
            data-testid="back-to-pr-list"
            @click="router.push({ name: 'pr-list' })"
          >
            <svg
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
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>{{ t("prDetail.backLabel") }}</span>
          </button>
          <h2 v-if="pr.currentPr">
            <button
              v-if="pr.currentPr.web_url"
              class="pr-title-link"
              type="button"
              :title="t('prDetail.openBrowser')"
              :aria-label="t('prDetail.openBrowserTitle', { title: pr.currentPr.summary.title })"
              data-testid="pr-title-link"
              @click="handleOpenInBrowser(pr.currentPr.web_url)"
            >
              {{ pr.currentPr.summary.title }}
            </button>
            <template v-else>{{ pr.currentPr.summary.title }}</template>
          </h2>
          <div class="pr-header-skeleton" v-else>
            <div class="skeleton skeleton-title" />
            <div class="skeleton skeleton-subtitle" />
          </div>
        </div>
        <p v-if="titleLinkError" class="error-msg" role="alert" data-testid="pr-title-link-error">
          {{ titleLinkError }}
        </p>
        <div class="pr-meta" v-if="pr.currentPr">
          <span class="branch">
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
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
            </svg>
            {{ pr.currentPr.source_branch }} → {{ pr.currentPr.target_branch }}
          </span>
          <span class="author">{{
            t("prDetail.byAuthor", { author: pr.currentPr.summary.author.login })
          }}</span>
          <span :class="['pr-state-badge', pr.currentPr.summary.state]">
            {{
              {
                open: t("pr.open"),
                closed: t("pr.closed"),
                merged: t("pr.merged"),
                all: "",
              }[pr.currentPr.summary.state]
            }}
          </span>
        </div>

        <div v-if="pr.currentPr" class="pr-actions">
          <div v-if="isOpen" class="merge-group">
            <MergeReadinessPanel
              :readiness="pr.mergeReadiness"
              :loading="pr.readinessLoading"
              :error="pr.readinessError"
              @retry="pr.fetchMergeReadiness(platform, owner, repo, number)"
            />
            <div class="merge-btn-wrapper">
              <button
                class="btn btn-primary merge-main"
                :disabled="!canMerge || operating"
                @click="handleMerge"
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
                  <circle cx="18" cy="18" r="3" />
                  <circle cx="6" cy="6" r="3" />
                  <path d="M6 21V9a9 9 0 0 0 9 9" />
                </svg>
                {{ mergeButtonLabel }}
              </button>
              <button
                class="btn btn-primary merge-caret"
                :disabled="!canMerge || operating"
                @click="dropdownOpen = !dropdownOpen"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <div v-if="dropdownOpen" class="merge-dropdown">
                <button
                  v-for="s in availableStrategies"
                  :key="s.value"
                  class="dropdown-item"
                  :class="{ active: selectedStrategy === s.value }"
                  @click="
                    selectedStrategy = s.value;
                    dropdownOpen = false;
                  "
                >
                  {{ s.label }}
                </button>
              </div>
            </div>
            <input
              v-model="commitMessage"
              class="input merge-commit-message"
              type="text"
              :disabled="operating"
              placeholder="Commit message"
            />
            <label
              v-if="platformCapabilities?.supports_issue_auto_close"
              class="close-issues-checkbox"
            >
              <input v-model="closeRelatedIssues" type="checkbox" :disabled="operating" />
              {{ t("prDetail.closeIssuesAfterMerge") }}
            </label>
            <p v-if="capabilityStore.errors[platform]" class="error-msg">
              {{
                t("prDetail.capabilityUnavailable", {
                  message: capabilityStore.errors[platform],
                })
              }}
            </p>
          </div>

          <div v-if="isOpen" class="close-btn-wrapper">
            <button
              class="btn btn-outline btn-danger"
              data-testid="close-pr-button"
              :disabled="!canClose || operating"
              :title="closeDisabledReason || t('prDetail.close')"
              @click="requestClose"
            >
              {{ t("prDetail.close") }}
            </button>
          </div>

          <div v-if="canReopen" class="close-btn-wrapper">
            <button class="btn btn-outline btn-reopen" :disabled="operating" @click="handleReopen">
              {{ t("prDetail.reopen") }}
            </button>
          </div>

          <span v-if="statusMsg" class="status-msg">{{ statusMsg }}</span>
        </div>

        <div v-if="pr.error" class="error-box">
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
            {{ t("prDetail.operationFailed") }}
          </p>
          <p class="error-msg">{{ pr.error }}</p>
        </div>
        <div v-if="mergeWarning" class="merge-warning" role="alert">
          {{ mergeWarning }}
        </div>
      </div>
    </template>

    <div v-if="pr.detailLoading" class="loading-state">
      <div class="skeleton skeleton-tabs" />
      <div class="skeleton skeleton-content" />
    </div>

    <div v-else-if="pr.currentPr" class="pr-detail">
      <div ref="tabsRef" class="tabs">
        <button :class="{ active: activeTab === 'reviews' }" @click="selectTab('reviews')">
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
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {{ t("prDetail.reviews") }}
        </button>
        <button
          v-if="isMergeContextVisible"
          :class="{ active: activeTab === 'dependencies' }"
          @click="selectTab('dependencies')"
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
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="18" r="2" />
            <path d="M6 8v3a7 7 0 0 0 7 7h3" />
            <path d="M18 16V8" />
            <circle cx="18" cy="6" r="2" />
          </svg>
          {{ t("prDetail.dependencies") }}
        </button>
        <button :class="{ active: activeTab === 'diff' }" @click="selectTab('diff')">
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
            <path d="M12 3v18M3 12h18" />
          </svg>
          Diff
        </button>
        <button :class="{ active: activeTab === 'ai' }" @click="selectTab('ai')">
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
            <path d="M12 2a4 4 0 0 1 4 4c0 2-2 4-4 4s-4-2-4-4a4 4 0 0 1 4-4z" />
            <path d="M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z" />
          </svg>
          {{
            locatingAiSuggestion && activeTab === "diff"
              ? t("prDetail.backToAi")
              : t("prDetail.aiReview")
          }}
        </button>
      </div>

      <div class="tab-content">
        <div v-if="activeTab === 'diff'">
          <p v-if="diffLocationError" class="error-msg diff-location-error" role="alert">
            {{ diffLocationError }}
          </p>
          <div
            v-if="pr.diffLoading && !displayedDiff"
            class="loading-state"
            role="status"
            aria-live="polite"
            data-testid="diff-loading-state"
          >
            <p class="text-secondary">{{ t("prDetail.loadingDiff") }}</p>
            <div class="skeleton skeleton-content" />
          </div>
          <template v-else>
            <DiffViewer
              :diff="displayedDiff"
              :platform="platform"
              :owner="owner"
              :repo="repo"
              :pr-number="number"
              :base-sha="displayedBaseSha"
              :head-sha="displayedHeadSha"
              :base-owner="displayedBaseRepository.owner"
              :base-repo="displayedBaseRepository.repo"
              :head-owner="headRepository?.owner"
              :head-repo="headRepository?.repo"
              :location-request="diffLocationRequest"
              :thread-summary="isCommitRangeView ? null : reviewThreadSummary"
              :can-sync-viewed-files="
                !isCommitRangeView &&
                (platformCapabilities?.supports_remote_file_viewed_state ?? false)
              "
              :read-only="isCommitRangeView"
              @add-comment="handleAddComment"
              @location-result="handleDiffLocationResult"
              @review-progress="unviewedFileCount = $event"
            >
              <template #scope>
                <DiffCommitSelector
                  :commits="pr.commits"
                  :truncated-end="pr.commitsTruncatedEnd"
                  :commits-loading="pr.commitsLoading"
                  :commits-error="pr.commitsError"
                  :selection="pr.commitRange"
                  :range-loading="pr.rangeDiffLoading"
                  :range-error="pr.rangeDiffError"
                  @update:selection="handleCommitRangeChange"
                  @retry="reloadPrCommits"
                />
                <p v-if="isCommitRangeView" class="commit-range-note" role="note">
                  {{ t("prDetail.commitRangeNote") }}
                </p>
              </template>
            </DiffViewer>
            <p v-if="commentError" class="error-msg">{{ commentError }}</p>
            <p v-if="commentSuccess" class="success-msg">
              {{ t("prDetail.inlineCommentSubmitted") }}
            </p>
            <ReviewForm
              ref="reviewFormRef"
              :platform="platform"
              :owner="owner"
              :repo="repo"
              :pr-number="number"
              :unviewed-file-count="unviewedFileCount"
              :unresolved-thread-count="reviewThreadSummary?.unresolved ?? 0"
            />
          </template>
        </div>
        <div
          v-if="isMergeContextVisible && dependencyPanelMounted"
          v-show="activeTab === 'dependencies'"
          class="merge-context-view"
        >
          <PrMergeQueuePanel
            v-if="uiSettings.isPrDependenciesVisible && uiSettings.isMergeQueueVisible"
            :platform="platform"
            :owner="owner"
            :repo="repo"
            :pr-number="number"
            :revision="pr.currentPr.summary.updated_at"
            :queue-kind="platformCapabilities?.merge_queue_kind"
          />
          <PrDependenciesPanel
            v-if="uiSettings.isPrDependenciesVisible"
            :platform="platform"
            :owner="owner"
            :repo="repo"
            :pr-number="number"
            :revision="pr.currentPr.summary.updated_at"
          />
        </div>
        <div v-show="activeTab === 'reviews'">
          <PrMetadataPanel
            :detail="pr.currentPr"
            :platform="platform"
            :owner="owner"
            :repo="repo"
            :capabilities="platformCapabilities ?? null"
            :saving="metadataSaving"
            :status-message="metadataStatus"
            :error-message="metadataError"
            @save="handleMetadataSave"
            @open-issue="handleOpenIssueDetail"
            @open-link="handlePrContentLink"
            @open-external="handleOpenInBrowser"
          />
          <ReviewList
            ref="reviewListRef"
            :platform="platform"
            :owner="owner"
            :repo="repo"
            :pr-number="number"
            :head-sha="pr.currentPr?.head_sha ?? null"
            :diff-files="pr.diff?.files"
            :diff-patches="pr.diff?.patches"
            :can-resolve-threads="platformCapabilities?.supports_review_thread_resolution ?? false"
            @thread-summary="reviewThreadSummary = $event"
            @locate-comment="handleReviewCommentLocate"
            @open-link="handlePrContentLink"
          />
        </div>
        <div v-if="aiPanelMounted" v-show="activeTab === 'ai'">
          <AiReviewPanel
            ref="aiPanelRef"
            :platform="platform"
            :owner="owner"
            :repo="repo"
            :pr-number="number"
            :diff="pr.diff?.diff ?? ''"
            :head-sha="pr.currentPr?.head_sha ?? ''"
            :context="
              pr.currentPr ? { title: pr.currentPr.summary.title, body: pr.currentPr.body } : null
            "
            :supports-compare-diff="platformCapabilities?.supports_compare_diff ?? false"
            @locate-suggestion="handleAiSuggestionLocate"
          />
        </div>
      </div>
    </div>
    <CloseConfirmDialog
      :open="closeConfirmOpen"
      :title="t('prDetail.closeTitle', { number })"
      :repository="`${owner}/${repo}`"
      :target="`#${number} ${pr.currentPr?.summary.title ?? ''}`"
      :impact="t('prDetail.closeImpact')"
      :warning="t('prDetail.closeWarning')"
      :confirm-label="t('prDetail.close')"
      :loading="operating"
      :error="closeError"
      @cancel="cancelClose"
      @confirm="handleClose"
    />
  </AppLayout>
</template>

<style scoped src="./PrDetailPage.css"></style>
