import { defineStore } from "pinia";
import { computed, ref } from "vue";
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
  PrListQuery,
} from "@/types";
import {
  prList,
  prListStatuses,
  prListStatusesCancel,
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
import { translate } from "@/i18n";
import { useAsyncRequest } from "@/composables/useAsyncRequest";

const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_LIST_QUERY: Readonly<Required<PrListQuery>> = {
  title: "",
  author: "",
  label: "",
  reviews: null,
  assignee: "",
  reviewer: "",
  sort: "updated_desc",
};

export function isDefaultPrListQuery(query: PrListQuery): boolean {
  return (Object.keys(DEFAULT_LIST_QUERY) as Array<keyof PrListQuery>).every(
    (field) => query[field] === DEFAULT_LIST_QUERY[field],
  );
}

export const usePrStore = defineStore("pr", () => {
  const list = ref<PrSummary[]>([]);
  const currentPr = ref<PrDetail | null>(null);
  const diff = ref<DiffResult | null>(null);
  // PR / MR 的提交列表与「按 commit 维度查看」的当前选择。
  const commits = ref<PrCommitSummary[]>([]);
  const commitsTruncatedEnd = ref<PrCommitTruncatedEnd | null>(null);
  const commitsError = ref<string | null>(null);
  // null 表示查看整体 Diff；非 null 时 rangeDiff 承载所选提交区间的 Diff。
  const commitRange = ref<CommitRangeSelection | null>(null);
  const rangeDiff = ref<DiffResult | null>(null);
  // 当前区间 Diff 的 compare 端点；Diff 上下文展开按它读取文件内容，不能沿用 PR 的 base/head。
  const rangeRevisions = ref<CommitRangeRevisions | null>(null);
  const rangeDiffError = ref<string | null>(null);
  const mergeReadiness = ref<PrMergeReadiness | null>(null);
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
  const listQuery = ref<PrListQuery>({ ...DEFAULT_LIST_QUERY });
  const hasListQuery = computed(() => !isDefaultPrListQuery(listQuery.value));
  const stateCounts = ref<Record<PrState, number>>({
    open: 0,
    closed: 0,
    merged: 0,
    all: 0,
  });
  let listRequestSequence = 0;
  const detailRequest = useAsyncRequest();
  const diffRequest = useAsyncRequest();
  const commitsRequest = useAsyncRequest();
  const rangeDiffRequest = useAsyncRequest();
  const countsRequest = useAsyncRequest();
  const readinessRequest = useAsyncRequest();
  const metadataRequest = useAsyncRequest();
  let listContextKey = "";
  let detailContextKey = "";
  let activeListStatusRequestId: string | null = null;

  function cancelListStatusSupplement() {
    const requestId = activeListStatusRequestId;
    activeListStatusRequestId = null;
    if (requestId) {
      void prListStatusesCancel(requestId).catch(() => {
        // 取消是尽力而为；批次已在本地作废，迟到结果仍不会覆盖当前列表。
      });
    }
  }

  function clearContext() {
    const filtersChanged =
      filters.value.state !== "open" ||
      filters.value.page !== 1 ||
      !isDefaultPrListQuery(listQuery.value);
    filters.value.state = "open";
    filters.value.page = 1;
    listQuery.value = { ...DEFAULT_LIST_QUERY };
    listRequestSequence++;
    detailRequest.cancel();
    diffRequest.cancel();
    commitsRequest.cancel();
    countsRequest.cancel();
    readinessRequest.cancel();
    metadataRequest.cancel();
    cancelListStatusSupplement();
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

  async function supplementListStatuses(
    platform: Platform,
    owner: string,
    repo: string,
    numbers: number[],
    sequence: number,
    contextKey: string,
  ): Promise<void> {
    if (sequence !== listRequestSequence || listContextKey !== contextKey) return;
    const requestId = crypto.randomUUID();
    activeListStatusRequestId = requestId;
    try {
      const statuses = await prListStatuses(requestId, platform, owner, repo, numbers);
      if (
        activeListStatusRequestId !== requestId ||
        sequence !== listRequestSequence ||
        listContextKey !== contextKey
      ) {
        return;
      }
      const statusesByNumber = new Map(statuses.map((item) => [item.number, item.status]));
      list.value = list.value.map((item) => {
        const status = statusesByNumber.get(item.number);
        return status && item.state === "open" ? { ...item, status } : item;
      });
    } catch {
      // 基础列表保持可用；状态补充失败时继续展示 unknown，详情页仍会执行权威检查。
    } finally {
      if (activeListStatusRequestId === requestId) activeListStatusRequestId = null;
    }
  }

  async function fetchPrList(platform: Platform, owner: string, repo: string) {
    const sequence = ++listRequestSequence;
    cancelListStatusSupplement();
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
      const result = hasListQuery.value
        ? await prList(
            platform,
            owner,
            repo,
            filters.value.state,
            filters.value.page,
            perPage.value,
            listQuery.value,
          )
        : await prList(
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
      const openNumbers = result.items
        .filter((item) => item.state === "open")
        .map((item) => item.number);
      if (platform === "github" && openNumbers.length > 0) {
        void supplementListStatuses(platform, owner, repo, openNumbers, sequence, contextKey);
      }
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
    const sequence = detailRequest.begin();
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey !== contextKey) {
      diffRequest.cancel();
      commitsRequest.cancel();
      readinessRequest.cancel();
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
    error.value = null;
    try {
      const result = await prDetail(platform, owner, repo, number);
      if (!detailRequest.isCurrent(sequence) || detailContextKey !== contextKey) return false;
      currentPr.value = result;
      return true;
    } catch (requestError) {
      if (!detailRequest.isCurrent(sequence) || detailContextKey !== contextKey) return false;
      currentPr.value = null;
      const message = typeof requestError === "string" ? requestError : String(requestError);
      error.value = /\b404\b|not found/i.test(message)
        ? translate("pr.detailNotFound", { repository: `${owner}/${repo}`, number })
        : message;
      return false;
    } finally {
      detailRequest.finish(sequence);
    }
  }

  async function refreshPrDetail(
    platform: Platform,
    owner: string,
    repo: string,
    number: number,
  ): Promise<boolean> {
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey !== contextKey) {
      return fetchPrDetail(platform, owner, repo, number);
    }

    const sequence = detailRequest.beginSilent();
    error.value = null;
    try {
      const result = await prDetail(platform, owner, repo, number);
      if (!detailRequest.isCurrent(sequence) || detailContextKey !== contextKey) return false;
      currentPr.value = result;
      return true;
    } catch (requestError) {
      if (!detailRequest.isCurrent(sequence) || detailContextKey !== contextKey) return false;
      const message = typeof requestError === "string" ? requestError : String(requestError);
      const notFound = /\b404\b|not found/i.test(message);
      if (notFound) currentPr.value = null;
      error.value = notFound
        ? translate("pr.detailNotFound", { repository: `${owner}/${repo}`, number })
        : message;
      return false;
    } finally {
      detailRequest.finish(sequence);
    }
  }

  async function fetchPrDiff(platform: Platform, owner: string, repo: string, number: number) {
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey !== contextKey) return;

    const sequence = diffRequest.begin();
    try {
      const result = await prDiff(platform, owner, repo, number);
      if (!diffRequest.isCurrent(sequence) || detailContextKey !== contextKey) return;
      diff.value = result;
    } finally {
      diffRequest.finish(sequence);
    }
  }

  /** 回到整体 Diff 视图，并作废在途的区间 Diff 请求。 */
  function resetCommitSelection() {
    rangeDiffRequest.cancel();
    commitRange.value = null;
    rangeDiff.value = null;
    rangeRevisions.value = null;
    rangeDiffError.value = null;
  }

  async function fetchPrCommits(platform: Platform, owner: string, repo: string, number: number) {
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey !== contextKey) return;

    const sequence = commitsRequest.begin();
    commitsError.value = null;
    try {
      const result = await prCommits(platform, owner, repo, number);
      if (!commitsRequest.isCurrent(sequence) || detailContextKey !== contextKey) return;
      // 提交列表变化后旧下标会指向别的提交，直接回到整体 Diff，避免展示错位的区间。
      const changed =
        result.commits.length !== commits.value.length ||
        result.commits.some((commit, index) => commit.sha !== commits.value[index]?.sha);
      commits.value = result.commits;
      commitsTruncatedEnd.value = result.truncated_end;
      if (changed) resetCommitSelection();
    } catch (requestError) {
      if (!commitsRequest.isCurrent(sequence) || detailContextKey !== contextKey) return;
      commits.value = [];
      commitsTruncatedEnd.value = null;
      commitsError.value = typeof requestError === "string" ? requestError : String(requestError);
      resetCommitSelection();
    } finally {
      commitsRequest.finish(sequence);
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
      (rangeDiff.value !== null || rangeDiffRequest.loading.value)
    ) {
      return;
    }
    const revisions = resolveCommitRangeRevisions(
      commits.value,
      range,
      currentPr.value?.base_sha ?? null,
    );
    const sequence = rangeDiffRequest.begin();
    commitRange.value = range;
    if (!revisions) {
      rangeDiff.value = null;
      rangeRevisions.value = null;
      rangeDiffRequest.finish(sequence);
      rangeDiffError.value = translate("pr.commitRangeBaseUnavailable");
      return;
    }
    rangeDiff.value = null;
    rangeRevisions.value = revisions;
    rangeDiffError.value = null;
    try {
      const result = await prCompareDiff(
        platform,
        owner,
        repo,
        revisions.baseSha,
        revisions.headSha,
      );
      if (!rangeDiffRequest.isCurrent(sequence)) return;
      rangeDiff.value = result;
    } catch (requestError) {
      if (!rangeDiffRequest.isCurrent(sequence)) return;
      rangeDiff.value = null;
      rangeDiffError.value = typeof requestError === "string" ? requestError : String(requestError);
    } finally {
      rangeDiffRequest.finish(sequence);
    }
  }

  async function fetchMergeReadiness(
    platform: Platform,
    owner: string,
    repo: string,
    number: number,
  ) {
    const sequence = readinessRequest.begin();
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    readinessError.value = null;
    try {
      const result = await prMergeReadiness(platform, owner, repo, number);
      if (
        readinessRequest.isCurrent(sequence) &&
        (!detailContextKey || detailContextKey === contextKey)
      ) {
        mergeReadiness.value = result;
      }
    } catch (e) {
      if (
        !readinessRequest.isCurrent(sequence) ||
        (detailContextKey && detailContextKey !== contextKey)
      ) {
        return;
      }
      readinessError.value = typeof e === "string" ? e : String(e);
      mergeReadiness.value = null;
    } finally {
      readinessRequest.finish(sequence);
    }
  }

  function setFilter(state: PrState) {
    filters.value.state = state;
    filters.value.page = 1;
  }

  function setListQuery(query: PrListQuery) {
    listQuery.value = {
      title: query.title.trim(),
      author: query.author.trim(),
      label: query.label.trim(),
      reviews: query.reviews,
      assignee: query.assignee.trim(),
      reviewer: query.reviewer.trim(),
      sort: query.sort,
    };
    filters.value.page = 1;
  }

  function clearListQuery() {
    setListQuery({ ...DEFAULT_LIST_QUERY });
  }

  async function fetchStateCounts(platform: Platform, owner: string, repo: string) {
    const sequence = countsRequest.beginSilent();
    // 三个平台没有统一的批量状态计数接口；用最小分页并发读取 total_count，
    // 并通过 allSettled 保留单个状态失败时的其他计数。
    const states: PrState[] = ["open", "closed", "merged", "all"];
    const results = await Promise.allSettled(
      states.map((state) => prList(platform, owner, repo, state, 1, 1)),
    );
    if (!countsRequest.isCurrent(sequence)) return;
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
    const sequence = metadataRequest.beginSilent();
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    error.value = null;
    try {
      const outcome = await prMetadataUpdate(platform, owner, repo, number, update);
      if (!metadataRequest.isCurrent(sequence) || detailContextKey !== contextKey) return null;
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
      if (!metadataRequest.isCurrent(sequence) || detailContextKey !== contextKey) return null;
      throw requestError;
    }
  }

  async function refreshPrAfterStateChange(
    platform: Platform,
    owner: string,
    repo: string,
    number: number,
  ): Promise<void> {
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey !== contextKey) return;

    const sequence = detailRequest.beginSilent();
    let refreshedDetail: PrDetail;
    try {
      refreshedDetail = await prDetail(platform, owner, repo, number);
    } catch (requestError) {
      if (!detailRequest.isCurrent(sequence) || detailContextKey !== contextKey) return;
      throw requestError;
    } finally {
      detailRequest.finish(sequence);
    }

    if (!detailRequest.isCurrent(sequence) || detailContextKey !== contextKey) return;
    currentPr.value = refreshedDetail;
    await fetchMergeReadiness(platform, owner, repo, number);
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
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey === contextKey) error.value = null;
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
      await refreshPrAfterStateChange(platform, owner, repo, number);
      return result;
    } catch (e) {
      if (detailContextKey === contextKey) {
        error.value = typeof e === "string" ? e : String(e);
      }
      throw e;
    }
  }

  async function closePr(platform: Platform, owner: string, repo: string, number: number) {
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey === contextKey) error.value = null;
    try {
      await prClose(platform, owner, repo, number);
      await refreshPrAfterStateChange(platform, owner, repo, number);
    } catch (e) {
      if (detailContextKey === contextKey) {
        error.value = typeof e === "string" ? e : String(e);
      }
      throw e;
    }
  }

  async function reopenPr(platform: Platform, owner: string, repo: string, number: number) {
    const contextKey = `${platform}:${owner}/${repo}:${number}`;
    if (detailContextKey === contextKey) error.value = null;
    try {
      await prReopen(platform, owner, repo, number);
      await refreshPrAfterStateChange(platform, owner, repo, number);
    } catch (e) {
      if (detailContextKey === contextKey) {
        error.value = typeof e === "string" ? e : String(e);
      }
      throw e;
    }
  }

  return {
    list,
    currentPr,
    diff,
    commits,
    commitsTruncatedEnd,
    commitsLoading: commitsRequest.loading,
    commitsError,
    commitRange,
    rangeDiff,
    rangeRevisions,
    rangeDiffLoading: rangeDiffRequest.loading,
    rangeDiffError,
    mergeReadiness,
    readinessLoading: readinessRequest.loading,
    readinessError,
    detailLoading: detailRequest.loading,
    diffLoading: diffRequest.loading,
    loading,
    error,
    totalPages,
    listTotalCount,
    listTruncated,
    perPage,
    pageSizes: PAGE_SIZES,
    filters,
    listQuery,
    hasListQuery,
    nextPage,
    prevPage,
    setPage,
    setPerPage,
    stateCounts,
    clearContext,
    cancelListStatusSupplement,
    fetchPrList,
    fetchPrDetail,
    refreshPrDetail,
    fetchPrDiff,
    fetchPrCommits,
    selectCommitRange,
    resetCommitSelection,
    fetchMergeReadiness,
    updateMetadata,
    fetchStateCounts,
    setFilter,
    setListQuery,
    clearListQuery,
    mergePr,
    closePr,
    reopenPr,
  };
});
