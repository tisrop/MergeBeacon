<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/useAuthStore";
import { useRepoStore } from "@/stores/useRepoStore";
import { usePrStore } from "@/stores/usePrStore";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";
import type { Platform, RepoSummary } from "@/types";
import BrandMark from "@/components/shared/BrandMark.vue";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    isDiffFocusMode?: boolean;
    compactSidebar?: boolean;
  }>(),
  {
    isDiffFocusMode: false,
    compactSidebar: false,
  },
);

interface OwnerGroup {
  platform: Platform;
  owner: string;
  isOrganization: boolean;
  isStarredGroup: boolean;
  repos: RepoSummary[];
}

const repoSearch = ref("");
const normalizedRepoSearch = computed(() => repoSearch.value.trim().toLocaleLowerCase());

const repoGroups = computed(() => {
  const platform = auth.activePlatform;
  const groups = new Map<string, OwnerGroup>();
  const starredRepos: RepoSummary[] = [];
  for (const r of repo.repos) {
    const searchableText = [r.name, r.full_name, r.owner, r.owner_display_name]
      .join("\n")
      .toLocaleLowerCase();
    if (normalizedRepoSearch.value && !searchableText.includes(normalizedRepoSearch.value)) {
      continue;
    }
    if (repo.isRepoStarred(r.full_name, platform)) {
      starredRepos.push(r);
      continue;
    }
    const key = r.owner;
    if (!groups.has(key)) {
      groups.set(key, {
        platform,
        owner: r.owner_display_name || r.owner,
        isOrganization:
          r.owner_type === "organization" ||
          r.owner_type === "group" ||
          r.owner_type === "enterprise",
        isStarredGroup: false,
        repos: [],
      });
    }
    groups.get(key)!.repos.push(r);
  }
  // Sort: organizations first, then personal, alphabetically within each
  const sorted = Array.from(groups.values());
  sorted.sort((a, b) => {
    if (a.isOrganization !== b.isOrganization) return a.isOrganization ? -1 : 1;
    return a.owner.localeCompare(b.owner);
  });
  return starredRepos.length > 0
    ? [
        {
          platform,
          owner: t("layout.starred"),
          isOrganization: false,
          isStarredGroup: true,
          repos: starredRepos,
        },
        ...sorted,
      ]
    : sorted;
});

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const repo = useRepoStore();
const pr = usePrStore();
const uiSettings = useUiSettingsStore();

const platforms: { value: Platform; label: string }[] = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "gitee", label: "Gitee" },
];

const visiblePlatforms = computed(() => platforms.filter((p) => auth.platformVisibility[p.value]));
const activePlatformLabel = computed(
  () => platforms.find((item) => item.value === auth.activePlatform)?.label ?? auth.activePlatform,
);
const pullRequestNavigationLabel = computed(() =>
  auth.activePlatform === "gitlab" ? t("layout.mergeRequests") : t("layout.pullRequests"),
);
const activePlatformShortLabel = computed(() => {
  const labels: Record<Platform, string> = { github: "GH", gitlab: "GL", gitee: "GE" };
  return labels[auth.activePlatform];
});
const isSidebarCollapsed = computed(
  () => props.compactSidebar || (props.isDiffFocusMode && !uiSettings.isDiffSidebarExpanded),
);
const compactRepoFullName = computed(() => {
  if (repo.activeFullName) return repo.activeFullName;
  const routeOwner = route.params.owner;
  const routeRepo = route.params.repo;
  if (
    route.name !== "pr-detail" ||
    typeof routeOwner !== "string" ||
    typeof routeRepo !== "string"
  ) {
    return null;
  }
  return `${routeOwner}/${routeRepo}`;
});
const compactRepoName = computed(() => compactRepoFullName.value?.split("/").at(-1) ?? null);

watch(
  () => auth.activePlatform,
  () => {
    repoSearch.value = "";
  },
);

onMounted(async () => {
  const activePlatform = auth.activePlatform;
  if (!auth.platforms[activePlatform].isLoggedIn) {
    await auth.checkAuth(activePlatform);
  }
  if (auth.platforms[activePlatform].isLoggedIn && repo.reposCache[activePlatform].length === 0) {
    void repo.fetchRepos(activePlatform);
  }

  for (const item of platforms) {
    if (item.value !== activePlatform && !auth.platforms[item.value].isLoggedIn) {
      void auth.checkAuth(item.value);
    }
  }
});

function toggleDiffSidebar() {
  uiSettings.setDiffSidebarExpanded(!uiSettings.isDiffSidebarExpanded);
}

function selectPlatform(p: Platform) {
  if (p === auth.activePlatform) return;
  auth.setActivePlatform(p);
  pr.clearContext();
  if (route.name === "pr-detail") {
    void router.push({ name: "pr-list" });
  } else if (route.name === "pr-new") {
    void router.push({ name: "pr-new", params: { platform: p } });
  }
  if (auth.platforms[p].isLoggedIn && repo.reposCache[p].length === 0) {
    void repo.fetchRepos(p);
  }
}

function selectRepo(r: { owner: string; repo: string }, platform: Platform) {
  auth.setActivePlatform(platform);
  repo.setActiveRepo(r.owner, r.repo, platform);
  pr.clearContext();
  router.push({ path: "/pr", query: { _t: Date.now().toString() } });
}

function isActive(nav: string) {
  return String(route.name).startsWith(nav);
}

function getRepoOwner(fullName: string): { owner: string; repo: string } {
  const parts = fullName.split("/");
  return { owner: parts[0], repo: parts.slice(1).join("/") };
}

function effectiveRepo(r: RepoSummary): { owner: string; repo: string } {
  if (r.fork && r.parent_full_name && r.parent_owner) {
    return { owner: r.parent_owner, repo: r.parent_full_name.split("/").slice(1).join("/") };
  }
  return getRepoOwner(r.full_name);
}

function selectForkRepo(r: RepoSummary, useUpstream: boolean, platform: Platform) {
  const target = useUpstream ? effectiveRepo(r) : getRepoOwner(r.full_name);
  selectRepo(target, platform);
  const forkInfo = getRepoOwner(r.full_name);
  if (r.fork) {
    repo.setForkContext(
      {
        upstreamFullName: r.parent_full_name ?? null,
        upstreamOwner: r.parent_owner ?? null,
        forkOwner: forkInfo.owner,
        forkRepo: forkInfo.repo,
      },
      platform,
    );
  } else {
    repo.setForkContext(null, platform);
  }
}
</script>

<template>
  <aside
    id="app-sidebar"
    class="sidebar"
    :class="{
      'is-collapsed': isSidebarCollapsed,
      'is-focus-mode': isDiffFocusMode || compactSidebar,
    }"
  >
    <div class="sidebar-header">
      <div class="sidebar-header-row">
        <router-link
          to="/"
          class="logo"
          :aria-label="t('layout.home')"
          :title="isSidebarCollapsed ? t('layout.home') : undefined"
        >
          <span class="logo-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <span class="sidebar-copy">MergeBeacon</span>
        </router-link>
        <button
          v-if="isDiffFocusMode && !isSidebarCollapsed"
          class="sidebar-toggle"
          type="button"
          :title="t('layout.sidebarCollapse')"
          :aria-label="t('layout.sidebarCollapse')"
          aria-controls="app-sidebar"
          :aria-expanded="true"
          @click="toggleDiffSidebar"
        >
          <svg
            width="16"
            height="16"
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
        </button>
      </div>
      <span class="app-caption">PR Review Workspace</span>
    </div>

    <div
      v-if="isSidebarCollapsed"
      class="compact-platform"
      :title="t('layout.currentPlatform', { platform: activePlatformLabel })"
      :aria-label="t('layout.currentPlatform', { platform: activePlatformLabel })"
    >
      <span aria-hidden="true">{{ activePlatformShortLabel }}</span>
    </div>

    <div v-else class="platform-selector">
      <button
        v-for="p in visiblePlatforms"
        :key="p.value"
        :class="{ active: auth.activePlatform === p.value }"
        :aria-pressed="auth.activePlatform === p.value"
        @click="selectPlatform(p.value)"
      >
        {{ p.label }}
      </button>
    </div>

    <!-- Auth status -->
    <div class="auth-status">
      <template v-if="auth.isLoggedIn && auth.activeUser">
        <img :src="auth.activeUser.avatar_url" class="avatar" alt="" />
        <span class="user-copy">
          <span class="user-label">{{ t("layout.currentAccount") }}</span>
          <span class="username">{{ auth.activeUser.login }}</span>
        </span>
      </template>
      <router-link
        v-else
        :to="{ path: '/login', query: { platform: auth.activePlatform } }"
        class="login-link"
      >
        {{ t("layout.login") }}
      </router-link>
    </div>

    <!-- Navigation -->
    <nav class="nav" :aria-label="t('layout.mainNavigation')">
      <router-link
        to="/inbox"
        :class="{ active: isActive('review-inbox') }"
        :aria-label="t('layout.reviewInbox')"
        :title="isSidebarCollapsed ? t('layout.reviewInbox') : undefined"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M4 4h16v16H4z" />
          <path d="m4 8 8 5 8-5" />
        </svg>
        <span class="nav-label">{{ t("layout.reviewInbox") }}</span>
      </router-link>
      <router-link
        to="/pr"
        :class="{ active: route.name === 'pr-list' || route.name === 'pr-detail' }"
        :aria-label="pullRequestNavigationLabel"
        :title="isSidebarCollapsed ? pullRequestNavigationLabel : undefined"
      >
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
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M18 15V9" />
          <path d="M6 9v9" />
          <path d="M13 6h3a2 2 0 0 1 2 2v3" />
        </svg>
        <span class="nav-label">{{ pullRequestNavigationLabel }}</span>
      </router-link>
      <router-link
        to="/issue"
        :class="{ active: isActive('issue') }"
        :aria-label="t('layout.issues')"
        :title="isSidebarCollapsed ? t('layout.issues') : undefined"
      >
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
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span class="nav-label">{{ t("layout.issues") }}</span>
      </router-link>
    </nav>

    <div
      v-if="isSidebarCollapsed && compactRepoName"
      class="compact-repo"
      role="note"
      :title="t('layout.currentRepository', { repository: compactRepoFullName ?? '' })"
      :aria-label="t('layout.currentRepository', { repository: compactRepoFullName ?? '' })"
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
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </svg>
      <span class="compact-repo-name" aria-hidden="true">{{ compactRepoName }}</span>
    </div>

    <!-- Repo list -->
    <div class="repo-section" v-if="auth.isLoggedIn">
      <div class="repo-header">
        <h4>{{ t("layout.repositories") }}</h4>
        <button
          class="refresh-btn"
          :title="t('layout.repositoryRefresh')"
          :aria-label="t('layout.repositoryRefresh')"
          :disabled="repo.loading"
          @click="repo.refreshRepos(auth.activePlatform)"
        >
          <svg
            :class="{ spinning: repo.loading }"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
        </button>
      </div>
      <input
        v-if="repo.repos.length > 0"
        v-model="repoSearch"
        class="repo-search"
        type="search"
        :placeholder="t('layout.repositorySearch')"
        :aria-label="t('layout.repositorySearch')"
        autocomplete="off"
        spellcheck="false"
      />
      <div v-if="repo.loading && repo.repos.length === 0" class="repo-list">
        <div class="loading-hint">{{ t("common.loading") }}</div>
      </div>
      <div v-else class="repo-list">
        <div v-if="normalizedRepoSearch && repoGroups.length === 0" class="repo-search-empty">
          {{ t("layout.repositoryNoMatch") }}
        </div>
        <template
          v-for="group in repoGroups"
          :key="group.isStarredGroup ? '__starred__' : group.owner"
        >
          <div class="repo-group-header">
            <svg
              v-if="group.isStarredGroup"
              class="starred-group-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polygon
                points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              />
            </svg>
            <svg
              v-else-if="group.isOrganization"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="2" y="8" width="6" height="14" rx="1" />
              <rect x="16" y="8" width="6" height="14" rx="1" />
              <path d="M8 15h8" />
              <path d="M12 22V8" />
              <circle cx="12" cy="4" r="2" />
            </svg>
            <svg
              v-else
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>{{ group.owner }}</span>
          </div>
          <div
            v-for="r in group.repos"
            :key="r.id"
            class="repo-item-row"
            :class="{
              active:
                repo.activeFullName === r.full_name ||
                (repo.activeFullName !== null && repo.activeFullName === r.parent_full_name),
            }"
          >
            <button
              type="button"
              class="repo-main-button"
              :class="{ 'is-fork': r.fork }"
              :title="
                r.fork && r.parent_full_name ? 'Fork from ' + r.parent_full_name : r.full_name
              "
              :aria-label="t('layout.repositoryOpen', { repository: r.full_name })"
              @click="
                r.fork
                  ? selectForkRepo(r, true, group.platform)
                  : (selectRepo(getRepoOwner(r.full_name), group.platform),
                    repo.setForkContext(null, group.platform))
              "
            >
              <svg
                v-if="r.fork"
                class="fork-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
              </svg>
              <span class="repo-item-name">{{ r.name }}</span>
            </button>
            <button
              type="button"
              class="repo-star-button"
              :class="{ active: repo.isRepoStarred(r.full_name, group.platform) }"
              :aria-label="
                repo.isRepoStarred(r.full_name, group.platform)
                  ? t('layout.unstar', { repository: r.full_name })
                  : t('layout.star', { repository: r.full_name })
              "
              :aria-pressed="repo.isRepoStarred(r.full_name, group.platform)"
              :title="
                repo.isRepoStarred(r.full_name, group.platform)
                  ? t('layout.unstarAction')
                  : t('layout.starAdd')
              "
              @click="repo.toggleRepoStar(r.full_name, group.platform)"
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
                aria-hidden="true"
              >
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                />
              </svg>
            </button>
          </div>
        </template>
      </div>
      <div v-if="repo.error" class="repo-load-error">
        <span>{{ t("layout.repositoryLoadFailed", { message: repo.error }) }}</span>
        <button @click="repo.retry(auth.activePlatform)">{{ t("common.retry") }}</button>
      </div>
      <button
        v-else-if="repo.hasMore && !repo.loading"
        class="load-more-btn"
        :disabled="repo.loadingMore"
        @click="repo.loadMore(auth.activePlatform)"
      >
        {{ repo.loadingMore ? t("common.loading") : t("layout.repositoryLoadMore") }}
      </button>
    </div>

    <div v-if="isSidebarCollapsed && !compactSidebar" class="sidebar-footer">
      <button
        class="sidebar-toggle"
        type="button"
        :title="t('layout.sidebarExpand')"
        :aria-label="t('layout.sidebarExpand')"
        aria-controls="app-sidebar"
        :aria-expanded="false"
        @click="toggleDiffSidebar"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  </aside>
</template>

<style scoped src="./Sidebar.css"></style>
