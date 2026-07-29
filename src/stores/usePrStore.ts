import { defineStore } from "pinia";
import { ref } from "vue";
import type {
  Platform,
  PrSummary,
  PrCommitSummary,
  PrCommitTruncatedEnd,
  PrDetail,
  DiffResult,
  PrState,
  MergeStrategy,
  PrMergeReadiness,
  PrMetadataUpdate,
  PrMetadataUpdateOutcome,
} from "@/types";
import {
  prList,
  prDetail,
  prDiff,
  prCommits,
  prCompareDiff,
  prMerge,
  prMergeReadiness,
  prClose,
  prReopen,
  prMetadataUpdate,
} from "@/api";
import {
  resolveCommitRangeRevisions,
  type CommitRangeRevisions,
  type CommitRangeSelection,
} from "@/utils/commitRange";

const PAGE_SIZES = [10, 20, 50, 100] as const;

export const usePrStore = defineStore("pr", () => {
  const list = ref<PrSummary[]>([]);
  const currentPr = ref<PrDetail | null>(null);
  const diff = ref<DiffResult | null>(null);
  // PR / MR 的提交列表与「按 commit 维度查看」的当前选择。
  const commits = ref<PrCommitSummary[]>([]);
  const commitsTruncatedEnd = ref<PrCommitTruncatedEnd | null>(null);
  const commitsLoading = ref(false);
  const commitsError = ref<string | null>(null);
  // null 表示查看整体 Diff；非 null 时 rangeDiff 承载所选提交区间的 Diff。
  const commitRange = ref<CommitRangeSelection | null>(null);
  const rangeDiff = ref<DiffResult | null>(null);
  // 当前区间 Diff 的 compare 端点；Diff 上下文展开按它读取文件内容，不能沿用 PR 的 base/head。
  const rangeRevisions = ref<CommitRangeRevisions | null>(null);
  const rangeDiffLoading = ref(false);
  const rangeDiffError = ref<string | null>(null);
  const mergeReadiness = ref<PrMergeReadiness | null>(null);
  const readinessLoading = ref(false);
  const readinessError = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const totalPages = ref(1);
  const listTotalCount = ref(0);
  const listTruncated = ref(false);
  const perPage = ref<number>(20);
  const filters = ref<{ state: PrState; page: number }>({
    state: "open",
    page: 1,
  });
  const stateCounts = ref<Record<PrState, number>>({
    open: 0,
    closed: 0,
    merged: 0,
    all: 0,
  });
  let listRequestSequence = 0;
  let detailRequestSequence = 0;
  let diffRequestSequence = 0;
  let commitsRequestSequence = 0;
  let rangeDiffRequestSequence = 0;
  let countsRequestSequence = 0;
  let readinessRequestSequence = 0;
  let metadataRequestSequence = 0;
  let listContextKey = "";
  let detailContextKey = "";

  function clearContext() {
    const filtersChanged = filters.value.state !== "open" || filters.value.page !== 1;
    filters.value.state = "open";
    filters.value.page = 1;
    listRequestSequence++;
    detailRequestSequence++;
    diffRequestSequence++;
    commitsRequestSequence++;
    rangeDiffRequestSequence++;
    countsRequestSequence++;
    readinessRequestSequence++;
    metadataRequestSequence++;
    listContextKey = "";
    detailContextKey = "";
    list.value = [];
    currentPr.value = null;
    diff.value = null;
    resetCommitSelection();
    commits.value = [];
    commitsTruncatedEnd.value = null;
    commitsError.value = null;
    mergeReadiness.value = null;
    readinessError.value = null;
    error.value = null;
    commitsLoading.value = false;
    totalPages.value = 1;
    listTotalCount.value = 0;
    listTruncated.value = false;
    stateCounts.value = { open: 0, closed: 0, merged: 0, all: 0 };
    return filtersChanged;
  }

  function nextPage() {
    if (filters.value.page < totalPages.value) {
      filters.value.page++;
    }
  }

  function prevPage() {
    if (filters.value.page > 1) {
      filters.value.page--;
    }
  }

  function setPage(page: number) {
    if (!Number.isInteger(page) || page < 1 || page > totalPages.value) return;
    filters.value.page = page;
  }

  function setPerPage(n: number) {
    perPage.value = n;
    filters.value.page = 1;
  }

  async function fetchPrList(platform: Platform, owner: string, repo: string) {
    const sequence = ++listRequestSequence;
    const contextKey = `${platform}:${owner}/${repo}`;
    if (listContextKey !== contextKey) {
      list.value = [];
      totalPages.value = 1;
      listTotalCount.value = 0;
      listTruncated.value = false;
    }
    listContextKey = contextKey;
    loading.value = true;
    error.value = null;
    try {
      const result = await prList(
        platform,
        owner,
        repo,
        filters.value.state,
        filters.value.page,
        perPage.value,
      );
      if (sequence !== listRequestSequence) return;
      list.value = result.items;
      totalPages.value = result.total_pages;
      listTotalCount.value = result.total_count;
      listTruncated.value = result.truncated === true;
    } catch (e) {
      if (sequence !== listRequestSequence) return;
      error.value = typeof e === "string" ? e : String(e);
      list.value = [];
      totalPages.value = 1;
      listTotalCount.value = 0;
      listTruncated.value = false;
    } finally {
      if (sequence === listRequestSequence) loading.value = false;
    }
  }

  async function fetchPrDetail(
    platform: Platform,
    owner: string,
    repo: string,
    number: number,
  ): Promise<boolean> {
    const sequence = ++detailRequestSequence;
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey !== contextKey) {
      currentPr.value = null;
      diff.value = null;
      commits.value = [];
      commitsTruncatedEnd.value = null;
      commitsError.value = null;
      resetCommitSelection();
      mergeReadiness.value = null;
      readinessError.value = null;
    }
    detailContextKey = contextKey;
    loading.value = true;
    error.value = null;
    try {
      const result = await prDetail(platform, owner, repo, number);
      if (sequence !== detailRequestSequence || detailContextKey !== contextKey) return false;
      currentPr.value = result;
      return true;
    } catch (requestError) {
      if (sequence !== detailRequestSequence || detailContextKey !== contextKey) return false;
      currentPr.value = null;
      const message = typeof requestError === "string" ? requestError : String(requestError);
      error.value = /\b404\b|not found/i.test(message)
        ? `找不到 ${owner}/${repo} #${number}，该 PR / MR 可能不存在，或当前 Token 无权访问。`
        : message;
      return false;
    } finally {
      if (sequence === detailRequestSequence) loading.value = false;
    }
  }

  async function fetchPrDiff(platform: Platform, owner: string, repo: string, number: number) {
    const sequence = ++diffRequestSequence;
    loading.value = true;
    try {
      const result = await prDiff(platform, owner, repo, number);
      if (sequence === diffRequestSequence) diff.value = result;
    } finally {
      if (sequence === diffRequestSequence) loading.value = false;
    }
  }

  /** 回到整体 Diff 视图，并作废在途的区间 Diff 请求。 */
  function resetCommitSelection() {
    rangeDiffRequestSequence++;
    commitRange.value = null;
    rangeDiff.value = null;
    rangeRevisions.value = null;
    rangeDiffError.value = null;
    rangeDiffLoading.value = false;
  }

  async function fetchPrCommits(platform: Platform, owner: string, repo: string, number: number) {
    const sequence = ++commitsRequestSequence;
    commitsLoading.value = true;
    commitsError.value = null;
    try {
      const result = await prCommits(platform, owner, repo, number);
      if (sequence !== commitsRequestSequence) return;
      // 提交列表变化后旧下标会指向别的提交，直接回到整体 Diff，避免展示错位的区间。
      const changed =
        result.commits.length !== commits.value.length ||
        result.commits.some((commit, index) => commit.sha !== commits.value[index]?.sha);
      commits.value = result.commits;
      commitsTruncatedEnd.value = result.truncated_end;
      if (changed) resetCommitSelection();
    } catch (requestError) {
      if (sequence !== commitsRequestSequence) return;
      commits.value = [];
      commitsTruncatedEnd.value = null;
      commitsError.value = typeof requestError === "string" ? requestError : String(requestError);
      resetCommitSelection();
    } finally {
      if (sequence === commitsRequestSequence) commitsLoading.value = false;
    }
  }

  /**
   * 选择要查看的提交区间；传入 null 回到整体 Diff。
   *
   * 无法从提交列表推导出可用的 base/head 时不发请求，直接给出原因，
   * 避免把不完整的历史当成该区间的真实变更。
   */
  async function selectCommitRange(
    platform: Platform,
    owner: string,
    repo: string,
    range: CommitRangeSelection | null,
  ) {
    if (!range) {
      resetCommitSelection();
      return;
    }
    // 重复点击同一个提交不该再发一次 compare；失败后（既没有结果也不在加载中）仍允许重试。
    const current = commitRange.value;
    if (
      current &&
      current.startIndex === range.startIndex &&
      current.endIndex === range.endIndex &&
      (rangeDiff.value !== null || rangeDiffLoading.value)
    ) {
      return;
    }
    const revisions = resolveCommitRangeRevisions(
      commits.value,
      range,
      currentPr.value?.base_sha ?? null,
    );
    const sequence = ++rangeDiffRequestSequence;
    commitRange.value = range;
    if (!revisions) {
      rangeDiff.value = null;
      rangeRevisions.value = null;
      rangeDiffLoading.value = false;
      rangeDiffError.value = "无法确定所选提交的对比基准，请改用整体 Diff。";
      return;
    }
    rangeDiff.value = null;
    rangeRevisions.value = revisions;
    rangeDiffError.value = null;
    rangeDiffLoading.value = true;
    try {
      const result = await prCompareDiff(
        platform,
        owner,
        repo,
        revisions.baseSha,
        revisions.headSha,
      );
      if (sequence !== rangeDiffRequestSequence) return;
      rangeDiff.value = result;
    } catch (requestError) {
      if (sequence !== rangeDiffRequestSequence) return;
      rangeDiff.value = null;
      rangeDiffError.value = typeof requestError === "string" ? requestError : String(requestError);
    } finally {
      if (sequence === rangeDiffRequestSequence) rangeDiffLoading.value = false;
    }
  }

  async function fetchMergeReadiness(
    platform: Platform,
    owner: string,
    repo: string,
    number: number,
  ) {
    const sequence = ++readinessRequestSequence;
    readinessLoading.value = true;
    readinessError.value = null;
    try {
      const result = await prMergeReadiness(platform, owner, repo, number);
      if (sequence === readinessRequestSequence) mergeReadiness.value = result;
    } catch (e) {
      if (sequence !== readinessRequestSequence) return;
      readinessError.value = typeof e === "string" ? e : String(e);
      mergeReadiness.value = null;
    } finally {
      if (sequence === readinessRequestSequence) readinessLoading.value = false;
    }
  }

  function setFilter(state: PrState) {
    filters.value.state = state;
    filters.value.page = 1;
  }

  async function fetchStateCounts(platform: Platform, owner: string, repo: string) {
    const sequence = ++countsRequestSequence;
    const states: PrState[] = ["open", "closed", "merged", "all"];
    const results = await Promise.allSettled(
      states.map((state) => prList(platform, owner, repo, state, 1, 1)),
    );
    if (sequence !== countsRequestSequence) return;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        stateCounts.value[states[index]] = result.value.total_count;
      }
    });
  }

  async function updateMetadata(
    platform: Platform,
    owner: string,
    repo: string,
    number: number,
    update: PrMetadataUpdate,
  ): Promise<PrMetadataUpdateOutcome | null> {
    const sequence = ++metadataRequestSequence;
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    error.value = null;
    try {
      const outcome = await prMetadataUpdate(platform, owner, repo, number, update);
      if (sequence !== metadataRequestSequence || detailContextKey !== contextKey) return null;
      if (outcome.detail) {
        currentPr.value = outcome.detail;
        if (listContextKey === `${platform}:${owner}/${repo}`) {
          const index = list.value.findIndex((item) => item.number === number);
          if (index >= 0) list.value[index] = outcome.detail.summary;
        }
      }
      if (outcome.failures.length > 0) {
        error.value = outcome.failures.map((failure) => failure.message).join("；");
      }
      return outcome;
    } catch (requestError) {
      if (sequence !== metadataRequestSequence || detailContextKey !== contextKey) return null;
      throw requestError;
    }
  }

  async function mergePr(
    platform: Platform,
    owner: string,
    repo: string,
    number: number,
    strategy: MergeStrategy,
    commitTitle?: string,
    commitMessage?: string,
    closeIssues?: boolean,
  ) {
    error.value = null;
    try {
      const result = await prMerge(
        platform,
        owner,
        repo,
        number,
        strategy,
        commitTitle,
        commitMessage,
        closeIssues,
      );
      currentPr.value = await prDetail(platform, owner, repo, number);
      await fetchMergeReadiness(platform, owner, repo, number);
      return result;
    } catch (e) {
      error.value = typeof e === "string" ? e : String(e);
      throw e;
    }
  }

  async function closePr(platform: Platform, owner: string, repo: string, number: number) {
    error.value = null;
    try {
      await prClose(platform, owner, repo, number);
      currentPr.value = await prDetail(platform, owner, repo, number);
      await fetchMergeReadiness(platform, owner, repo, number);
    } catch (e) {
      error.value = typeof e === "string" ? e : String(e);
      throw e;
    }
  }

  async function reopenPr(platform: Platform, owner: string, repo: string, number: number) {
    error.value = null;
    try {
      await prReopen(platform, owner, repo, number);
      currentPr.value = await prDetail(platform, owner, repo, number);
      await fetchMergeReadiness(platform, owner, repo, number);
    } catch (e) {
      error.value = typeof e === "string" ? e : String(e);
      throw e;
    }
  }

  return {
    list,
    currentPr,
    diff,
    commits,
    commitsTruncatedEnd,
    commitsLoading,
    commitsError,
    commitRange,
    rangeDiff,
    rangeRevisions,
    rangeDiffLoading,
    rangeDiffError,
    mergeReadiness,
    readinessLoading,
    readinessError,
    loading,
    error,
    totalPages,
    listTotalCount,
    listTruncated,
    perPage,
    pageSizes: PAGE_SIZES,
    filters,
    nextPage,
    prevPage,
    setPage,
    setPerPage,
    stateCounts,
    clearContext,
    fetchPrList,
    fetchPrDetail,
    fetchPrDiff,
    fetchPrCommits,
    selectCommitRange,
    resetCommitSelection,
    fetchMergeReadiness,
    updateMetadata,
    fetchStateCounts,
    setFilter,
    mergePr,
    closePr,
    reopenPr,
  };
});
