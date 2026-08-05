import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  prCommits,
  prCompareDiff,
  prDetail,
  prDiff,
  prList,
  prListStatuses,
  prListStatusesCancel,
  prMerge,
  prMergeReadiness,
  prMetadataUpdate,
  prClose,
  prReopen,
} from "@/api";
import { DEFAULT_LIST_QUERY, isDefaultPrListQuery, usePrStore } from "@/stores/usePrStore";
import type {
  DiffResult,
  Paginated,
  PrCommitSummary,
  PrDetail,
  PrSummary,
  PrMergeReadiness,
} from "@/types";
import { setAppLocale } from "@/i18n";

vi.mock("@/api", () => ({
  prList: vi.fn(),
  prListStatuses: vi.fn().mockResolvedValue([]),
  prListStatusesCancel: vi.fn().mockResolvedValue(undefined),
  prDetail: vi.fn(),
  prDiff: vi.fn(),
  prCommits: vi.fn(),
  prCompareDiff: vi.fn(),
  prMerge: vi.fn(),
  prMergeReadiness: vi.fn().mockResolvedValue(null),
  prMetadataUpdate: vi.fn(),
  prClose: vi.fn(),
  prReopen: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createPrDetail(
  number: number,
  title: string,
  state: PrDetail["summary"]["state"] = "open",
): PrDetail {
  return {
    summary: {
      number,
      title,
      author: { id: number, login: `user-${number}`, name: `User ${number}`, avatar_url: "" },
      state,
      created_at: "",
      updated_at: "",
      labels: [],
    },
    body: "",
    source_branch: `feature-${number}`,
    target_branch: "main",
    mergeable: true,
    head_sha: `head-${number}`,
    base_sha: "base-sha",
    draft: false,
    reviewers: [],
    assignees: [],
    milestone: null,
    metadata_permissions: {
      can_edit_title_body: true,
      can_toggle_draft: true,
      can_manage_reviewers: true,
      can_manage_assignees: true,
      can_manage_labels: true,
      can_manage_milestone: true,
    },
  };
}

type PrStore = ReturnType<typeof usePrStore>;

async function expectStateChangeRefreshToIgnoreNavigation(
  prepareAction: () => void,
  executeAction: (store: PrStore) => Promise<unknown>,
): Promise<void> {
  const initialDetail = createPrDetail(1, "PR A");
  const lateDetail = createPrDetail(1, "迟到的 PR A");
  const currentDetail = createPrDetail(2, "PR B");
  const lateRefresh = deferred<PrDetail>();

  vi.mocked(prDetail)
    .mockReset()
    .mockResolvedValueOnce(initialDetail)
    .mockReturnValueOnce(lateRefresh.promise)
    .mockResolvedValueOnce(currentDetail);
  vi.mocked(prMergeReadiness).mockReset();
  prepareAction();

  const store = usePrStore();
  await store.fetchPrDetail("github", "old", "repo", 1);
  const pendingAction = executeAction(store);
  await vi.waitFor(() => expect(prDetail).toHaveBeenCalledTimes(2));

  await store.fetchPrDetail("gitlab", "new", "repo", 2);
  lateRefresh.resolve(lateDetail);
  await pendingAction;

  expect(store.currentPr).toEqual(currentDetail);
  expect(prMergeReadiness).not.toHaveBeenCalled();
  expect(store.error).toBeNull();
}

describe("usePrStore", () => {
  it("默认查询判断不依赖字段顺序，并识别非默认字段", () => {
    const reorderedQuery = {
      sort: DEFAULT_LIST_QUERY.sort,
      assignee: DEFAULT_LIST_QUERY.assignee,
      reviews: DEFAULT_LIST_QUERY.reviews,
      label: DEFAULT_LIST_QUERY.label,
      author: DEFAULT_LIST_QUERY.author,
      title: DEFAULT_LIST_QUERY.title,
    };

    expect(isDefaultPrListQuery(reorderedQuery)).toBe(true);
    expect(isDefaultPrListQuery({ ...reorderedQuery, label: "bug" })).toBe(false);
  });

  beforeEach(() => {
    setAppLocale("zh-CN");
    setActivePinia(createPinia());
    vi.mocked(prListStatuses).mockReset();
    vi.mocked(prListStatuses).mockResolvedValue([]);
    vi.mocked(prListStatusesCancel).mockReset();
    vi.mocked(prListStatusesCancel).mockResolvedValue(undefined);
  });

  it("清空平台上下文后忽略迟到的列表响应", async () => {
    const oldRequest = deferred<Paginated<PrSummary>>();
    vi.mocked(prList)
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce({ items: [], page: 1, total_pages: 1, total_count: 0 });
    const store = usePrStore();

    const pending = store.fetchPrList("github", "old", "repo");
    store.clearContext();
    await store.fetchPrList("gitlab", "new", "repo");
    oldRequest.resolve({
      items: [
        {
          number: 1,
          title: "旧平台 PR",
          author: { id: 1, login: "old", name: "Old", avatar_url: "" },
          state: "open",
          created_at: "",
          updated_at: "",
          labels: [],
        },
      ],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
    await pending;

    expect(store.list).toEqual([]);
  });

  it("保留 GitHub Search 截断状态供列表页提示", async () => {
    vi.mocked(prList).mockResolvedValueOnce({
      items: [],
      page: 1,
      total_pages: 10,
      total_count: 1001,
      truncated: true,
    });
    const store = usePrStore();

    await store.fetchPrList("github", "owner", "repo");

    expect(store.listTruncated).toBe(true);
    expect(store.listTotalCount).toBe(1001);
    store.clearContext();
    expect(store.listTruncated).toBe(false);
    expect(store.listTotalCount).toBe(0);
  });

  it("GitHub 基础列表返回后立即结束加载，并在后台回填状态", async () => {
    const statusRequest =
      deferred<Array<{ number: number; status: NonNullable<PrSummary["status"]> }>>();
    vi.mocked(prList).mockResolvedValueOnce({
      items: [
        {
          number: 42,
          title: "快速显示基础列表",
          author: { id: 1, login: "dev", name: "Dev", avatar_url: "" },
          state: "open",
          created_at: "",
          updated_at: "",
          labels: [],
          status: {
            status: "unknown",
            draft: null,
            has_conflicts: null,
            checks_status: "unknown",
            approvals_status: "unknown",
            blocking_reasons: [],
          },
        },
      ],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
    vi.mocked(prListStatuses).mockReturnValueOnce(statusRequest.promise);
    const store = usePrStore();

    await store.fetchPrList("github", "owner", "repo");

    expect(store.loading).toBe(false);
    expect(store.list[0].status?.status).toBe("unknown");
    expect(prListStatuses).toHaveBeenCalledWith(
      expect.any(String),
      "github",
      "owner",
      "repo",
      [42],
    );

    statusRequest.resolve([
      {
        number: 42,
        status: {
          status: "ready",
          draft: false,
          has_conflicts: false,
          checks_status: "ready",
          approvals_status: "ready",
          blocking_reasons: [],
        },
      },
    ]);
    await statusRequest.promise;
    await Promise.resolve();

    expect(store.list[0].status?.status).toBe("ready");
  });

  it("翻页时取消旧的 GitHub 状态补充并忽略迟到结果", async () => {
    const oldStatusRequest =
      deferred<Array<{ number: number; status: NonNullable<PrSummary["status"]> }>>();
    vi.mocked(prList)
      .mockResolvedValueOnce({
        items: [
          {
            number: 1,
            title: "第一页",
            author: { id: 1, login: "dev", name: "Dev", avatar_url: "" },
            state: "open",
            created_at: "",
            updated_at: "",
            labels: [],
          },
        ],
        page: 1,
        total_pages: 2,
        total_count: 2,
      })
      .mockResolvedValueOnce({
        items: [
          {
            number: 2,
            title: "第二页",
            author: { id: 1, login: "dev", name: "Dev", avatar_url: "" },
            state: "open",
            created_at: "",
            updated_at: "",
            labels: [],
          },
        ],
        page: 2,
        total_pages: 2,
        total_count: 2,
      });
    vi.mocked(prListStatuses)
      .mockReturnValueOnce(oldStatusRequest.promise)
      .mockResolvedValueOnce([]);
    const store = usePrStore();
    await store.fetchPrList("github", "owner", "repo");
    const oldRequestId = vi.mocked(prListStatuses).mock.calls[0][0];
    store.setPage(2);
    await store.fetchPrList("github", "owner", "repo");

    expect(prListStatusesCancel).toHaveBeenCalledWith(oldRequestId);

    oldStatusRequest.resolve([
      {
        number: 1,
        status: {
          status: "blocked",
          draft: false,
          has_conflicts: true,
          checks_status: "blocked",
          approvals_status: "unknown",
          blocking_reasons: [],
        },
      },
    ]);
    await oldStatusRequest.promise;
    await Promise.resolve();

    expect(store.list.map((item) => item.number)).toEqual([2]);
  });

  it("仅允许跳转到总页数范围内的整数页", async () => {
    vi.mocked(prList).mockResolvedValueOnce({
      items: [],
      page: 1,
      total_pages: 5,
      total_count: 100,
    });
    const store = usePrStore();
    await store.fetchPrList("github", "owner", "repo");

    store.setPage(4);
    expect(store.filters.page).toBe(4);

    store.setPage(0);
    store.setPage(6);
    store.setPage(2.5);
    expect(store.filters.page).toBe(4);
  });

  it("切换仓库后立即清除旧仓库的 PR 列表", async () => {
    const oldItem: PrSummary = {
      number: 3989,
      title: "其他仓库 PR",
      author: { id: 1, login: "old", name: "Old", avatar_url: "" },
      state: "open",
      created_at: "",
      updated_at: "",
      labels: [],
    };
    const newRequest = deferred<Paginated<PrSummary>>();
    vi.mocked(prList)
      .mockResolvedValueOnce({ items: [oldItem], page: 1, total_pages: 1, total_count: 1 })
      .mockReturnValueOnce(newRequest.promise);
    const store = usePrStore();
    await store.fetchPrList("github", "other", "repo");

    const pending = store.fetchPrList("github", "ultraworkers", "claw-code");

    expect(store.list).toEqual([]);
    expect(store.totalPages).toBe(1);
    expect(store.listTotalCount).toBe(0);
    newRequest.resolve({ items: [], page: 1, total_pages: 1, total_count: 0 });
    await pending;
  });

  it("切换仓库时恢复开放状态筛选和第一页", async () => {
    vi.mocked(prList)
      .mockResolvedValueOnce({ items: [], page: 1, total_pages: 5, total_count: 0 })
      .mockResolvedValueOnce({ items: [], page: 1, total_pages: 1, total_count: 0 });
    const store = usePrStore();
    await store.fetchPrList("github", "first", "repo");
    store.setFilter("closed");
    store.setPage(3);
    store.clearContext();

    await store.fetchPrList("github", "second", "repo");

    expect(store.filters).toEqual({ state: "open", page: 1 });
    expect(prList).toHaveBeenLastCalledWith("github", "second", "repo", "open", 1, 20);
  });

  it("刷新同一仓库时保留当前状态筛选", async () => {
    vi.mocked(prList)
      .mockResolvedValueOnce({ items: [], page: 1, total_pages: 1, total_count: 0 })
      .mockResolvedValueOnce({ items: [], page: 1, total_pages: 1, total_count: 0 });
    const store = usePrStore();
    await store.fetchPrList("github", "owner", "repo");
    store.setFilter("merged");

    await store.fetchPrList("github", "owner", "repo");

    expect(store.filters.state).toBe("merged");
    expect(prList).toHaveBeenLastCalledWith("github", "owner", "repo", "merged", 1, 20);
  });

  it("应用高级筛选时回到第一页并把完整查询传给后端", async () => {
    vi.mocked(prList).mockResolvedValue({ items: [], page: 1, total_pages: 1, total_count: 0 });
    const store = usePrStore();
    await store.fetchPrList("github", "owner", "repo");
    store.setPage(1);

    store.setListQuery({
      title: "  parser  ",
      author: " octocat ",
      label: " help wanted ",
      reviews: "approved",
      assignee: " hubot ",
      sort: "comments_desc",
    });
    await store.fetchPrList("github", "owner", "repo");

    expect(store.filters.page).toBe(1);
    expect(prList).toHaveBeenLastCalledWith("github", "owner", "repo", "open", 1, 20, {
      title: "parser",
      author: "octocat",
      label: "help wanted",
      reviews: "approved",
      assignee: "hubot",
      sort: "comments_desc",
    });
  });

  it("清空仓库上下文时恢复默认排序且作废筛选请求", () => {
    const store = usePrStore();
    store.setListQuery({
      title: "fix",
      author: "",
      label: "",
      reviews: null,
      assignee: "",
      sort: "updated_asc",
    });

    expect(store.hasListQuery).toBe(true);
    expect(store.clearContext()).toBe(true);
    expect(store.listQuery).toEqual({
      title: "",
      author: "",
      label: "",
      reviews: null,
      assignee: "",
      sort: "updated_desc",
    });
    expect(store.hasListQuery).toBe(false);
  });

  it("后台加载 Diff 时不占用详情或列表的加载状态", async () => {
    const pendingDiff = deferred<DiffResult>();
    vi.mocked(prDetail).mockResolvedValueOnce(createPrDetail(42, "当前 PR"));
    vi.mocked(prDiff).mockReturnValueOnce(pendingDiff.promise);
    const store = usePrStore();
    await store.fetchPrDetail("github", "owner", "repo", 42);

    const request = store.fetchPrDiff("github", "owner", "repo", 42);

    expect(store.diffLoading).toBe(true);
    expect(store.detailLoading).toBe(false);
    expect(store.loading).toBe(false);

    pendingDiff.resolve({ diff: "", files: [], patch_schema_version: 1, patches: [] });
    await request;

    expect(store.diffLoading).toBe(false);
  });

  it("静默刷新详情时保留当前内容且不进入首屏加载态", async () => {
    const initialDetail = createPrDetail(42, "旧标题");
    const refreshedDetail = createPrDetail(42, "新标题");
    const refreshRequest = deferred<PrDetail>();
    vi.mocked(prDetail)
      .mockResolvedValueOnce(initialDetail)
      .mockReturnValueOnce(refreshRequest.promise);
    const store = usePrStore();
    await store.fetchPrDetail("github", "owner", "repo", 42);

    const pending = store.refreshPrDetail("github", "owner", "repo", 42);

    expect(store.detailLoading).toBe(false);
    expect(store.currentPr).toEqual(initialDetail);

    refreshRequest.resolve(refreshedDetail);
    await expect(pending).resolves.toBe(true);
    expect(store.currentPr).toEqual(refreshedDetail);
    expect(store.detailLoading).toBe(false);
  });

  it("静默刷新返回 404 时清除过期详情并显示明确提示", async () => {
    const initialDetail = createPrDetail(42, "即将被删除的 PR");
    vi.mocked(prDetail)
      .mockResolvedValueOnce(initialDetail)
      .mockRejectedValueOnce(new Error("GitHub API 404 Not Found"));
    const store = usePrStore();
    await store.fetchPrDetail("github", "owner", "repo", 42);

    const loaded = await store.refreshPrDetail("github", "owner", "repo", 42);

    expect(loaded).toBe(false);
    expect(store.currentPr).toBeNull();
    expect(store.error).toBe(
      "找不到 owner/repo #42，该 PR / MR 可能不存在，或当前 Token 无权访问。",
    );
  });

  it("详情上下文变化且请求返回 404 时清除旧详情并显示明确提示", async () => {
    const oldDetail: PrDetail = {
      summary: {
        number: 3989,
        title: "其他仓库 PR",
        author: { id: 1, login: "old", name: "Old", avatar_url: "" },
        state: "open",
        created_at: "",
        updated_at: "",
        labels: [],
      },
      body: "",
      source_branch: "feature",
      target_branch: "main",
      mergeable: true,
      head_sha: "old-sha",
      base_sha: "base-sha",
      draft: false,
      reviewers: [],
      assignees: [],
      milestone: null,
      metadata_permissions: {
        can_edit_title_body: true,
        can_toggle_draft: true,
        can_manage_reviewers: true,
        can_manage_assignees: true,
        can_manage_labels: true,
        can_manage_milestone: true,
      },
    };
    vi.mocked(prDetail)
      .mockResolvedValueOnce(oldDetail)
      .mockRejectedValueOnce(new Error("GitHub API 404 Not Found"));
    const store = usePrStore();
    await store.fetchPrDetail("github", "other", "repo", 3989);

    const loaded = await store.fetchPrDetail("github", "ultraworkers", "claw-code", 3989);

    expect(loaded).toBe(false);
    expect(store.currentPr).toBeNull();
    expect(store.error).toBe(
      "找不到 ultraworkers/claw-code #3989，该 PR / MR 可能不存在，或当前 Token 无权访问。",
    );
  });

  it("合并部分成功时仍刷新详情并返回失败 Issue", async () => {
    const outcome = {
      merge: { merged: true, message: "merged", sha: "abc" },
      closed_issues: [1],
      issue_close_failures: [{ number: 2, error: "forbidden" }],
    };
    const detail: PrDetail = {
      summary: {
        number: 42,
        title: "已合并",
        author: { id: 1, login: "user", name: "User", avatar_url: "" },
        state: "merged",
        created_at: "",
        updated_at: "",
        labels: [],
      },
      body: "",
      source_branch: "feature",
      target_branch: "main",
      mergeable: true,
      head_sha: "abc",
      base_sha: "base-sha",
      draft: false,
      reviewers: [],
      assignees: [],
      milestone: null,
      metadata_permissions: {
        can_edit_title_body: true,
        can_toggle_draft: true,
        can_manage_reviewers: true,
        can_manage_assignees: true,
        can_manage_labels: true,
        can_manage_milestone: true,
      },
    };
    vi.mocked(prMerge).mockResolvedValue(outcome);
    vi.mocked(prDetail)
      .mockResolvedValueOnce(createPrDetail(42, "待合并"))
      .mockResolvedValueOnce(detail);
    const store = usePrStore();
    await store.fetchPrDetail("github", "o", "r", 42);

    const result = await store.mergePr("github", "o", "r", 42, "merge", undefined, undefined, true);

    expect(result).toEqual(outcome);
    expect(prDetail).toHaveBeenCalledWith("github", "o", "r", 42);
    expect(store.currentPr?.summary.title).toBe("已合并");
  });

  it("mergePr 切换详情后忽略迟到的旧 PR 刷新", async () => {
    await expectStateChangeRefreshToIgnoreNavigation(
      () => {
        vi.mocked(prMerge)
          .mockReset()
          .mockResolvedValue({
            merge: { merged: true, message: "merged", sha: "merged-sha" },
            closed_issues: [],
            issue_close_failures: [],
          });
      },
      (store) => store.mergePr("github", "old", "repo", 1, "merge"),
    );
  });

  it("closePr 切换详情后忽略迟到的旧 PR 刷新", async () => {
    await expectStateChangeRefreshToIgnoreNavigation(
      () => {
        vi.mocked(prClose).mockReset().mockResolvedValue("closed");
      },
      (store) => store.closePr("github", "old", "repo", 1),
    );
  });

  it("reopenPr 切换详情后忽略迟到的旧 PR 刷新", async () => {
    await expectStateChangeRefreshToIgnoreNavigation(
      () => {
        vi.mocked(prReopen).mockReset().mockResolvedValue("open");
      },
      (store) => store.reopenPr("github", "old", "repo", 1),
    );
  });

  it("写操作刷新合并就绪状态时不会覆盖已切换的 PR", async () => {
    const oldReadiness = deferred<PrMergeReadiness>();
    const currentDetail = createPrDetail(2, "PR B");
    vi.mocked(prMerge)
      .mockReset()
      .mockResolvedValue({
        merge: { merged: true, message: "merged", sha: "merged-sha" },
        closed_issues: [],
        issue_close_failures: [],
      });
    vi.mocked(prDetail)
      .mockReset()
      .mockResolvedValueOnce(createPrDetail(1, "PR A"))
      .mockResolvedValueOnce(createPrDetail(1, "已合并的 PR A", "merged"))
      .mockResolvedValueOnce(currentDetail);
    vi.mocked(prMergeReadiness).mockReset().mockReturnValueOnce(oldReadiness.promise);
    const store = usePrStore();
    await store.fetchPrDetail("github", "old", "repo", 1);

    const pendingMerge = store.mergePr("github", "old", "repo", 1, "merge");
    await vi.waitFor(() => expect(prMergeReadiness).toHaveBeenCalledTimes(1));
    await store.fetchPrDetail("gitlab", "new", "repo", 2);
    oldReadiness.resolve({
      status: "ready",
      head_sha: "old-sha",
      mergeable: true,
      draft: false,
      has_conflicts: false,
      checks_status: "ready",
      approvals_status: "ready",
      approvals_required: null,
      approvals_received: null,
      has_merge_permission: true,
      branch_behind: false,
      blocking_reasons: [],
    });
    await pendingMerge;

    expect(store.currentPr).toEqual(currentDetail);
    expect(store.mergeReadiness).toBeNull();
    expect(store.readinessError).toBeNull();
  });

  it("忽略迟到的旧 PR 合并就绪响应", async () => {
    const oldReadiness = deferred<PrMergeReadiness>();
    const currentReadiness: PrMergeReadiness = {
      status: "ready",
      head_sha: "current-sha",
      mergeable: true,
      draft: false,
      has_conflicts: false,
      checks_status: "ready",
      approvals_status: "ready",
      approvals_required: null,
      approvals_received: null,
      has_merge_permission: true,
      branch_behind: false,
      blocking_reasons: [],
    };
    vi.mocked(prMergeReadiness)
      .mockReturnValueOnce(oldReadiness.promise)
      .mockResolvedValueOnce(currentReadiness);
    const store = usePrStore();

    const oldRequest = store.fetchMergeReadiness("github", "old", "repo", 1);
    await store.fetchMergeReadiness("gitlab", "new", "repo", 2);
    oldReadiness.resolve({ ...currentReadiness, head_sha: "old-sha" });
    await oldRequest;

    expect(store.mergeReadiness).toEqual(currentReadiness);
  });

  it("在途合并就绪请求期间清空上下文会复位 loading", async () => {
    const pending = deferred<PrMergeReadiness>();
    vi.mocked(prMergeReadiness).mockReturnValueOnce(pending.promise);
    const store = usePrStore();

    const request = store.fetchMergeReadiness("github", "owner", "repo", 42);
    expect(store.readinessLoading).toBe(true);

    store.clearContext();

    // clearContext 作废在途请求：loading 立即复位，迟到结果不会再次点亮。
    expect(store.readinessLoading).toBe(false);
    pending.resolve({
      status: "ready",
      head_sha: "late-sha",
      mergeable: true,
      draft: false,
      has_conflicts: false,
      checks_status: "ready",
      approvals_status: "ready",
      approvals_required: null,
      approvals_received: null,
      has_merge_permission: true,
      branch_behind: false,
      blocking_reasons: [],
    });
    await request;

    expect(store.readinessLoading).toBe(false);
    expect(store.mergeReadiness).toBeNull();
  });

  it("切换 PR 后忽略迟到的元数据写入结果", async () => {
    const oldUpdate = deferred<Awaited<ReturnType<typeof prMetadataUpdate>>>();
    const oldDetail: PrDetail = {
      summary: {
        number: 1,
        title: "旧 PR",
        author: { id: 1, login: "old", name: "Old", avatar_url: "" },
        state: "open",
        created_at: "",
        updated_at: "old-updated-at",
        labels: [],
      },
      body: "",
      source_branch: "old",
      target_branch: "main",
      mergeable: true,
      head_sha: "old-sha",
      base_sha: "base-sha",
      draft: false,
      reviewers: [],
      assignees: [],
      milestone: null,
      metadata_permissions: {
        can_edit_title_body: true,
        can_toggle_draft: true,
        can_manage_reviewers: true,
        can_manage_assignees: true,
        can_manage_labels: true,
        can_manage_milestone: true,
      },
    };
    const currentDetail: PrDetail = {
      ...oldDetail,
      summary: {
        ...oldDetail.summary,
        number: 2,
        title: "当前 PR",
        updated_at: "current-updated-at",
      },
      source_branch: "current",
      head_sha: "current-sha",
    };
    vi.mocked(prDetail).mockResolvedValueOnce(oldDetail).mockResolvedValueOnce(currentDetail);
    vi.mocked(prMetadataUpdate).mockReturnValueOnce(oldUpdate.promise);
    const store = usePrStore();
    await store.fetchPrDetail("github", "old", "repo", 1);

    const pending = store.updateMetadata("github", "old", "repo", 1, {
      title: "迟到标题",
      body: "",
      draft: false,
      reviewers: [],
      assignees: [],
      labels: [],
      milestone: null,
      expected_updated_at: "old-updated-at",
    });
    await store.fetchPrDetail("gitlab", "new", "repo", 2);
    oldUpdate.resolve({
      detail: { ...oldDetail, summary: { ...oldDetail.summary, title: "迟到标题" } },
      updated_fields: ["title_body"],
      failures: [],
    });

    await expect(pending).resolves.toBeNull();
    expect(store.currentPr?.summary.title).toBe("当前 PR");
  });

  it("切换 PR 后忽略迟到的元数据写入错误", async () => {
    const oldUpdate = deferred<Awaited<ReturnType<typeof prMetadataUpdate>>>();
    const detail: PrDetail = {
      summary: {
        number: 1,
        title: "PR",
        author: { id: 1, login: "user", name: "User", avatar_url: "" },
        state: "open",
        created_at: "",
        updated_at: "updated-at",
        labels: [],
      },
      body: "",
      source_branch: "feature",
      target_branch: "main",
      mergeable: true,
      head_sha: "head-sha",
      base_sha: "base-sha",
      draft: false,
      reviewers: [],
      assignees: [],
      milestone: null,
      metadata_permissions: {
        can_edit_title_body: true,
        can_toggle_draft: true,
        can_manage_reviewers: true,
        can_manage_assignees: true,
        can_manage_labels: true,
        can_manage_milestone: true,
      },
    };
    vi.mocked(prDetail).mockResolvedValue(detail);
    vi.mocked(prMetadataUpdate).mockReturnValueOnce(oldUpdate.promise);
    const store = usePrStore();
    await store.fetchPrDetail("github", "old", "repo", 1);

    const pending = store.updateMetadata("github", "old", "repo", 1, {
      title: "更新标题",
      body: "",
      draft: false,
      reviewers: [],
      assignees: [],
      labels: [],
      milestone: null,
      expected_updated_at: "updated-at",
    });
    await store.fetchPrDetail("gitlab", "new", "repo", 2);
    oldUpdate.reject(new Error("旧请求失败"));

    await expect(pending).resolves.toBeNull();
    expect(store.error).toBeNull();
  });

  it("忽略同类请求中较早返回的详情和 diff", async () => {
    const oldDetail = deferred<PrDetail>();
    const oldDiff = deferred<DiffResult>();
    const currentDetail: PrDetail = {
      summary: {
        number: 2,
        title: "当前仓库 PR",
        author: { id: 2, login: "new", name: "New", avatar_url: "" },
        state: "open",
        created_at: "",
        updated_at: "",
        labels: [],
      },
      body: "",
      source_branch: "current",
      target_branch: "main",
      mergeable: true,
      head_sha: "new-sha",
      base_sha: "base-sha",
      draft: false,
      reviewers: [],
      assignees: [],
      milestone: null,
      metadata_permissions: {
        can_edit_title_body: true,
        can_toggle_draft: true,
        can_manage_reviewers: true,
        can_manage_assignees: true,
        can_manage_labels: true,
        can_manage_milestone: true,
      },
    };
    const currentDiff: DiffResult = {
      diff: "current diff",
      files: [],
      patch_schema_version: 1,
      patches: [],
    };
    vi.mocked(prDetail).mockReturnValueOnce(oldDetail.promise).mockResolvedValueOnce(currentDetail);
    vi.mocked(prDiff).mockReturnValueOnce(oldDiff.promise).mockResolvedValueOnce(currentDiff);
    const store = usePrStore();

    const oldDetailRequest = store.fetchPrDetail("github", "old", "repo", 1);
    const oldDiffRequest = store.fetchPrDiff("github", "old", "repo", 1);
    await store.fetchPrDetail("gitlab", "new", "repo", 2);
    await store.fetchPrDiff("gitlab", "new", "repo", 2);
    oldDetail.resolve({
      ...currentDetail,
      summary: { ...currentDetail.summary, title: "迟到 PR" },
    });
    oldDiff.resolve({ diff: "late diff", files: [], patch_schema_version: 1, patches: [] });
    await Promise.all([oldDetailRequest, oldDiffRequest]);

    expect(store.currentPr?.summary.title).toBe("当前仓库 PR");
    expect(store.diff).toEqual(currentDiff);
  });

  it("切换详情后忽略旧 PR 迟到的 Diff 和提交列表", async () => {
    const staleDiff = deferred<DiffResult>();
    const staleCommits = deferred<{
      commits: PrCommitSummary[];
      truncated_end: "oldest" | "newest" | null;
    }>();
    vi.mocked(prDetail)
      .mockResolvedValueOnce(createPrDetail(1, "旧 PR"))
      .mockResolvedValueOnce(createPrDetail(2, "新 PR"));
    vi.mocked(prDiff).mockReturnValueOnce(staleDiff.promise);
    vi.mocked(prCommits).mockReturnValueOnce(staleCommits.promise);
    const store = usePrStore();
    await store.fetchPrDetail("github", "owner", "repo", 1);

    const oldDiffRequest = store.fetchPrDiff("github", "owner", "repo", 1);
    const oldCommitsRequest = store.fetchPrCommits("github", "owner", "repo", 1);
    await store.fetchPrDetail("github", "owner", "repo", 2);
    staleDiff.resolve({
      diff: "旧 PR Diff",
      files: [],
      patch_schema_version: 1,
      patches: [],
    });
    staleCommits.resolve({
      commits: [
        {
          sha: "old-commit",
          title: "旧 PR 提交",
          author_name: "Alice",
          authored_at: "2026-08-05T10:00:00Z",
          parent_shas: ["base"],
        },
      ],
      truncated_end: "oldest",
    });
    await Promise.all([oldDiffRequest, oldCommitsRequest]);

    expect(store.currentPr?.summary.number).toBe(2);
    expect(store.diff).toBeNull();
    expect(store.commits).toEqual([]);
    expect(store.commitsTruncatedEnd).toBeNull();
    expect(store.commitsError).toBeNull();
  });

  describe("按 commit 维度查看", () => {
    const commit = (sha: string, parents: string[] = []): PrCommitSummary => ({
      sha,
      title: `提交 ${sha}`,
      author_name: "Alice",
      authored_at: "2026-07-19T10:00:00Z",
      parent_shas: parents,
    });
    const rangeDiff: DiffResult = {
      diff: "range diff",
      files: [],
      patch_schema_version: 1,
      patches: [],
    };

    async function storeForPr() {
      vi.mocked(prDetail).mockResolvedValueOnce(createPrDetail(42, "当前 PR"));
      const store = usePrStore();
      await store.fetchPrDetail("github", "owner", "repo", 42);
      return store;
    }

    async function storeWithCommits() {
      vi.mocked(prCommits).mockResolvedValueOnce({
        commits: [commit("c1", ["base0"]), commit("c2", ["c1"]), commit("c3", ["c2"])],
        truncated_end: null,
      });
      const store = await storeForPr();
      await store.fetchPrCommits("github", "owner", "repo", 42);
      return store;
    }

    it("按提交区间请求 compare Diff", async () => {
      const store = await storeWithCommits();
      vi.mocked(prCompareDiff).mockResolvedValueOnce(rangeDiff);

      await store.selectCommitRange("github", "owner", "repo", { startIndex: 1, endIndex: 2 });

      expect(prCompareDiff).toHaveBeenCalledWith("github", "owner", "repo", "c1", "c3");
      expect(store.rangeDiff).toEqual(rangeDiff);
      expect(store.rangeRevisions).toEqual({ baseSha: "c1", headSha: "c3" });
      expect(store.rangeDiffError).toBeNull();
    });

    it("无法确定对比基准时不发请求并给出原因", async () => {
      vi.mocked(prCommits).mockResolvedValueOnce({
        commits: [commit("only")],
        truncated_end: null,
      });
      vi.mocked(prDetail).mockResolvedValueOnce({
        ...createPrDetail(42, "当前 PR"),
        base_sha: "",
      });
      const store = usePrStore();
      await store.fetchPrDetail("github", "owner", "repo", 42);
      await store.fetchPrCommits("github", "owner", "repo", 42);
      vi.mocked(prCompareDiff).mockClear();

      await store.selectCommitRange("github", "owner", "repo", { startIndex: 0, endIndex: 0 });

      expect(prCompareDiff).not.toHaveBeenCalled();
      expect(store.rangeDiff).toBeNull();
      expect(store.rangeRevisions).toBeNull();
      expect(store.rangeDiffError).toContain("无法确定");
    });

    it("重复选择同一区间不再重复请求", async () => {
      const store = await storeWithCommits();
      vi.mocked(prCompareDiff).mockResolvedValue(rangeDiff);
      await store.selectCommitRange("github", "owner", "repo", { startIndex: 1, endIndex: 1 });
      expect(prCompareDiff).toHaveBeenCalledTimes(1);

      await store.selectCommitRange("github", "owner", "repo", { startIndex: 1, endIndex: 1 });

      expect(prCompareDiff).toHaveBeenCalledTimes(1);
      expect(store.rangeDiff).toEqual(rangeDiff);
    });

    it("区间 Diff 失败后重新选择同一区间可以重试", async () => {
      const store = await storeWithCommits();
      vi.mocked(prCompareDiff)
        .mockRejectedValueOnce("compare 失败")
        .mockResolvedValueOnce(rangeDiff);
      await store.selectCommitRange("github", "owner", "repo", { startIndex: 1, endIndex: 1 });
      expect(store.rangeDiffError).toBe("compare 失败");

      await store.selectCommitRange("github", "owner", "repo", { startIndex: 1, endIndex: 1 });

      expect(prCompareDiff).toHaveBeenCalledTimes(2);
      expect(store.rangeDiff).toEqual(rangeDiff);
      expect(store.rangeDiffError).toBeNull();
    });

    it("回到整体 Diff 时清空区间状态", async () => {
      const store = await storeWithCommits();
      vi.mocked(prCompareDiff).mockResolvedValueOnce(rangeDiff);
      await store.selectCommitRange("github", "owner", "repo", { startIndex: 0, endIndex: 1 });

      await store.selectCommitRange("github", "owner", "repo", null);

      expect(store.commitRange).toBeNull();
      expect(store.rangeDiff).toBeNull();
      expect(store.rangeRevisions).toBeNull();
    });

    it("迟到的区间 Diff 响应不覆盖新选择", async () => {
      const store = await storeWithCommits();
      const stale = deferred<DiffResult>();
      vi.mocked(prCompareDiff).mockReturnValueOnce(stale.promise).mockResolvedValueOnce(rangeDiff);

      const pending = store.selectCommitRange("github", "owner", "repo", {
        startIndex: 0,
        endIndex: 0,
      });
      await store.selectCommitRange("github", "owner", "repo", { startIndex: 1, endIndex: 2 });
      stale.resolve({ diff: "stale diff", files: [], patch_schema_version: 1, patches: [] });
      await pending;

      expect(store.rangeDiff).toEqual(rangeDiff);
      expect(store.rangeRevisions).toEqual({ baseSha: "c1", headSha: "c3" });
    });

    it("提交列表变化后重置已选区间，避免下标错位", async () => {
      const store = await storeWithCommits();
      vi.mocked(prCompareDiff).mockResolvedValueOnce(rangeDiff);
      await store.selectCommitRange("github", "owner", "repo", { startIndex: 0, endIndex: 1 });
      vi.mocked(prCommits).mockResolvedValueOnce({
        commits: [commit("c1", ["base0"]), commit("c9", ["c1"])],
        truncated_end: "newest",
      });

      await store.fetchPrCommits("github", "owner", "repo", 42);

      expect(store.commitsTruncatedEnd).toBe("newest");
      expect(store.commitRange).toBeNull();
      expect(store.rangeDiff).toBeNull();
    });

    it("提交列表请求失败时保留错误并回到整体 Diff", async () => {
      const store = await storeWithCommits();
      vi.mocked(prCommits).mockRejectedValueOnce("读取提交失败");

      await store.fetchPrCommits("github", "owner", "repo", 42);

      expect(store.commits).toEqual([]);
      expect(store.commitsError).toBe("读取提交失败");
      expect(store.commitRange).toBeNull();
    });
  });
});
