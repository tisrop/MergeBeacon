<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePrStore } from "@/stores/usePrStore";
import { useRepoStore } from "@/stores/useRepoStore";
import { useReviewInboxStore } from "@/stores/useReviewInboxStore";
import { dispatchAppCommand } from "@/types/commands";
import type { Platform, RepoSummary, ReviewInboxItem } from "@/types";
import { useI18n } from "@/i18n";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{
  "open-change": [open: boolean];
}>();

interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  hint: string;
  keywords: string;
  run: () => void | Promise<void>;
}

const platformLabels: Record<Platform, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitee: "Gitee",
};
const platforms: Platform[] = ["github", "gitlab", "gitee"];

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const pr = usePrStore();
const repo = useRepoStore();
const inbox = useReviewInboxStore();
const { t } = useI18n();

const open = ref(false);
const query = ref("");
const selectedIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;

function repositoryTarget(repository: RepoSummary): { owner: string; repo: string } {
  const fullName =
    repository.fork && repository.parent_full_name
      ? repository.parent_full_name
      : repository.full_name;
  const [owner, ...parts] = fullName.split("/");
  return { owner, repo: parts.join("/") };
}

function selectPlatform(platform: Platform): void {
  auth.setActivePlatform(platform);
  pr.clearContext();
  if (!auth.platforms[platform].isLoggedIn) {
    void router.push({ name: "login", query: { platform } });
    return;
  }
  if (repo.reposCache[platform].length === 0) void repo.fetchRepos(platform);
  void router.push({ name: "pr-list" });
}

function selectRepository(platform: Platform, repository: RepoSummary): void {
  auth.setActivePlatform(platform);
  const target = repositoryTarget(repository);
  repo.setActiveRepo(target.owner, target.repo, platform);
  if (repository.fork) {
    const [forkOwner, ...forkRepoParts] = repository.full_name.split("/");
    repo.setForkContext(
      {
        upstreamFullName: repository.parent_full_name,
        upstreamOwner: repository.parent_owner,
        forkOwner,
        forkRepo: forkRepoParts.join("/"),
      },
      platform,
    );
  } else {
    repo.setForkContext(null, platform);
  }
  pr.clearContext();
  void router.push({ name: "pr-list", query: { _t: Date.now().toString() } });
}

function openPullRequest(
  platform: Platform,
  owner: string,
  repository: string,
  number: number,
): void {
  auth.setActivePlatform(platform);
  repo.setActiveRepo(owner, repository, platform);
  repo.setForkContext(null, platform);
  pr.clearContext();
  void router.push({
    name: "pr-detail",
    params: { platform, owner, repo: repository, number },
  });
}

function inboxCommands(): PaletteCommand[] {
  const commands = new Map<string, PaletteCommand>();
  for (const item of platforms.flatMap((platform) => inbox.itemsByPlatform[platform])) {
    const key = `${item.platform}:${item.repository_full_name}:${item.summary.number}`;
    commands.set(key, pullRequestCommand(item));
  }
  const activeRepo = repo.activeRepos[auth.activePlatform];
  if (activeRepo) {
    for (const summary of pr.list) {
      const key = `${auth.activePlatform}:${activeRepo.owner}/${activeRepo.repo}:${summary.number}`;
      if (!commands.has(key)) {
        commands.set(key, {
          id: `pr:${key}`,
          group: "Pull Request",
          label: `#${summary.number} ${summary.title}`,
          hint: `${platformLabels[auth.activePlatform]} · ${activeRepo.owner}/${activeRepo.repo}`,
          keywords: `${summary.author.login} ${summary.labels.join(" ")}`,
          run: () =>
            openPullRequest(auth.activePlatform, activeRepo.owner, activeRepo.repo, summary.number),
        });
      }
    }
  }
  return [...commands.values()];
}

function pullRequestCommand(item: ReviewInboxItem): PaletteCommand {
  return {
    id: `pr:${item.platform}:${item.repository_full_name}:${item.summary.number}`,
    group: "Pull Request",
    label: `#${item.summary.number} ${item.summary.title}`,
    hint: `${platformLabels[item.platform]} · ${item.repository_full_name}`,
    keywords: `${item.summary.author.login} ${item.relationships.join(" ")}`,
    run: () => openPullRequest(item.platform, item.owner, item.repo, item.summary.number),
  };
}

const commands = computed<PaletteCommand[]>(() => {
  const result: PaletteCommand[] = [
    {
      id: "navigate:inbox",
      group: t("command.groupNavigation"),
      label: t("command.openReviewInbox"),
      hint: t("command.openReviewInboxHint"),
      keywords: "inbox 收件箱 review",
      run: () => void router.push({ name: "review-inbox" }),
    },
    {
      id: "navigate:pr",
      group: t("command.groupNavigation"),
      label: t("command.openPr"),
      hint: t("command.openPrHint"),
      keywords: "pr mr pull request merge request",
      run: () => void router.push({ name: "pr-list" }),
    },
    {
      id: "navigate:issue",
      group: t("command.groupNavigation"),
      label: t("command.openIssue"),
      hint: t("command.openIssueHint"),
      keywords: "issue 问题",
      run: () => void router.push({ name: "issue-list" }),
    },
    {
      id: "navigate:settings",
      group: t("command.groupNavigation"),
      label: t("command.openSettings"),
      hint: t("command.openSettingsHint"),
      keywords: "settings preference 设置",
      run: () => void router.push({ name: "settings" }),
    },
  ];

  for (const platform of platforms) {
    result.push({
      id: `platform:${platform}`,
      group: t("command.groupPlatform"),
      label: t("command.switchPlatform", { platform: platformLabels[platform] }),
      hint: auth.platforms[platform].isLoggedIn ? t("command.loggedIn") : t("command.needsLogin"),
      keywords: `${platform} 平台`,
      run: () => selectPlatform(platform),
    });
    for (const repository of repo.reposCache[platform]) {
      result.push({
        id: `repo:${platform}:${repository.id}:${repository.full_name}`,
        group: t("command.groupRepository"),
        label: repository.full_name,
        hint: `${platformLabels[platform]}${repository.private ? ` · ${t("command.privateRepository")}` : ""}`,
        keywords: `${repository.name} ${repository.owner} ${repository.description}`,
        run: () => selectRepository(platform, repository),
      });
    }
  }

  result.push(...inboxCommands());

  if (route.name === "pr-detail") {
    for (const file of pr.diff?.files ?? []) {
      result.push({
        id: `diff:${file.filename}`,
        group: t("command.diffFile"),
        label: file.filename,
        hint: t("command.diffStats", {
          additions: file.additions,
          deletions: file.deletions,
        }),
        keywords: `diff ${file.status}`,
        run: () => dispatchAppCommand({ type: "open_diff_file", path: file.filename }),
      });
    }
    result.push(
      {
        id: "review:start-ai",
        group: t("command.groupReview"),
        label: t("command.startAiReview"),
        hint: t("command.startAiReviewHint"),
        keywords: "ai review 人工智能",
        run: () => dispatchAppCommand({ type: "start_ai_review" }),
      },
      {
        id: "review:prepare-submit",
        group: t("command.groupReview"),
        label: t("command.prepareReview"),
        hint: t("command.prepareReviewHint"),
        keywords: "review submit approve comment",
        run: () => dispatchAppCommand({ type: "prepare_review" }),
      },
    );
  }
  return result;
});

const filteredCommands = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matched =
    terms.length === 0
      ? commands.value
      : commands.value.filter((command) => {
          const searchable =
            `${command.label} ${command.hint} ${command.group} ${command.keywords}`.toLocaleLowerCase();
          return terms.every((term) => searchable.includes(term));
        });
  const direct = query.value.trim().match(/^(.+)\/([^/#\s]+)\s*#(\d+)$/);
  if (!direct) return matched;
  const number = Number(direct[3]);
  if (!Number.isSafeInteger(number) || number <= 0) return matched;
  return [
    {
      id: `direct-pr:${auth.activePlatform}:${direct[1]}/${direct[2]}:${number}`,
      group: t("command.quickOpen"),
      label: t("command.openDirect", { repository: `${direct[1]}/${direct[2]}`, number }),
      hint: platformLabels[auth.activePlatform],
      keywords: "",
      run: () => openPullRequest(auth.activePlatform, direct[1], direct[2], number),
    },
    ...matched,
  ];
});

watch(filteredCommands, () => {
  selectedIndex.value = 0;
});

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closePalette();
  },
);

function openPalette(): void {
  if (props.disabled || open.value) return;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open.value = true;
  emit("open-change", true);
  query.value = "";
  selectedIndex.value = 0;
  for (const platform of platforms) {
    if (auth.platforms[platform].isLoggedIn && repo.reposCache[platform].length === 0) {
      void repo.fetchRepos(platform);
    }
  }
  void nextTick(() => inputRef.value?.focus());
}

function closePalette(): void {
  if (!open.value) return;
  open.value = false;
  void nextTick(() => previousFocus?.focus());
  emit("open-change", false);
}

async function runCommand(command: PaletteCommand | undefined): Promise<void> {
  if (!command) return;
  closePalette();
  await command.run();
}

function moveSelection(offset: number): void {
  const count = filteredCommands.value.length;
  if (count === 0) return;
  selectedIndex.value = (selectedIndex.value + offset + count) % count;
  void nextTick(() => {
    dialogRef.value
      ?.querySelector<HTMLElement>(`[data-command-index="${selectedIndex.value}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });
}

function handleGlobalKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    openPalette();
    return;
  }
  if (event.key === "Escape" && open.value) {
    event.preventDefault();
    closePalette();
  }
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    void runCommand(filteredCommands.value[selectedIndex.value]);
  } else if (event.key === "Tab") {
    const focusable = [...(dialogRef.value?.querySelectorAll<HTMLElement>("input, button") ?? [])];
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current - 1 + focusable.length) % focusable.length
      : (current + 1) % focusable.length;
    event.preventDefault();
    focusable[next].focus();
  }
}

onMounted(() => window.addEventListener("keydown", handleGlobalKeydown));
onUnmounted(() => window.removeEventListener("keydown", handleGlobalKeydown));

defineExpose({ open: openPalette, close: closePalette });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="command-palette-backdrop" @mousedown.self="closePalette">
      <section
        ref="dialogRef"
        class="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        @keydown="handleDialogKeydown"
      >
        <h2 id="command-palette-title" class="sr-only">{{ t("command.openPalette") }}</h2>
        <div class="command-search">
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            ref="inputRef"
            v-model="query"
            type="search"
            autocomplete="off"
            :aria-label="t('command.search')"
            :placeholder="t('command.search')"
          />
          <kbd>Esc</kbd>
        </div>
        <div class="command-results" role="listbox" :aria-label="t('command.available')">
          <button
            v-for="(command, index) in filteredCommands"
            :key="command.id"
            type="button"
            class="command-item"
            :class="{ selected: selectedIndex === index }"
            role="option"
            :aria-selected="selectedIndex === index"
            :data-command-index="index"
            @mouseenter="selectedIndex = index"
            @click="runCommand(command)"
          >
            <span class="command-copy">
              <strong>{{ command.label }}</strong>
              <small>{{ command.hint }}</small>
            </span>
            <span class="command-group">{{ command.group }}</span>
          </button>
          <p v-if="filteredCommands.length === 0" class="command-empty">
            {{ t("command.empty") }}
          </p>
        </div>
        <footer class="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ t("command.select") }}</span>
          <span><kbd>↵</kbd> {{ t("command.execute") }}</span>
          <span><kbd>Ctrl/⌘</kbd><kbd>K</kbd> {{ t("command.open") }}</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./CommandPalette.css"></style>
