import { computed, onScopeDispose, ref, watch } from "vue";
import { defineStore } from "pinia";
import { reviewInboxList } from "@/api";
import { commandErrorCode } from "@/api/errors";
import type {
  Paginated,
  Platform,
  ReadinessState,
  ReviewInboxCategory,
  ReviewInboxItem,
  ReviewInboxLocalState,
  ReviewInboxRelationship,
  ReviewInboxStatusSummary,
} from "@/types";

const PLATFORMS: Platform[] = ["github", "gitlab", "gitee"];
const PER_PAGE = 20;
export const INBOX_BACKGROUND_REFRESH_MS = 5 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;
const PREFERENCES_WRITE_DEBOUNCE_MS = 400;
const PREFERENCES_STORAGE_KEY = "mergebeacon:review-inbox-preferences:v1";
const ITEM_STATE_STORAGE_KEY = "mergebeacon:review-inbox-item-state:v1";
const MAX_PERSISTED_ITEMS = 5000;
const READ_STATE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

type RelationshipFilter = "all" | Exclude<ReviewInboxRelationship, "author">;
type ReadinessFilter = "all" | ReadinessState;
export type InboxReadFilter = "all" | "unread" | "read";
export type InboxBlockerFilter =
  | "all"
  | "checks_failed"
  | "checks_pending"
  | "changes_requested"
  | "approvals_required"
  | "draft"
  | "conflicts"
  | "branch_behind"
  | "discussions_unresolved";
export type InboxSort = "updated" | "blocked" | "mergeable" | "checks_failed";

interface InboxFilters {
  category: ReviewInboxCategory;
  platform: "all" | Platform;
  repository: string;
  relationship: RelationshipFilter;
  readiness: ReadinessFilter;
  read: InboxReadFilter;
  blocker: InboxBlockerFilter;
  sort: InboxSort;
}

interface PersistedItemState extends ReviewInboxLocalState {
  updated_at: string;
  head_sha: string | null;
  comments_count: number | null;
  status_fingerprint: string;
  touched_at: number;
}

const defaultFilters: InboxFilters = {
  category: "review_requested",
  platform: "all",
  repository: "",
  relationship: "all",
  readiness: "all",
  read: "all",
  blocker: "all",
  sort: "updated",
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is best effort; inbox fetching must continue without it.
  }
}

function loadFilters(): InboxFilters {
  const stored = readStorage<Partial<InboxFilters>>(PREFERENCES_STORAGE_KEY, {});
  const merged = { ...defaultFilters, ...stored };
  const includes = <T extends string>(values: readonly T[], value: unknown): value is T =>
    typeof value === "string" && values.includes(value as T);
  return {
    category: includes(["review_requested", "authored"] as const, merged.category)
      ? merged.category
      : defaultFilters.category,
    platform: includes(["all", ...PLATFORMS] as const, merged.platform)
      ? merged.platform
      : defaultFilters.platform,
    repository: typeof merged.repository === "string" ? merged.repository.slice(0, 256) : "",
    relationship: includes(["all", "reviewer", "assignee", "tester"] as const, merged.relationship)
      ? merged.relationship
      : defaultFilters.relationship,
    readiness: includes(
      ["all", "ready", "blocked", "pending", "unknown"] as const,
      merged.readiness,
    )
      ? merged.readiness
      : defaultFilters.readiness,
    read: includes(["all", "unread", "read"] as const, merged.read)
      ? merged.read
      : defaultFilters.read,
    blocker: includes(
      [
        "all",
        "checks_failed",
        "checks_pending",
        "changes_requested",
        "approvals_required",
        "draft",
        "conflicts",
        "branch_behind",
        "discussions_unresolved",
      ] as const,
      merged.blocker,
    )
      ? merged.blocker
      : defaultFilters.blocker,
    sort: includes(["updated", "blocked", "mergeable", "checks_failed"] as const, merged.sort)
      ? merged.sort
      : defaultFilters.sort,
  };
}

function itemKey(
  item: Pick<ReviewInboxItem, "platform" | "repository_full_name" | "summary">,
): string {
  return `${item.platform}\u0000${item.repository_full_name}\u0000${item.summary.number}`;
}

function statusFingerprint(status: ReviewInboxStatusSummary): string {
  return JSON.stringify({
    status: status.status,
    draft: status.draft,
    has_conflicts: status.has_conflicts,
    checks_status: status.checks_status,
    approvals_status: status.approvals_status,
    reasons: status.blocking_reasons.map((reason) => reason.code).sort(),
  });
}

function hasBlocker(item: ReviewInboxItem, blocker: InboxBlockerFilter): boolean {
  if (blocker === "all") return true;
  if (blocker === "draft") return item.status.draft === true;
  if (blocker === "conflicts") return item.status.has_conflicts === true;
  if (blocker === "checks_failed") return item.status.checks_status === "blocked";
  if (blocker === "checks_pending") return item.status.checks_status === "pending";
  return item.status.blocking_reasons.some((reason) => reason.code === blocker);
}

function sortItems(left: ReviewInboxItem, right: ReviewInboxItem, sort: InboxSort): number {
  const updated = right.summary.updated_at.localeCompare(left.summary.updated_at);
  if (sort === "updated") return updated;
  const rank = (item: ReviewInboxItem): number => {
    if (sort === "blocked") return item.status.status === "blocked" ? 1 : 0;
    if (sort === "mergeable") return item.status.status === "ready" ? 1 : 0;
    return item.status.checks_status === "blocked" ? 1 : 0;
  };
  return rank(right) - rank(left) || updated;
}

function isRateLimitError(cause: unknown): boolean {
  if (commandErrorCode(cause) === "rate_limited") return true;
  const message = cause instanceof Error ? cause.message : String(cause);
  return /\b429\b|rate.?limit|限流|请求过于频繁/i.test(message);
}

function platformRecord<T>(factory: () => T): Record<Platform, T> {
  return {
    github: factory(),
    gitlab: factory(),
    gitee: factory(),
  };
}

function readinessRank(state: ReadinessState): number {
  return { blocked: 4, pending: 3, ready: 2, unknown: 1 }[state];
}

function mergeReadiness(left: ReadinessState, right: ReadinessState): ReadinessState {
  return readinessRank(right) > readinessRank(left) ? right : left;
}

function mergeOptionalFlag(left: boolean | null, right: boolean | null): boolean | null {
  if (left === true || right === true) return true;
  if (left === false || right === false) return false;
  return null;
}

function mergeStatus(
  left: ReviewInboxStatusSummary,
  right: ReviewInboxStatusSummary,
): ReviewInboxStatusSummary {
  const reasons = new Map(
    [...left.blocking_reasons, ...right.blocking_reasons].map((reason) => [
      `${reason.code}\u0000${reason.message}`,
      reason,
    ]),
  );
  return {
    status: mergeReadiness(left.status, right.status),
    draft: mergeOptionalFlag(left.draft, right.draft),
    has_conflicts: mergeOptionalFlag(left.has_conflicts, right.has_conflicts),
    checks_status: mergeReadiness(left.checks_status, right.checks_status),
    approvals_status: mergeReadiness(left.approvals_status, right.approvals_status),
    blocking_reasons: Array.from(reasons.values()),
  };
}

function dedupeItems(items: ReviewInboxItem[]): ReviewInboxItem[] {
  const merged = new Map<string, ReviewInboxItem>();
  for (const item of items) {
    const key = itemKey(item);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }
    merged.set(key, {
      ...existing,
      categories: Array.from(new Set([...existing.categories, ...item.categories])),
      relationships: Array.from(new Set([...existing.relationships, ...item.relationships])),
      status: mergeStatus(existing.status, item.status),
      head_sha: item.head_sha ?? existing.head_sha,
      comments_count:
        existing.comments_count == null
          ? item.comments_count
          : item.comments_count == null
            ? existing.comments_count
            : Math.max(existing.comments_count, item.comments_count),
    });
  }
  return Array.from(merged.values());
}

function composePageItems(pages: Map<number, ReviewInboxItem[]>): ReviewInboxItem[] {
  const seen = new Set<string>();
  const composed: ReviewInboxItem[] = [];
  for (const [, items] of [...pages.entries()].sort(([left], [right]) => left - right)) {
    for (const item of items) {
      const key = itemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      composed.push(item);
    }
  }
  return composed;
}

export const useReviewInboxStore = defineStore("review-inbox", () => {
  const itemsByPlatform = ref<Record<Platform, ReviewInboxItem[]>>(platformRecord(() => []));
  const pages = ref<Record<Platform, number>>(platformRecord(() => 0));
  const totalPages = ref<Record<Platform, number>>(platformRecord(() => 1));
  const loadingByPlatform = ref<Record<Platform, boolean>>(platformRecord(() => false));
  const errors = ref<Record<Platform, string | null>>(platformRecord(() => null));
  const failedPages = ref<Record<Platform, number | null>>(platformRecord(() => null));
  const filters = ref<InboxFilters>(loadFilters());
  const itemStates = ref<Record<string, PersistedItemState>>(
    readStorage<Record<string, PersistedItemState>>(ITEM_STATE_STORAGE_KEY, {}),
  );
  const rateLimitedUntil = ref<Record<Platform, number>>(platformRecord(() => 0));
  const lastBackgroundRefreshAt = ref(0);
  const loggedInPlatforms = ref<Platform[]>([]);
  const pageItemsByPlatform: Record<Platform, Map<number, ReviewInboxItem[]>> = platformRecord(
    () => new Map(),
  );
  const requestSequences: Record<Platform, number> = platformRecord(() => 0);
  let contextSequence = 0;

  function persistItemStates(): void {
    const now = Date.now();
    const hasPendingActivity = (state: PersistedItemState): boolean =>
      state.unread === true ||
      state.new_commits === true ||
      state.new_comments === true ||
      state.status_changed === true;
    const entries = Object.entries(itemStates.value)
      .filter(([, state]) => {
        const touchedAt = Number.isFinite(state.touched_at) ? state.touched_at : 0;
        return hasPendingActivity(state) || now - touchedAt <= READ_STATE_RETENTION_MS;
      })
      .sort(([, left], [, right]) => {
        const leftTouchedAt = Number.isFinite(left.touched_at) ? left.touched_at : 0;
        const rightTouchedAt = Number.isFinite(right.touched_at) ? right.touched_at : 0;
        return (
          Number(hasPendingActivity(right)) - Number(hasPendingActivity(left)) ||
          rightTouchedAt - leftTouchedAt
        );
      })
      .slice(0, MAX_PERSISTED_ITEMS);
    if (entries.length !== Object.keys(itemStates.value).length) {
      itemStates.value = Object.fromEntries(entries);
    }
    writeStorage(ITEM_STATE_STORAGE_KEY, itemStates.value);
  }

  function reconcileItems(items: ReviewInboxItem[]): void {
    const now = Date.now();
    let changed = false;
    const next = { ...itemStates.value };
    for (const item of items) {
      const key = itemKey(item);
      const previous = next[key];
      const fingerprint = statusFingerprint(item.status);
      const headSha = item.head_sha ?? null;
      const commentsCount = item.comments_count ?? null;
      if (!previous) {
        next[key] = {
          unread: true,
          new_commits: false,
          new_comments: false,
          status_changed: false,
          updated_at: item.summary.updated_at,
          head_sha: headSha,
          comments_count: commentsCount,
          status_fingerprint: fingerprint,
          touched_at: now,
        };
        changed = true;
        continue;
      }
      const newCommits = Boolean(previous.head_sha && headSha && previous.head_sha !== headSha);
      const newComments = Boolean(
        previous.comments_count != null &&
        commentsCount != null &&
        commentsCount > previous.comments_count,
      );
      const statusChanged = previous.status_fingerprint !== fingerprint;
      const remoteChanged =
        previous.updated_at !== item.summary.updated_at ||
        newCommits ||
        newComments ||
        statusChanged;
      next[key] = {
        ...previous,
        unread: previous.unread === true || remoteChanged,
        new_commits: previous.new_commits === true || newCommits,
        new_comments: previous.new_comments === true || newComments,
        status_changed: previous.status_changed === true || statusChanged,
        updated_at: item.summary.updated_at,
        head_sha: headSha ?? previous.head_sha,
        comments_count: commentsCount ?? previous.comments_count,
        status_fingerprint: fingerprint,
        touched_at: now,
      };
      changed ||= JSON.stringify(next[key]) !== JSON.stringify(previous);
    }
    if (changed) {
      itemStates.value = next;
      persistItemStates();
    }
  }

  function localState(item: ReviewInboxItem): ReviewInboxLocalState {
    const state = itemStates.value[itemKey(item)];
    return state
      ? {
          unread: state.unread === true,
          new_commits: state.new_commits === true,
          new_comments: state.new_comments === true,
          status_changed: state.status_changed === true,
        }
      : { unread: true, new_commits: false, new_comments: false, status_changed: false };
  }

  const visiblePlatforms = computed(() => {
    if (filters.value.platform === "all") return loggedInPlatforms.value;
    return loggedInPlatforms.value.includes(filters.value.platform) ? [filters.value.platform] : [];
  });

  const loadedItems = computed(() =>
    dedupeItems(PLATFORMS.flatMap((platform) => itemsByPlatform.value[platform])).map((item) => ({
      ...item,
      local_state: localState(item),
    })),
  );
  const unreadCount = computed(
    () => loadedItems.value.filter((item) => item.local_state.unread).length,
  );

  const items = computed(() => {
    const repositoryQuery = filters.value.repository.trim().toLocaleLowerCase();
    return loadedItems.value
      .filter(
        (item) =>
          visiblePlatforms.value.includes(item.platform) &&
          (!repositoryQuery ||
            item.repository_full_name.toLocaleLowerCase().includes(repositoryQuery)) &&
          (filters.value.relationship === "all" ||
            item.relationships.includes(filters.value.relationship)) &&
          (filters.value.readiness === "all" || item.status.status === filters.value.readiness) &&
          (filters.value.read === "all" ||
            (filters.value.read === "unread"
              ? item.local_state.unread
              : !item.local_state.unread)) &&
          hasBlocker(item, filters.value.blocker),
      )
      .sort((left, right) => sortItems(left, right, filters.value.sort));
  });

  const loading = computed(() =>
    loggedInPlatforms.value.some((platform) => loadingByPlatform.value[platform]),
  );
  const hasMore = computed(() =>
    visiblePlatforms.value.some((platform) => pages.value[platform] < totalPages.value[platform]),
  );

  async function fetchPlatform(
    platform: Platform,
    requestedPage: number,
    category: ReviewInboxCategory,
    expectedContext: number,
    mode: "replace" | "append" | "background" = requestedPage === 1 ? "replace" : "append",
  ): Promise<boolean> {
    const requestSequence = ++requestSequences[platform];
    loadingByPlatform.value[platform] = true;
    errors.value[platform] = null;
    failedPages.value[platform] = null;
    try {
      const result: Paginated<ReviewInboxItem> = await reviewInboxList(
        platform,
        category,
        requestedPage,
        PER_PAGE,
      );
      if (
        expectedContext !== contextSequence ||
        requestSequence !== requestSequences[platform] ||
        filters.value.category !== category
      ) {
        return false;
      }
      const incoming = dedupeItems(result.items);
      reconcileItems(incoming);
      if (mode === "background") {
        pageItemsByPlatform[platform].set(1, incoming);
        itemsByPlatform.value[platform] = composePageItems(pageItemsByPlatform[platform]);
        pages.value[platform] = Math.max(pages.value[platform], result.page);
        totalPages.value[platform] = Math.max(pages.value[platform], result.total_pages);
      } else {
        if (mode === "replace") pageItemsByPlatform[platform].clear();
        pageItemsByPlatform[platform].set(result.page, incoming);
        itemsByPlatform.value[platform] = composePageItems(pageItemsByPlatform[platform]);
        pages.value[platform] = result.page;
        totalPages.value[platform] = Math.max(result.page, result.total_pages);
      }
      rateLimitedUntil.value[platform] = 0;
      return true;
    } catch (cause) {
      if (
        expectedContext === contextSequence &&
        requestSequence === requestSequences[platform] &&
        filters.value.category === category
      ) {
        errors.value[platform] = typeof cause === "string" ? cause : String(cause);
        if (mode !== "background") failedPages.value[platform] = requestedPage;
        if (isRateLimitError(cause)) {
          rateLimitedUntil.value[platform] = Date.now() + RATE_LIMIT_BACKOFF_MS;
        }
      }
      return false;
    } finally {
      if (expectedContext === contextSequence && requestSequence === requestSequences[platform]) {
        loadingByPlatform.value[platform] = false;
      }
    }
  }

  async function refresh(platforms: Platform[]): Promise<void> {
    const expectedContext = ++contextSequence;
    loggedInPlatforms.value = PLATFORMS.filter((platform) => platforms.includes(platform));
    const requestedPlatforms = [...visiblePlatforms.value];
    const category = filters.value.category;

    for (const platform of PLATFORMS) {
      requestSequences[platform] += 1;
      loadingByPlatform.value[platform] = false;
      errors.value[platform] = null;
      failedPages.value[platform] = null;
      itemsByPlatform.value[platform] = [];
      pageItemsByPlatform[platform].clear();
      pages.value[platform] = 0;
      totalPages.value[platform] = 1;
    }

    await Promise.all(
      requestedPlatforms.map((platform) => fetchPlatform(platform, 1, category, expectedContext)),
    );
  }

  async function loadMore(): Promise<void> {
    const expectedContext = contextSequence;
    const category = filters.value.category;
    const pending = visiblePlatforms.value
      .filter(
        (platform) =>
          !loadingByPlatform.value[platform] && pages.value[platform] < totalPages.value[platform],
      )
      .map((platform) =>
        fetchPlatform(platform, pages.value[platform] + 1, category, expectedContext),
      );
    await Promise.all(pending);
  }

  async function retry(platform: Platform): Promise<void> {
    if (!visiblePlatforms.value.includes(platform)) return;
    const failedPage = failedPages.value[platform];
    if (failedPage != null) {
      await fetchPlatform(platform, failedPage, filters.value.category, contextSequence);
      return;
    }
    const lastLoadedPage = Math.max(pages.value[platform], 1);
    const category = filters.value.category;
    const expectedContext = contextSequence;
    for (let page = 1; page <= lastLoadedPage; page += 1) {
      const mode = page === 1 && pages.value[platform] > 0 ? "background" : undefined;
      const succeeded = await fetchPlatform(platform, page, category, expectedContext, mode);
      if (!succeeded) return;
    }
  }

  async function backgroundRefresh(platforms: Platform[], now = Date.now()): Promise<boolean> {
    if (now - lastBackgroundRefreshAt.value < INBOX_BACKGROUND_REFRESH_MS) return false;
    const enabledPlatforms = PLATFORMS.filter((platform) => platforms.includes(platform));
    const requestedPlatforms = visiblePlatforms.value.filter(
      (platform) =>
        enabledPlatforms.includes(platform) &&
        !loadingByPlatform.value[platform] &&
        rateLimitedUntil.value[platform] <= now,
    );
    if (requestedPlatforms.length === 0) return false;
    lastBackgroundRefreshAt.value = now;
    const expectedContext = contextSequence;
    const category = filters.value.category;
    await Promise.all(
      requestedPlatforms.map((platform) =>
        fetchPlatform(platform, 1, category, expectedContext, "background"),
      ),
    );
    return true;
  }

  function markRead(item: ReviewInboxItem): void {
    const key = itemKey(item);
    const previous = itemStates.value[key];
    itemStates.value = {
      ...itemStates.value,
      [key]: {
        unread: false,
        new_commits: false,
        new_comments: false,
        status_changed: false,
        updated_at: item.summary.updated_at,
        head_sha: item.head_sha ?? previous?.head_sha ?? null,
        comments_count: item.comments_count ?? previous?.comments_count ?? null,
        status_fingerprint: statusFingerprint(item.status),
        touched_at: Date.now(),
      },
    };
    persistItemStates();
  }

  function markUnread(item: ReviewInboxItem): void {
    const key = itemKey(item);
    const previous = itemStates.value[key];
    itemStates.value = {
      ...itemStates.value,
      [key]: {
        unread: true,
        new_commits: previous?.new_commits ?? false,
        new_comments: previous?.new_comments ?? false,
        status_changed: previous?.status_changed ?? false,
        updated_at: item.summary.updated_at,
        head_sha: item.head_sha ?? previous?.head_sha ?? null,
        comments_count: item.comments_count ?? previous?.comments_count ?? null,
        status_fingerprint: statusFingerprint(item.status),
        touched_at: Date.now(),
      },
    };
    persistItemStates();
  }

  function markAllRead(): void {
    const now = Date.now();
    const next = { ...itemStates.value };
    for (const item of loadedItems.value) {
      const key = itemKey(item);
      const previous = next[key];
      next[key] = {
        unread: false,
        new_commits: false,
        new_comments: false,
        status_changed: false,
        updated_at: item.summary.updated_at,
        head_sha: item.head_sha ?? previous?.head_sha ?? null,
        comments_count: item.comments_count ?? previous?.comments_count ?? null,
        status_fingerprint: statusFingerprint(item.status),
        touched_at: now,
      };
    }
    itemStates.value = next;
    persistItemStates();
  }

  function applyPrSummary(
    platform: Platform,
    owner: string,
    repo: string,
    summary: ReviewInboxItem["summary"],
  ): void {
    const repositoryFullName = `${owner}/${repo}`;
    itemsByPlatform.value[platform] = itemsByPlatform.value[platform].map((item) => {
      if (
        item.repository_full_name !== repositoryFullName ||
        item.summary.number !== summary.number
      ) {
        return item;
      }
      return {
        ...item,
        summary,
        status: summary.status
          ? {
              ...item.status,
              draft: summary.status.draft,
            }
          : item.status,
      };
    });
  }

  function clear(): void {
    contextSequence += 1;
    loggedInPlatforms.value = [];
    for (const platform of PLATFORMS) {
      requestSequences[platform] += 1;
      itemsByPlatform.value[platform] = [];
      pageItemsByPlatform[platform].clear();
      pages.value[platform] = 0;
      totalPages.value[platform] = 1;
      loadingByPlatform.value[platform] = false;
      errors.value[platform] = null;
      failedPages.value[platform] = null;
    }
  }

  function persistFilters(): void {
    writeStorage(PREFERENCES_STORAGE_KEY, filters.value);
  }

  watch(
    () => [
      filters.value.category,
      filters.value.platform,
      filters.value.relationship,
      filters.value.readiness,
      filters.value.read,
      filters.value.blocker,
      filters.value.sort,
    ],
    persistFilters,
  );

  let preferencesWriteTimer: ReturnType<typeof setTimeout> | null = null;
  watch(
    () => filters.value.repository,
    () => {
      if (preferencesWriteTimer) clearTimeout(preferencesWriteTimer);
      preferencesWriteTimer = setTimeout(() => {
        preferencesWriteTimer = null;
        persistFilters();
      }, PREFERENCES_WRITE_DEBOUNCE_MS);
    },
  );
  onScopeDispose(() => {
    if (!preferencesWriteTimer) return;
    clearTimeout(preferencesWriteTimer);
    preferencesWriteTimer = null;
    persistFilters();
  });

  return {
    itemsByPlatform,
    pages,
    totalPages,
    loadingByPlatform,
    errors,
    filters,
    loggedInPlatforms,
    visiblePlatforms,
    items,
    loading,
    hasMore,
    unreadCount,
    rateLimitedUntil,
    lastBackgroundRefreshAt,
    refresh,
    backgroundRefresh,
    loadMore,
    retry,
    markRead,
    markUnread,
    markAllRead,
    applyPrSummary,
    clear,
  };
});
