import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { reviewInboxList } from "@/api";
import { useNotificationStore } from "@/stores/useNotificationStore";
import type { Paginated, Platform, ReviewInboxItem, ReviewInboxStatusSummary } from "@/types";

const storage = new Map<string, string>();
const SNAPSHOTS_STORAGE_KEY = "mergebeacon:notification-snapshots:v1";
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
  number: number,
  updatedAt: string,
  status: ReviewInboxStatusSummary,
): ReviewInboxItem {
  return {
    platform,
    owner: "team",
    repo: "repo",
    repository_full_name: "team/repo",
    categories: ["review_requested"],
    relationships: ["reviewer"],
    status,
    head_sha: `head-${number}`,
    comments_count: 1,
    summary: {
      number,
      title: `Review #${number}`,
      author: { id: number, login: "author", name: "Author", avatar_url: "" },
      state: "open",
      created_at: updatedAt,
      updated_at: updatedAt,
      labels: [],
    },
  };
}

function page(items: ReviewInboxItem[]): Paginated<ReviewInboxItem> {
  return { items, page: 1, total_pages: 1, total_count: items.length };
}

const pendingStatus: ReviewInboxStatusSummary = {
  status: "pending",
  draft: false,
  has_conflicts: false,
  checks_status: "pending",
  approvals_status: "ready",
  blocking_reasons: [{ code: "checks_pending", message: "检查中" }],
};
const readyStatus: ReviewInboxStatusSummary = {
  status: "ready",
  draft: false,
  has_conflicts: false,
  checks_status: "ready",
  approvals_status: "ready",
  blocking_reasons: [],
};

describe("useNotificationStore", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
    vi.mocked(reviewInboxList).mockReset();
  });

  it("首次轮询只建立基线，后续识别评审请求和 PR 活动", async () => {
    const initial = item("github", 1, "2026-07-19T01:00:00Z", pendingStatus);
    vi.mocked(reviewInboxList)
      .mockResolvedValueOnce(page([initial]))
      .mockResolvedValueOnce(page([]));
    const store = useNotificationStore();
    store.setEnabled(true);

    expect(await store.poll(["github"], 1_000_000)).toEqual([]);

    const changed = item("github", 1, "2026-07-19T02:00:00Z", readyStatus);
    changed.head_sha = "head-new";
    changed.comments_count = 2;
    const requested = item("github", 2, "2026-07-19T02:00:00Z", pendingStatus);
    vi.mocked(reviewInboxList)
      .mockResolvedValueOnce(page([changed, requested]))
      .mockResolvedValueOnce(page([]));

    const events = await store.poll(["github"], 2_000_000);

    expect(events.map((event) => event.type).sort()).toEqual([
      "checks_completed",
      "mergeable",
      "new_comments",
      "new_commits",
      "review_request",
    ]);
    expect(events.find((event) => event.type === "review_request")?.number).toBe(2);
  });

  it("单平台限流不会阻止其他平台建立通知基线", async () => {
    vi.mocked(reviewInboxList).mockImplementation(async (platform) => {
      if (platform === "github") throw new Error("HTTP 429 rate limit");
      return page([item(platform, 1, "2026-07-19T01:00:00Z", pendingStatus)]);
    });
    const store = useNotificationStore();
    store.setEnabled(true);

    expect(await store.poll(["github", "gitlab"], 1_000_000)).toEqual([]);

    expect(store.errors.github).toContain("429");
    expect(store.errors.gitlab).toBeNull();
    expect(store.rateLimitedUntil.github).toBeGreaterThan(1_000_000);
    expect(store.retryCountdown.github).toBe(15 * 60);
    expect(store.pollObservations.github).toMatchObject({
      last_attempt_at: 1_000_000,
      last_success_at: null,
      outcome: "rate_limited",
      successful_categories: [],
      failed_categories: ["review_requested", "authored"],
      rate_limited_categories: ["review_requested", "authored"],
      consecutive_degraded_polls: 1,
      rate_limited_polls: 1,
    });

    store.updateClock(1_001_000);
    expect(store.retryCountdown.github).toBe(15 * 60 - 1);
  });

  it("单个类别被限流时保留成功结果且不启用平台级退避", async () => {
    vi.mocked(reviewInboxList).mockImplementation(async (_platform, category) => {
      if (category === "review_requested") throw new Error("HTTP 429 rate limit");
      return page([item("github", 3, "2026-07-19T01:00:00Z", pendingStatus)]);
    });
    const store = useNotificationStore();
    store.setEnabled(true);

    expect(await store.poll(["github"], 1_000_000)).toEqual([]);
    expect(store.errors.github).toContain("429");
    expect(store.rateLimitedUntil.github).toBe(0);
    expect(store.retryCountdown.github).toBe(0);
    expect(store.pollObservations.github).toMatchObject({
      last_attempt_at: 1_000_000,
      last_success_at: 1_000_000,
      outcome: "partial",
      successful_categories: ["authored"],
      failed_categories: ["review_requested"],
      rate_limited_categories: ["review_requested"],
      consecutive_degraded_polls: 1,
      rate_limited_polls: 1,
    });

    await store.poll(["github"], 1_001_000);
    expect(reviewInboxList).toHaveBeenCalledTimes(4);
    expect(store.pollObservations.github.consecutive_degraded_polls).toBe(2);
    expect(store.pollObservations.github.rate_limited_polls).toBe(2);
  });

  it("完整限流期间跳过请求，并在退避到期后恢复成功状态", async () => {
    const start = 1_000_000;
    vi.mocked(reviewInboxList).mockRejectedValue(new Error("HTTP 429 rate limit"));
    const store = useNotificationStore();
    store.setEnabled(true);

    await store.poll(["github"], start);
    expect(reviewInboxList).toHaveBeenCalledTimes(2);

    await store.poll(["github"], start + 15 * 60 * 1000 - 1);
    expect(reviewInboxList).toHaveBeenCalledTimes(2);
    expect(store.pollObservations.github.last_attempt_at).toBe(start);

    vi.mocked(reviewInboxList).mockResolvedValue(page([]));
    await store.poll(["github"], start + 15 * 60 * 1000);

    expect(reviewInboxList).toHaveBeenCalledTimes(4);
    expect(store.pollObservations.github).toMatchObject({
      last_attempt_at: start + 15 * 60 * 1000,
      last_success_at: start + 15 * 60 * 1000,
      outcome: "success",
      successful_categories: ["review_requested", "authored"],
      failed_categories: [],
      rate_limited_categories: [],
      consecutive_degraded_polls: 0,
      rate_limited_polls: 1,
    });
    expect(store.rateLimitedUntil.github).toBe(0);
  });

  it("组合管理器错误和平台轮询错误供全局提示展示", () => {
    const store = useNotificationStore();

    store.setManagerError("permission", "通知权限已撤销");
    store.errors.github = "HTTP 429 rate limit";

    expect(store.notificationError).toContain("通知权限已撤销");
    expect(store.notificationError).toContain("GitHub：HTTP 429 rate limit");

    store.clearManagerError("permission");
    expect(store.notificationError).not.toContain("通知权限已撤销");
  });

  it("清理超过 30 天的快照且不将其作为重新出现 PR 的活动基线", async () => {
    const now = Date.now();
    const expiredKey = "github\u0000team/repo\u00005";
    const recentKey = "github\u0000team/repo\u00006";
    const staleKey = "github\u0000team/repo\u00007";
    storage.set(
      SNAPSHOTS_STORAGE_KEY,
      JSON.stringify({
        [expiredKey]: {
          categories: ["authored"],
          head_sha: "old-head",
          comments_count: 1,
          status: "pending",
          checks_status: "pending",
          touched_at: now - 31 * 24 * 60 * 60 * 1000,
        },
        [recentKey]: {
          categories: ["authored"],
          head_sha: "recent-head",
          comments_count: 1,
          status: "pending",
          checks_status: "pending",
          touched_at: now - 29 * 24 * 60 * 60 * 1000,
        },
        [staleKey]: {
          categories: ["review_requested"],
          head_sha: "stale-head",
          comments_count: 4,
          status: "blocked",
          checks_status: "blocked",
          touched_at: now - 45 * 24 * 60 * 60 * 1000,
        },
      }),
    );
    const current = item("github", 5, "2026-07-19T01:00:00Z", readyStatus);
    current.head_sha = "new-head";
    current.comments_count = 3;
    vi.mocked(reviewInboxList).mockImplementation(async (_platform, category) =>
      page(category === "authored" ? [current] : []),
    );

    const store = useNotificationStore();
    store.setEnabled(true);

    expect(await store.poll(["github"], now)).toEqual([]);
    const persisted = JSON.parse(storage.get(SNAPSHOTS_STORAGE_KEY) ?? "{}") as Record<
      string,
      { head_sha?: string; touched_at?: number }
    >;
    expect(persisted[recentKey]).toBeDefined();
    expect(persisted[expiredKey]).toMatchObject({ head_sha: "new-head", touched_at: now });
    expect(persisted[staleKey]).toBeUndefined();
    expect(Object.keys(persisted)).toHaveLength(2);
  });
});
