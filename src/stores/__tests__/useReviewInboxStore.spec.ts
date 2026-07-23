import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
import { reviewInboxList } from "@/api";
import { ApiError } from "@/api/errors";
import { useReviewInboxStore } from "@/stores/useReviewInboxStore";
import type {
  Paginated,
  Platform,
  ReviewInboxItem,
  ReviewInboxRelationship,
  ReviewInboxStatusSummary,
} from "@/types";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock("@/api", () => ({
  reviewInboxList: vi.fn(),
}));

function item(
  platform: Platform,
  repository: string,
  number: number,
  updatedAt: string,
  relationships: ReviewInboxRelationship[] = ["reviewer"],
  status: ReviewInboxStatusSummary = {
    status: "unknown",
    draft: null,
    has_conflicts: null,
    checks_status: "unknown",
    approvals_status: "unknown",
    blocking_reasons: [],
  },
): ReviewInboxItem {
  const parts = repository.split("/");
  return {
    platform,
    owner: parts.slice(0, -1).join("/"),
    repo: parts.at(-1) ?? "",
    repository_full_name: repository,
    categories: ["review_requested"],
    relationships,
    status,
    summary: {
      number,
      title: `${platform} #${number}`,
      author: { id: number, login: "author", name: "Author", avatar_url: "" },
      state: "open",
      created_at: updatedAt,
      updated_at: updatedAt,
      labels: [],
    },
  };
}

function page(items: ReviewInboxItem[], current = 1, total = 1): Paginated<ReviewInboxItem> {
  return { items, page: current, total_pages: total, total_count: items.length };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useReviewInboxStore", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
    vi.mocked(reviewInboxList).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("聚合已登录平台并按更新时间排序、去重和过滤", async () => {
    vi.mocked(reviewInboxList).mockImplementation(async (platform) => {
      if (platform === "github") {
        return page([
          item("github", "team/a", 1, "2025-01-01T00:00:00Z"),
          item("github", "team/a", 1, "2025-01-01T00:00:00Z"),
        ]);
      }
      return page([item("gitlab", "group/subgroup/b", 2, "2025-01-03T00:00:00Z")]);
    });
    const store = useReviewInboxStore();

    await store.refresh(["github", "gitlab"]);

    expect(store.items.map((entry) => entry.summary.number)).toEqual([2, 1]);
    store.filters.repository = "TEAM/A";
    expect(store.items.map((entry) => entry.repository_full_name)).toEqual(["team/a"]);
    store.filters.repository = "";
    store.filters.platform = "github";
    expect(store.items.map((entry) => entry.platform)).toEqual(["github"]);
  });

  it("去重时合并角色和状态，并支持角色与合并状态筛选", async () => {
    vi.mocked(reviewInboxList).mockResolvedValue(
      page([
        item("github", "team/a", 1, "2025-01-01T00:00:00Z", ["reviewer"], {
          status: "pending",
          draft: false,
          has_conflicts: false,
          checks_status: "pending",
          approvals_status: "ready",
          blocking_reasons: [{ code: "checks_pending", message: "CI 检查仍在进行中" }],
        }),
        item("github", "team/a", 1, "2025-01-01T00:00:00Z", ["assignee"], {
          status: "blocked",
          draft: true,
          has_conflicts: null,
          checks_status: "unknown",
          approvals_status: "blocked",
          blocking_reasons: [{ code: "draft", message: "PR 仍处于 Draft 状态" }],
        }),
        item("github", "team/b", 2, "2025-01-02T00:00:00Z", ["tester"], {
          status: "ready",
          draft: false,
          has_conflicts: false,
          checks_status: "ready",
          approvals_status: "ready",
          blocking_reasons: [],
        }),
      ]),
    );
    const store = useReviewInboxStore();

    await store.refresh(["github"]);

    const merged = store.items.find((entry) => entry.summary.number === 1);
    expect(merged?.relationships).toEqual(["reviewer", "assignee"]);
    expect(merged?.status.status).toBe("blocked");
    expect(merged?.status.draft).toBe(true);
    expect(merged?.status.blocking_reasons).toHaveLength(2);

    store.filters.relationship = "assignee";
    expect(store.items.map((entry) => entry.summary.number)).toEqual([1]);
    store.filters.relationship = "all";
    store.filters.readiness = "ready";
    expect(store.items.map((entry) => entry.summary.number)).toEqual([2]);
  });

  it("平台筛选只请求选中的平台，全部平台模式才执行聚合请求", async () => {
    vi.mocked(reviewInboxList).mockImplementation(async (platform) =>
      page([item(platform, `team/${platform}`, 1, "2025-01-01T00:00:00Z")]),
    );
    const store = useReviewInboxStore();
    store.filters.platform = "gitlab";

    await store.refresh(["github", "gitlab", "gitee"]);

    expect(reviewInboxList).toHaveBeenCalledTimes(1);
    expect(reviewInboxList).toHaveBeenCalledWith("gitlab", "review_requested", 1, 20);
    expect(store.loggedInPlatforms).toEqual(["github", "gitlab", "gitee"]);
    expect(store.items.map((entry) => entry.platform)).toEqual(["gitlab"]);

    vi.mocked(reviewInboxList).mockClear();
    store.filters.platform = "all";
    await store.refresh(["github", "gitlab", "gitee"]);

    expect(reviewInboxList).toHaveBeenCalledTimes(3);
    expect(
      vi
        .mocked(reviewInboxList)
        .mock.calls.map(([platform]) => platform)
        .sort(),
    ).toEqual(["gitee", "github", "gitlab"]);
  });

  it("单个平台失败时保留其他平台结果并允许独立重试", async () => {
    vi.mocked(reviewInboxList).mockImplementation(async (platform) => {
      if (platform === "gitlab") throw new Error("GitLab unavailable");
      return page([item(platform, "team/repo", 1, "2025-01-01T00:00:00Z")]);
    });
    const store = useReviewInboxStore();

    await store.refresh(["github", "gitlab"]);

    expect(store.items).toHaveLength(1);
    expect(store.items[0].platform).toBe("github");
    expect(store.errors.gitlab).toContain("GitLab unavailable");

    vi.mocked(reviewInboxList).mockResolvedValueOnce(
      page([item("gitlab", "group/repo", 2, "2025-01-02T00:00:00Z")]),
    );
    await store.retry("gitlab");
    expect(store.items.map((entry) => entry.platform)).toEqual(["gitlab", "github"]);
    expect(store.errors.gitlab).toBeNull();
  });

  it("切换分类后忽略旧分类迟到响应", async () => {
    const oldRequest = deferred<Paginated<ReviewInboxItem>>();
    vi.mocked(reviewInboxList)
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(page([item("github", "team/new", 2, "2025-01-02T00:00:00Z")]));
    const store = useReviewInboxStore();

    const pending = store.refresh(["github"]);
    store.filters.category = "authored";
    await store.refresh(["github"]);
    oldRequest.resolve(page([item("github", "team/old", 1, "2025-01-01T00:00:00Z")]));
    await pending;

    expect(store.items.map((entry) => entry.repository_full_name)).toEqual(["team/new"]);
    expect(reviewInboxList).toHaveBeenNthCalledWith(2, "github", "authored", 1, 20);
  });

  it("登录平台集合变化后忽略已登出平台的迟到响应", async () => {
    const oldGithubRequest = deferred<Paginated<ReviewInboxItem>>();
    vi.mocked(reviewInboxList).mockImplementation(async (platform) => {
      if (platform === "github") return oldGithubRequest.promise;
      return page([item("gitlab", "team/current", 2, "2025-01-02T00:00:00Z")]);
    });
    const store = useReviewInboxStore();

    const previousRefresh = store.refresh(["github"]);
    await Promise.resolve();
    await store.refresh(["gitlab"]);

    expect(store.loggedInPlatforms).toEqual(["gitlab"]);
    expect(store.items.map((entry) => entry.repository_full_name)).toEqual(["team/current"]);

    oldGithubRequest.resolve(page([item("github", "team/signed-out", 1, "2025-01-03T00:00:00Z")]));
    await previousRefresh;

    expect(store.loggedInPlatforms).toEqual(["gitlab"]);
    expect(store.itemsByPlatform.github).toEqual([]);
    expect(store.items.map((entry) => entry.repository_full_name)).toEqual(["team/current"]);
    expect(store.errors.github).toBeNull();
  });

  it("按平台独立追加分页且不覆盖已加载条目", async () => {
    vi.mocked(reviewInboxList)
      .mockResolvedValueOnce(page([item("github", "team/a", 1, "2025-01-01T00:00:00Z")], 1, 2))
      .mockResolvedValueOnce(page([item("github", "team/b", 2, "2025-01-02T00:00:00Z")], 2, 2));
    const store = useReviewInboxStore();

    await store.refresh(["github"]);
    await store.loadMore();

    expect(store.items.map((entry) => entry.summary.number)).toEqual([2, 1]);
    expect(store.pages.github).toBe(2);
    expect(store.hasMore).toBe(false);
  });

  it("连续加载超大账号分页时保留中断前数据并从失败页恢复", async () => {
    const totalPages = 125;
    const perPage = 20;
    let page73Failed = false;
    vi.mocked(reviewInboxList).mockImplementation(
      async (platform, _category, requestedPage = 1) => {
        if (requestedPage === 73 && !page73Failed) {
          page73Failed = true;
          throw new Error("page 73 unavailable");
        }
        const firstNumber = (requestedPage - 1) * perPage + 1;
        const items = Array.from({ length: perPage }, (_, index) => {
          const number = firstNumber + index;
          return item(
            platform,
            `large-account/repo-${number}`,
            number,
            new Date(Date.UTC(2025, 0, 1, 0, 0, number)).toISOString(),
          );
        });
        return {
          items,
          page: requestedPage,
          total_pages: totalPages,
          total_count: totalPages * perPage,
        };
      },
    );
    const store = useReviewInboxStore();

    await store.refresh(["github"]);
    for (let requestedPage = 2; requestedPage <= 73; requestedPage += 1) {
      await store.loadMore();
    }

    expect(store.items).toHaveLength(72 * perPage);
    expect(store.pages.github).toBe(72);
    expect(store.errors.github).toContain("page 73 unavailable");

    await store.retry("github");
    for (let requestedPage = 74; requestedPage <= totalPages; requestedPage += 1) {
      await store.loadMore();
    }

    expect(store.items).toHaveLength(totalPages * perPage);
    expect(new Set(store.items.map((entry) => entry.summary.number)).size).toBe(
      totalPages * perPage,
    );
    expect(store.pages.github).toBe(totalPages);
    expect(store.hasMore).toBe(false);
    expect(store.errors.github).toBeNull();
    expect(reviewInboxList).toHaveBeenCalledTimes(totalPages + 1);
    expect(
      vi.mocked(reviewInboxList).mock.calls.filter(([, , requestedPage]) => requestedPage === 73),
    ).toHaveLength(2);
  });

  it("后台刷新替换首页快照，同时保留已经加载的后续分页", async () => {
    const oldPageTwoItem = item("github", "team/page-two", 2, "2024-12-31T00:00:00Z");
    oldPageTwoItem.head_sha = "old-head";
    const refreshedPageTwoItem = item("github", "team/page-two", 2, "2025-01-02T00:00:00Z");
    refreshedPageTwoItem.head_sha = "new-head";
    vi.mocked(reviewInboxList)
      .mockResolvedValueOnce(page([item("github", "team/old", 1, "2025-01-01T00:00:00Z")], 1, 2))
      .mockResolvedValueOnce(
        page([oldPageTwoItem, item("github", "team/retained", 4, "2024-12-30T00:00:00Z")], 2, 2),
      )
      .mockResolvedValueOnce(page([refreshedPageTwoItem], 1, 2));
    const store = useReviewInboxStore();

    await store.refresh(["github"]);
    await store.loadMore();
    await store.backgroundRefresh(["github"], 1_000_000);

    expect(store.items.map((entry) => entry.repository_full_name)).toEqual([
      "team/page-two",
      "team/retained",
    ]);
    expect(store.items[0].head_sha).toBe("new-head");
    expect(store.pages.github).toBe(2);
  });

  it("后台刷新失败后的重试会重新请求所有已加载分页", async () => {
    vi.mocked(reviewInboxList)
      .mockResolvedValueOnce(page([item("github", "team/a", 1, "2025-01-01T00:00:00Z")], 1, 2))
      .mockResolvedValueOnce(page([item("github", "team/b", 2, "2025-01-02T00:00:00Z")], 2, 2))
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(page([item("github", "team/a", 1, "2025-01-04T00:00:00Z")], 1, 2))
      .mockResolvedValueOnce(page([item("github", "team/b", 2, "2025-01-03T00:00:00Z")], 2, 2));
    const store = useReviewInboxStore();

    await store.refresh(["github"]);
    await store.loadMore();
    await store.backgroundRefresh(["github"], 1_000_000);
    expect(store.errors.github).toContain("network unavailable");

    await store.retry("github");

    expect(reviewInboxList).toHaveBeenNthCalledWith(4, "github", "review_requested", 1, 20);
    expect(reviewInboxList).toHaveBeenNthCalledWith(5, "github", "review_requested", 2, 20);
    expect(store.items.map((entry) => entry.summary.updated_at)).toEqual([
      "2025-01-04T00:00:00Z",
      "2025-01-03T00:00:00Z",
    ]);
    expect(store.errors.github).toBeNull();
    expect(store.pages.github).toBe(2);
  });

  it("记录已读状态，并在远端提交、评论和状态变化后重新标记未读", async () => {
    const initial = item("github", "team/a", 1, "2025-01-01T00:00:00Z", ["reviewer"], {
      status: "ready",
      draft: false,
      has_conflicts: false,
      checks_status: "ready",
      approvals_status: "ready",
      blocking_reasons: [],
    });
    initial.head_sha = "head-1";
    initial.comments_count = 1;
    vi.mocked(reviewInboxList).mockResolvedValueOnce(page([initial]));
    const store = useReviewInboxStore();

    await store.refresh(["github"]);
    expect(store.items[0].local_state).toEqual({
      unread: true,
      new_commits: false,
      new_comments: false,
      status_changed: false,
    });
    store.markRead(store.items[0]);
    expect(store.items[0].local_state?.unread).toBe(false);

    const changed = item("github", "team/a", 1, "2025-01-02T00:00:00Z", ["reviewer"], {
      status: "blocked",
      draft: false,
      has_conflicts: false,
      checks_status: "blocked",
      approvals_status: "ready",
      blocking_reasons: [{ code: "checks_failed", message: "CI 检查未通过" }],
    });
    changed.head_sha = "head-2";
    changed.comments_count = 2;
    vi.mocked(reviewInboxList).mockResolvedValueOnce(page([changed]));
    await store.refresh(["github"]);

    expect(store.items[0].local_state).toEqual({
      unread: true,
      new_commits: true,
      new_comments: true,
      status_changed: true,
    });
    store.markRead(store.items[0]);
    expect(store.items[0].local_state).toEqual({
      unread: false,
      new_commits: false,
      new_comments: false,
      status_changed: false,
    });
    store.markUnread(store.items[0]);
    expect(store.items[0].local_state?.unread).toBe(true);
  });

  it("全部标为已读会处理筛选条件隐藏的已加载条目", async () => {
    vi.mocked(reviewInboxList).mockResolvedValue(
      page([
        item("github", "team/visible", 1, "2025-01-02T00:00:00Z"),
        item("github", "team/hidden", 2, "2025-01-01T00:00:00Z"),
      ]),
    );
    const store = useReviewInboxStore();
    await store.refresh(["github"]);

    store.filters.repository = "visible";
    expect(store.items).toHaveLength(1);
    expect(store.unreadCount).toBe(2);
    store.markAllRead();

    store.filters.repository = "";
    expect(store.items).toHaveLength(2);
    expect(store.items.every((entry) => entry.local_state?.unread === false)).toBe(true);
    expect(store.unreadCount).toBe(0);
  });

  it("将损坏的本地活动状态字段规范化为布尔值", async () => {
    const persistedKey = `github\u0000team/a\u00001`;
    const statusFingerprint = JSON.stringify({
      status: "unknown",
      draft: null,
      has_conflicts: null,
      checks_status: "unknown",
      approvals_status: "unknown",
      reasons: [],
    });
    storage.set(
      "mergebeacon:review-inbox-item-state:v1",
      JSON.stringify({
        [persistedKey]: {
          unread: "false",
          new_commits: 1,
          new_comments: null,
          status_changed: {},
          updated_at: "2025-01-01T00:00:00Z",
          head_sha: null,
          comments_count: null,
          status_fingerprint: statusFingerprint,
          touched_at: 1,
        },
      }),
    );
    vi.mocked(reviewInboxList).mockResolvedValue(
      page([item("github", "team/a", 1, "2025-01-01T00:00:00Z")]),
    );
    const store = useReviewInboxStore();

    await store.refresh(["github"]);

    expect(store.items[0].local_state).toEqual({
      unread: false,
      new_commits: false,
      new_comments: false,
      status_changed: false,
    });
    const persisted = JSON.parse(storage.get("mergebeacon:review-inbox-item-state:v1") ?? "{}");
    expect(persisted[persistedKey]).toMatchObject({
      unread: false,
      new_commits: false,
      new_comments: false,
      status_changed: false,
    });
  });

  it("保留超过 1000 条近期状态，并淘汰长期无活动的已读记录", () => {
    const now = 2_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    const state = (touchedAt: number, unread = false) => ({
      unread,
      new_commits: false,
      new_comments: false,
      status_changed: false,
      updated_at: "2025-01-01T00:00:00Z",
      head_sha: null,
      comments_count: null,
      status_fingerprint: "status",
      touched_at: touchedAt,
    });
    const persisted = Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [
        `github\u0000team/repo\u0000${index}`,
        state(now - index),
      ]),
    );
    const oldReadKey = `gitlab\u0000team/old-read\u00001`;
    const oldUnreadKey = `gitee\u0000team/old-unread\u00002`;
    persisted[oldReadKey] = state(now - 181 * day);
    persisted[oldUnreadKey] = state(now - 181 * day, true);
    storage.set("mergebeacon:review-inbox-item-state:v1", JSON.stringify(persisted));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const store = useReviewInboxStore();

    store.markRead(item("github", "team/new", 10_000, "2025-01-02T00:00:00Z"));

    const saved = JSON.parse(storage.get("mergebeacon:review-inbox-item-state:v1") ?? "{}");
    expect(Object.keys(saved)).toHaveLength(1003);
    expect(saved[oldReadKey]).toBeUndefined();
    expect(saved[oldUnreadKey]?.unread).toBe(true);
    nowSpy.mockRestore();
  });

  it("超过 5000 条本地状态时优先保留活动记录并淘汰最旧已读记录", () => {
    const now = 2_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    const state = (touchedAt: number, unread: boolean) => ({
      unread,
      new_commits: false,
      new_comments: false,
      status_changed: false,
      updated_at: "2025-01-01T00:00:00Z",
      head_sha: null,
      comments_count: null,
      status_fingerprint: "status",
      touched_at: touchedAt,
    });
    const pendingEntries = Array.from({ length: 100 }, (_, index) => [
      `gitee\u0000team/pending\u0000${index}`,
      state(now - 181 * day - index, true),
    ]);
    const readEntries = Array.from({ length: 5100 }, (_, index) => [
      `gitlab\u0000team/read\u0000${index}`,
      state(now - index - 1, false),
    ]);
    storage.set(
      "mergebeacon:review-inbox-item-state:v1",
      JSON.stringify(Object.fromEntries([...pendingEntries, ...readEntries])),
    );
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const store = useReviewInboxStore();

    store.markRead(item("github", "team/new", 10_000, "2025-01-02T00:00:00Z"));

    const saved = JSON.parse(storage.get("mergebeacon:review-inbox-item-state:v1") ?? "{}");
    expect(Object.keys(saved)).toHaveLength(5000);
    expect(pendingEntries.every(([key]) => saved[key as string]?.unread === true)).toBe(true);
    expect(saved[`github\u0000team/new\u000010000`]?.unread).toBe(false);
    expect(saved[`gitlab\u0000team/read\u00004898`]).toBeDefined();
    expect(saved[`gitlab\u0000team/read\u00004899`]).toBeUndefined();
    expect(saved[`gitlab\u0000team/read\u00005099`]).toBeUndefined();
    nowSpy.mockRestore();
  });

  it("支持详细阻塞筛选和阻塞、可合并、检查失败优先排序", async () => {
    const failed = item("github", "team/failed", 1, "2025-01-01T00:00:00Z", ["reviewer"], {
      status: "blocked",
      draft: false,
      has_conflicts: false,
      checks_status: "blocked",
      approvals_status: "ready",
      blocking_reasons: [{ code: "checks_failed", message: "CI 失败" }],
    });
    const draft = item("github", "team/draft", 2, "2025-01-03T00:00:00Z", ["reviewer"], {
      status: "blocked",
      draft: true,
      has_conflicts: false,
      checks_status: "ready",
      approvals_status: "ready",
      blocking_reasons: [{ code: "draft", message: "Draft" }],
    });
    const ready = item("github", "team/ready", 3, "2025-01-02T00:00:00Z", ["reviewer"], {
      status: "ready",
      draft: false,
      has_conflicts: false,
      checks_status: "ready",
      approvals_status: "ready",
      blocking_reasons: [],
    });
    vi.mocked(reviewInboxList).mockResolvedValue(page([failed, draft, ready]));
    const store = useReviewInboxStore();
    await store.refresh(["github"]);

    store.filters.blocker = "checks_failed";
    expect(store.items.map((entry) => entry.summary.number)).toEqual([1]);
    store.filters.blocker = "all";
    store.filters.sort = "blocked";
    expect(store.items.slice(0, 2).map((entry) => entry.summary.number)).toEqual([2, 1]);
    store.filters.sort = "mergeable";
    expect(store.items[0].summary.number).toBe(3);
    store.filters.sort = "checks_failed";
    expect(store.items[0].summary.number).toBe(1);
  });

  it("持久化筛选排序，并对后台刷新执行节流和限流退避", async () => {
    vi.mocked(reviewInboxList).mockResolvedValue(
      page([item("github", "team/a", 1, "2025-01-01T00:00:00Z")]),
    );
    const store = useReviewInboxStore();
    await store.refresh(["github"]);
    store.filters.read = "unread";
    store.filters.blocker = "checks_pending";
    store.filters.sort = "blocked";
    await nextTick();

    setActivePinia(createPinia());
    const restored = useReviewInboxStore();
    expect(restored.filters.read).toBe("unread");
    expect(restored.filters.blocker).toBe("checks_pending");
    expect(restored.filters.sort).toBe("blocked");

    await restored.refresh(["github"]);
    vi.mocked(reviewInboxList).mockClear();
    vi.mocked(reviewInboxList).mockRejectedValueOnce(
      new ApiError({
        code: "rate_limited",
        message: "代码平台请求过于频繁，请稍后重试",
        retryable: true,
        http_status: 429,
      }),
    );
    expect(await restored.backgroundRefresh(["github"], 1_000_000)).toBe(true);
    expect(restored.rateLimitedUntil.github).toBeGreaterThan(1_000_000);
    expect(await restored.backgroundRefresh(["github"], 1_000_001)).toBe(false);
    expect(reviewInboxList).toHaveBeenCalledTimes(1);
  });

  it("连续每分钟刷新时执行五分钟节流并在限流到期后恢复平台轮询", async () => {
    vi.useFakeTimers();
    const start = 2_000_000_000_000;
    vi.setSystemTime(start);
    vi.mocked(reviewInboxList).mockImplementation(async (platform) =>
      page([item(platform, `team/${platform}`, 1, "2025-01-01T00:00:00Z")]),
    );
    const store = useReviewInboxStore();
    await store.refresh(["github", "gitlab", "gitee"]);

    const attempts: Record<Platform, number> = { github: 0, gitlab: 0, gitee: 0 };
    vi.mocked(reviewInboxList).mockClear();
    vi.mocked(reviewInboxList).mockImplementation(async (platform) => {
      attempts[platform] += 1;
      if (platform === "github" && attempts.github === 1) {
        throw new Error("HTTP 429 rate limit");
      }
      return page([item(platform, `team/${platform}`, 1, "2025-01-02T00:00:00Z")]);
    });

    const refreshResults: boolean[] = [];
    for (let minute = 0; minute <= 20; minute += 1) {
      const now = start + minute * 60 * 1000;
      vi.setSystemTime(now);
      refreshResults.push(await store.backgroundRefresh(["github", "gitlab", "gitee"], now));
    }

    expect(refreshResults.map((refreshed, minute) => (refreshed ? minute : null))).toEqual([
      0,
      null,
      null,
      null,
      null,
      5,
      null,
      null,
      null,
      null,
      10,
      null,
      null,
      null,
      null,
      15,
      null,
      null,
      null,
      null,
      20,
    ]);
    expect(attempts).toEqual({ github: 3, gitlab: 5, gitee: 5 });
    expect(store.rateLimitedUntil.github).toBe(0);
    expect(reviewInboxList).toHaveBeenCalledTimes(13);
  });

  it("仓库搜索停止输入后再持久化偏好", async () => {
    vi.useFakeTimers();
    const store = useReviewInboxStore();

    store.filters.repository = "t";
    await nextTick();
    store.filters.repository = "team/repo";
    await nextTick();

    expect(storage.get("mergebeacon:review-inbox-preferences:v1")).toBeUndefined();
    vi.advanceTimersByTime(399);
    expect(storage.get("mergebeacon:review-inbox-preferences:v1")).toBeUndefined();
    vi.advanceTimersByTime(1);

    expect(
      JSON.parse(storage.get("mergebeacon:review-inbox-preferences:v1") ?? "{}"),
    ).toMatchObject({ repository: "team/repo" });
  });
});
