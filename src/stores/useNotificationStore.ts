import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import { reviewInboxList } from "@/api";
import { commandErrorCode } from "@/api/errors";
import type { Platform, ReadinessState, ReviewInboxCategory, ReviewInboxItem } from "@/types";

export const NOTIFICATION_POLL_INTERVAL_MS = 10 * 60 * 1000;
const RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;
const PREFERENCES_KEY = "mergebeacon:notification-preferences:v1";
const SNAPSHOTS_KEY = "mergebeacon:notification-snapshots:v1";
const BASELINES_KEY = "mergebeacon:notification-baselines:v1";
const MAX_SNAPSHOTS = 5000;
const SNAPSHOT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PLATFORMS: Platform[] = ["github", "gitlab", "gitee"];
const CATEGORIES: ReviewInboxCategory[] = ["review_requested", "authored"];

export type NotificationEventType =
  | "review_request"
  | "checks_completed"
  | "new_commits"
  | "new_comments"
  | "mergeable";

export interface InboxNotificationEvent {
  type: NotificationEventType;
  platform: Platform;
  owner: string;
  repo: string;
  repository_full_name: string;
  number: number;
  title: string;
}

export interface NotificationPreferences {
  enabled: boolean;
  platforms: Record<Platform, boolean>;
  events: Record<NotificationEventType, boolean>;
  hide_private_content: boolean;
}

export type NotificationManagerErrorSource =
  | "network"
  | "permission"
  | "poll"
  | "delivery"
  | "actions";

export type NotificationPollOutcome = "idle" | "success" | "partial" | "failed" | "rate_limited";

export interface NotificationPollObservation {
  last_attempt_at: number | null;
  last_success_at: number | null;
  outcome: NotificationPollOutcome;
  successful_categories: ReviewInboxCategory[];
  failed_categories: ReviewInboxCategory[];
  rate_limited_categories: ReviewInboxCategory[];
  consecutive_degraded_polls: number;
  rate_limited_polls: number;
}

interface NotificationSnapshot {
  categories: ReviewInboxCategory[];
  head_sha: string | null;
  comments_count: number | null;
  status: ReadinessState;
  checks_status: ReadinessState;
  touched_at: number;
}

type CategoryBaselines = Record<Platform, Record<ReviewInboxCategory, boolean>>;
type NotificationManagerErrors = Record<NotificationManagerErrorSource, string | null>;

const defaultPreferences: NotificationPreferences = {
  enabled: false,
  platforms: { github: true, gitlab: true, gitee: true },
  events: {
    review_request: true,
    checks_completed: true,
    new_commits: true,
    new_comments: true,
    mergeable: true,
  },
  hide_private_content: true,
};

function platformRecord<T>(factory: () => T): Record<Platform, T> {
  return { github: factory(), gitlab: factory(), gitee: factory() };
}

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
    // Notification persistence is best effort and must not block the application.
  }
}

function snapshotsWithinTtl(
  snapshots: Record<string, NotificationSnapshot>,
  now: number,
): Record<string, NotificationSnapshot> {
  const cutoff = now - SNAPSHOT_TTL_MS;
  return Object.fromEntries(
    Object.entries(snapshots).filter(([, snapshot]) => {
      const touchedAt = snapshot?.touched_at;
      return Number.isFinite(touchedAt) && touchedAt >= cutoff;
    }),
  );
}

function loadSnapshots(): Record<string, NotificationSnapshot> {
  const stored = readStorage<Record<string, NotificationSnapshot>>(SNAPSHOTS_KEY, {});
  const current = snapshotsWithinTtl(stored, Date.now());
  if (Object.keys(current).length !== Object.keys(stored).length) {
    writeStorage(SNAPSHOTS_KEY, current);
  }
  return current;
}

function loadPreferences(): NotificationPreferences {
  const stored = readStorage<Partial<NotificationPreferences>>(PREFERENCES_KEY, {});
  const platforms = stored.platforms ?? defaultPreferences.platforms;
  const events = stored.events ?? defaultPreferences.events;
  return {
    enabled: stored.enabled === true,
    platforms: {
      github: platforms.github !== false,
      gitlab: platforms.gitlab !== false,
      gitee: platforms.gitee !== false,
    },
    events: {
      review_request: events.review_request !== false,
      checks_completed: events.checks_completed !== false,
      new_commits: events.new_commits !== false,
      new_comments: events.new_comments !== false,
      mergeable: events.mergeable !== false,
    },
    hide_private_content: stored.hide_private_content !== false,
  };
}

function loadBaselines(): CategoryBaselines {
  const stored = readStorage<Partial<CategoryBaselines>>(BASELINES_KEY, {});
  const baseline = (platform: Platform) => ({
    review_requested: stored[platform]?.review_requested === true,
    authored: stored[platform]?.authored === true,
  });
  return {
    github: baseline("github"),
    gitlab: baseline("gitlab"),
    gitee: baseline("gitee"),
  };
}

function snapshotKey(item: Pick<ReviewInboxItem, "platform" | "repository_full_name" | "summary">) {
  return `${item.platform}\u0000${item.repository_full_name}\u0000${item.summary.number}`;
}

function itemSnapshot(
  item: ReviewInboxItem,
  categories: ReviewInboxCategory[],
  touchedAt: number,
): NotificationSnapshot {
  return {
    categories,
    head_sha: item.head_sha ?? null,
    comments_count: item.comments_count ?? null,
    status: item.status.status,
    checks_status: item.status.checks_status,
    touched_at: touchedAt,
  };
}

function isRateLimitError(cause: unknown): boolean {
  if (commandErrorCode(cause) === "rate_limited") return true;
  const message = cause instanceof Error ? cause.message : String(cause);
  return /\b429\b|rate.?limit|限流|请求过于频繁/i.test(message);
}

export const useNotificationStore = defineStore("notifications", () => {
  const preferences = ref<NotificationPreferences>(loadPreferences());
  const snapshots = ref<Record<string, NotificationSnapshot>>(loadSnapshots());
  const baselines = ref<CategoryBaselines>(loadBaselines());
  const polling = ref(false);
  const managerErrors = ref<NotificationManagerErrors>({
    network: null,
    permission: null,
    poll: null,
    delivery: null,
    actions: null,
  });
  const clock = ref(Date.now());
  const errors = ref<Record<Platform, string | null>>(platformRecord(() => null));
  const rateLimitedUntil = ref<Record<Platform, number>>(platformRecord(() => 0));
  const pollObservations = ref<Record<Platform, NotificationPollObservation>>(
    platformRecord(() => ({
      last_attempt_at: null,
      last_success_at: null,
      outcome: "idle",
      successful_categories: [],
      failed_categories: [],
      rate_limited_categories: [],
      consecutive_degraded_polls: 0,
      rate_limited_polls: 0,
    })),
  );
  let pollSequence = 0;

  const enabledPlatforms = computed(() =>
    PLATFORMS.filter((platform) => preferences.value.platforms[platform]),
  );
  const retryCountdown = computed<Record<Platform, number>>(() => ({
    github: Math.max(0, Math.ceil((rateLimitedUntil.value.github - clock.value) / 1000)),
    gitlab: Math.max(0, Math.ceil((rateLimitedUntil.value.gitlab - clock.value) / 1000)),
    gitee: Math.max(0, Math.ceil((rateLimitedUntil.value.gitee - clock.value) / 1000)),
  }));
  const managerError = computed(() =>
    Object.values(managerErrors.value)
      .filter((message): message is string => Boolean(message))
      .join("；"),
  );
  const permissionError = computed(() => managerErrors.value.permission ?? "");
  const notificationError = computed(() => {
    const platformLabels: Record<Platform, string> = {
      github: "GitHub",
      gitlab: "GitLab",
      gitee: "Gitee",
    };
    const messages = PLATFORMS.filter(
      (platform) => preferences.value.platforms[platform] && errors.value[platform],
    ).map((platform) => `${platformLabels[platform]}：${errors.value[platform]}`);
    if (managerError.value) messages.unshift(managerError.value);
    return messages.join("；");
  });
  const showNotificationError = computed(
    () =>
      Boolean(notificationError.value) &&
      (preferences.value.enabled || Boolean(managerErrors.value.permission)),
  );

  function setEnabled(enabled: boolean): void {
    preferences.value.enabled = enabled;
    if (!enabled) {
      pollSequence += 1;
      polling.value = false;
    }
  }

  function setPlatformEnabled(platform: Platform, enabled: boolean): void {
    preferences.value.platforms[platform] = enabled;
  }

  function setEventEnabled(event: NotificationEventType, enabled: boolean): void {
    preferences.value.events[event] = enabled;
  }

  function setHidePrivateContent(enabled: boolean): void {
    preferences.value.hide_private_content = enabled;
  }

  function setManagerError(source: NotificationManagerErrorSource, message: string): void {
    managerErrors.value[source] = message;
  }

  function clearManagerError(source: NotificationManagerErrorSource): void {
    managerErrors.value[source] = null;
  }

  function updateClock(now = Date.now()): void {
    clock.value = now;
  }

  function persistSnapshots(now: number): void {
    const entries = Object.entries(snapshotsWithinTtl(snapshots.value, now))
      .sort(([, left], [, right]) => {
        const leftTouchedAt = Number.isFinite(left.touched_at) ? left.touched_at : 0;
        const rightTouchedAt = Number.isFinite(right.touched_at) ? right.touched_at : 0;
        return rightTouchedAt - leftTouchedAt;
      })
      .slice(0, MAX_SNAPSHOTS);
    if (entries.length !== Object.keys(snapshots.value).length) {
      snapshots.value = Object.fromEntries(entries);
    }
    writeStorage(SNAPSHOTS_KEY, snapshots.value);
  }

  function createEvents(
    item: ReviewInboxItem,
    previous: NotificationSnapshot | undefined,
    categories: ReviewInboxCategory[],
    reviewBaselineReady: boolean,
  ): InboxNotificationEvent[] {
    const result: InboxNotificationEvent[] = [];
    const add = (type: NotificationEventType) => {
      if (!preferences.value.events[type]) return;
      result.push({
        type,
        platform: item.platform,
        owner: item.owner,
        repo: item.repo,
        repository_full_name: item.repository_full_name,
        number: item.summary.number,
        title: item.summary.title,
      });
    };

    if (
      reviewBaselineReady &&
      categories.includes("review_requested") &&
      !previous?.categories?.includes("review_requested")
    ) {
      add("review_request");
    }
    if (!previous) return result;
    if (previous.head_sha && item.head_sha && previous.head_sha !== item.head_sha)
      add("new_commits");
    if (
      previous.comments_count != null &&
      item.comments_count != null &&
      item.comments_count > previous.comments_count
    ) {
      add("new_comments");
    }
    if (
      previous.checks_status === "pending" &&
      (item.status.checks_status === "ready" || item.status.checks_status === "blocked")
    ) {
      add("checks_completed");
    }
    if (previous.status !== "ready" && item.status.status === "ready") add("mergeable");
    return result;
  }

  async function pollPlatform(platform: Platform, now: number, sequence: number) {
    const results = await Promise.allSettled(
      CATEGORIES.map((category) => reviewInboxList(platform, category, 1, 100)),
    );
    if (sequence !== pollSequence) return [];

    const successfulCategories = new Map<ReviewInboxCategory, ReviewInboxItem[]>();
    const failedCategories: ReviewInboxCategory[] = [];
    const rateLimitedCategories: ReviewInboxCategory[] = [];
    let firstError: unknown = null;
    results.forEach((result, index) => {
      const category = CATEGORIES[index];
      if (result.status === "fulfilled") successfulCategories.set(category, result.value.items);
      else {
        firstError ??= result.reason;
        failedCategories.push(category);
        if (isRateLimitError(result.reason)) rateLimitedCategories.push(category);
      }
    });
    const previousObservation = pollObservations.value[platform];
    const successfulCategoryNames = Array.from(successfulCategories.keys());
    const hasRateLimit = rateLimitedCategories.length > 0;
    const hasFailures = failedCategories.length > 0;
    pollObservations.value[platform] = {
      last_attempt_at: now,
      last_success_at: successfulCategories.size > 0 ? now : previousObservation.last_success_at,
      outcome:
        successfulCategories.size === 0
          ? hasRateLimit
            ? "rate_limited"
            : "failed"
          : hasFailures
            ? "partial"
            : "success",
      successful_categories: successfulCategoryNames,
      failed_categories: failedCategories,
      rate_limited_categories: rateLimitedCategories,
      consecutive_degraded_polls: hasFailures
        ? previousObservation.consecutive_degraded_polls + 1
        : 0,
      rate_limited_polls: previousObservation.rate_limited_polls + (hasRateLimit ? 1 : 0),
    };
    if (successfulCategories.size === 0) {
      errors.value[platform] = String(firstError ?? "通知轮询失败");
      if (hasRateLimit) rateLimitedUntil.value[platform] = now + RATE_LIMIT_BACKOFF_MS;
      else rateLimitedUntil.value[platform] = 0;
      return [];
    }

    errors.value[platform] = firstError ? String(firstError) : null;
    // A successful category still provides useful notification data. Platform-wide backoff is
    // reserved for complete 429 failures so one limited category cannot suppress the others.
    rateLimitedUntil.value[platform] = 0;

    const merged = new Map<string, { item: ReviewInboxItem; categories: ReviewInboxCategory[] }>();
    for (const [category, items] of successfulCategories) {
      for (const item of items) {
        const key = snapshotKey(item);
        const existing = merged.get(key);
        if (existing) existing.categories.push(category);
        else merged.set(key, { item, categories: [category] });
      }
    }

    const events: InboxNotificationEvent[] = [];
    for (const [key, current] of merged) {
      const previous = snapshots.value[key];
      const categories = Array.from(
        new Set([
          ...current.categories,
          ...(previous?.categories?.filter((category) => !successfulCategories.has(category)) ??
            []),
        ]),
      );
      events.push(
        ...createEvents(
          current.item,
          previous,
          categories,
          baselines.value[platform].review_requested,
        ),
      );
      snapshots.value[key] = itemSnapshot(current.item, categories, now);
    }

    for (const category of successfulCategories.keys()) {
      baselines.value[platform][category] = true;
    }
    return events;
  }

  async function poll(platforms: Platform[], now = Date.now()): Promise<InboxNotificationEvent[]> {
    clock.value = now;
    if (!preferences.value.enabled || polling.value) return [];
    const requested = PLATFORMS.filter(
      (platform) =>
        platforms.includes(platform) &&
        preferences.value.platforms[platform] &&
        rateLimitedUntil.value[platform] <= now,
    );
    if (requested.length === 0) return [];

    // Expired snapshots must not act as a baseline when an old PR reappears.
    snapshots.value = snapshotsWithinTtl(snapshots.value, now);

    const sequence = ++pollSequence;
    polling.value = true;
    try {
      const events = (
        await Promise.all(requested.map((platform) => pollPlatform(platform, now, sequence)))
      ).flat();
      if (sequence !== pollSequence) return [];
      persistSnapshots(now);
      writeStorage(BASELINES_KEY, baselines.value);
      return events;
    } finally {
      if (sequence === pollSequence) polling.value = false;
    }
  }

  watch(preferences, (value) => writeStorage(PREFERENCES_KEY, value), { deep: true });

  return {
    preferences,
    polling,
    managerError,
    permissionError,
    notificationError,
    showNotificationError,
    retryCountdown,
    errors,
    rateLimitedUntil,
    pollObservations,
    enabledPlatforms,
    setEnabled,
    setPlatformEnabled,
    setEventEnabled,
    setHidePrivateContent,
    setManagerError,
    clearManagerError,
    updateClock,
    poll,
  };
});
