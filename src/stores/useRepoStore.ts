import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { Platform, RepoSummary, Paginated } from "@/types";
import { repoList } from "@/api";
import { useAuthStore } from "./useAuthStore";
import { useAsyncList } from "@/composables/useAsyncList";

export interface ForkContext {
  upstreamFullName: string | null;
  upstreamOwner: string | null;
  forkOwner: string;
  forkRepo: string;
}

type RepoSelection = { owner: string; repo: string };

const STARRED_REPOS_STORAGE_KEY = "mergebeacon:starred-repos:v1";
const MAX_STARRED_REPOS_PER_PLATFORM = 500;

const platformRecord = <T>(factory: () => T): Record<Platform, T> => ({
  github: factory(),
  gitlab: factory(),
  gitee: factory(),
});

function loadStarredRepos(): Record<Platform, string[]> {
  const result = platformRecord<string[]>(() => []);
  try {
    const stored = localStorage.getItem(STARRED_REPOS_STORAGE_KEY);
    if (!stored) return result;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return result;
    for (const platform of Object.keys(result) as Platform[]) {
      const values = (parsed as Record<string, unknown>)[platform];
      if (!Array.isArray(values)) continue;
      result[platform] = [
        ...new Set(
          values.filter(
            (value): value is string =>
              typeof value === "string" && value.includes("/") && value.length <= 512,
          ),
        ),
      ].slice(0, MAX_STARRED_REPOS_PER_PLATFORM);
    }
  } catch {
    // Local persistence is best effort; starred repositories still work for this session.
  }
  return result;
}

function persistStarredRepos(value: Record<Platform, string[]>): void {
  try {
    localStorage.setItem(STARRED_REPOS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Keep in-memory stars available when storage is disabled by the WebView.
  }
}

export const useRepoStore = defineStore("repo", () => {
  const reposCache = ref<Record<Platform, RepoSummary[]>>(platformRecord(() => []));
  const starredReposByPlatform = ref<Record<Platform, string[]>>(loadStarredRepos());
  const activeRepos = ref<Record<Platform, RepoSelection | null>>(platformRecord(() => null));
  const forkContexts = ref<Record<Platform, ForkContext | null>>(platformRecord(() => null));
  const lists = platformRecord(() => useAsyncList());
  const loadingMoreByPlatform = ref<Record<Platform, boolean>>(platformRecord(() => false));
  const pendingFetches: Record<Platform, { sequence: number; promise: Promise<void> } | null> =
    platformRecord(() => null);

  // 分页状态按平台独立维护；对外保留 Record 视图，组件与测试不感知内部状态机。
  const pages = computed<Record<Platform, number>>(() => ({
    github: lists.github.page.value,
    gitlab: lists.gitlab.page.value,
    gitee: lists.gitee.page.value,
  }));
  const totalPagesByPlatform = computed<Record<Platform, number>>(() => ({
    github: lists.github.totalPages.value,
    gitlab: lists.gitlab.totalPages.value,
    gitee: lists.gitee.totalPages.value,
  }));
  const loadingByPlatform = computed<Record<Platform, boolean>>(() => ({
    github: lists.github.loading.value,
    gitlab: lists.gitlab.loading.value,
    gitee: lists.gitee.loading.value,
  }));
  const errors = computed<Record<Platform, string | null>>(() => ({
    github: lists.github.error.value,
    gitlab: lists.gitlab.error.value,
    gitee: lists.gitee.error.value,
  }));
  const failedPages = computed<Record<Platform, number | null>>(() => ({
    github: lists.github.failedPage.value,
    gitlab: lists.gitlab.failedPage.value,
    gitee: lists.gitee.failedPage.value,
  }));

  const activePlatform = computed(() => useAuthStore().activePlatform);
  const repos = computed(() => reposCache.value[activePlatform.value] ?? []);
  const loading = computed(() => loadingByPlatform.value[activePlatform.value]);
  const loadingMore = computed(() => loadingMoreByPlatform.value[activePlatform.value]);
  const page = computed(() => pages.value[activePlatform.value]);
  const totalPages = computed(() => totalPagesByPlatform.value[activePlatform.value]);
  const hasMore = computed(() => page.value < totalPages.value);
  const error = computed(() => errors.value[activePlatform.value]);
  const activeRepo = computed<RepoSelection | null>({
    get: () => activeRepos.value[activePlatform.value],
    set: (value) => {
      activeRepos.value[activePlatform.value] = value;
    },
  });
  const forkContext = computed<ForkContext | null>({
    get: () => forkContexts.value[activePlatform.value],
    set: (value) => {
      forkContexts.value[activePlatform.value] = value;
    },
  });

  const activeFullName = computed(() => {
    if (!activeRepo.value) return null;
    return `${activeRepo.value.owner}/${activeRepo.value.repo}`;
  });
  const viewingUpstream = computed(() => {
    if (!forkContext.value || !activeRepo.value || !forkContext.value.upstreamOwner) return false;
    return activeRepo.value.owner === forkContext.value.upstreamOwner;
  });
  const hasUpstreamInfo = computed(() => {
    return !!(forkContext.value?.upstreamFullName && forkContext.value?.upstreamOwner);
  });

  function dedupeRepos(items: RepoSummary[]): RepoSummary[] {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${String(item.id)}\u0000${item.full_name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function fetchRepos(platform: Platform, requestedPage: number = 1): Promise<void> {
    const list = lists[platform];
    const sequence = list.begin(requestedPage === 1);
    loadingMoreByPlatform.value[platform] = requestedPage > 1;
    const promise = (async () => {
      try {
        const result: Paginated<RepoSummary> = await repoList(platform, requestedPage);
        if (!list.succeed(sequence, result.page, result.total_pages)) return;
        reposCache.value[platform] =
          requestedPage === 1
            ? dedupeRepos(result.items)
            : dedupeRepos([...reposCache.value[platform], ...result.items]);
      } catch (cause) {
        list.fail(sequence, requestedPage, typeof cause === "string" ? cause : String(cause));
      } finally {
        list.finish(sequence);
        loadingMoreByPlatform.value[platform] = false;
        if (pendingFetches[platform]?.sequence === sequence) {
          pendingFetches[platform] = null;
        }
      }
    })();
    pendingFetches[platform] = { sequence, promise };
    return promise;
  }

  function ensureRepos(platform: Platform): Promise<void> {
    if (reposCache.value[platform].length > 0) return Promise.resolve();
    return pendingFetches[platform]?.promise ?? fetchRepos(platform);
  }

  function refreshRepos(platform: Platform) {
    return fetchRepos(platform, 1);
  }

  function loadMore(platform: Platform = activePlatform.value) {
    if (loadingByPlatform.value[platform] || loadingMoreByPlatform.value[platform]) return;
    if (pages.value[platform] >= totalPagesByPlatform.value[platform]) return;
    return fetchRepos(platform, pages.value[platform] + 1);
  }

  function retry(platform: Platform = activePlatform.value) {
    return fetchRepos(platform, failedPages.value[platform] ?? Math.max(pages.value[platform], 1));
  }

  function isRepoStarred(fullName: string, platform: Platform = activePlatform.value): boolean {
    return starredReposByPlatform.value[platform].includes(fullName);
  }

  function toggleRepoStar(fullName: string, platform: Platform = activePlatform.value): void {
    const current = starredReposByPlatform.value[platform];
    starredReposByPlatform.value[platform] = current.includes(fullName)
      ? current.filter((item) => item !== fullName)
      : [...current, fullName].slice(-MAX_STARRED_REPOS_PER_PLATFORM);
    persistStarredRepos(starredReposByPlatform.value);
  }

  function setActiveRepo(owner: string, repo: string, platform: Platform = activePlatform.value) {
    activeRepos.value[platform] = { owner, repo };
  }
  function setForkContext(ctx: ForkContext | null, platform: Platform = activePlatform.value) {
    forkContexts.value[platform] = ctx;
  }
  function switchForkView(platform: Platform = activePlatform.value) {
    const context = forkContexts.value[platform];
    const active = activeRepos.value[platform];
    if (!context) return;
    if (active && context.upstreamOwner && active.owner === context.upstreamOwner) {
      activeRepos.value[platform] = { owner: context.forkOwner, repo: context.forkRepo };
    } else if (context.upstreamFullName && context.upstreamOwner) {
      activeRepos.value[platform] = {
        owner: context.upstreamOwner,
        repo: context.upstreamFullName.split("/").slice(1).join("/"),
      };
    }
  }

  return {
    repos,
    reposCache,
    starredReposByPlatform,
    activeRepos,
    activeRepo,
    activeFullName,
    forkContexts,
    forkContext,
    viewingUpstream,
    hasUpstreamInfo,
    loading,
    loadingMore,
    loadingByPlatform,
    loadingMoreByPlatform,
    page,
    pages,
    totalPages,
    totalPagesByPlatform,
    hasMore,
    error,
    errors,
    fetchRepos,
    ensureRepos,
    refreshRepos,
    loadMore,
    retry,
    isRepoStarred,
    toggleRepoStar,
    setActiveRepo,
    setForkContext,
    switchForkView,
  };
});
