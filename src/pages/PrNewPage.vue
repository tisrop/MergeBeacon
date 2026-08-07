<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import AppLayout from "@/components/layout/AppLayout.vue";
import DiffViewer from "@/components/diff/DiffViewer.vue";
import AppMultiSelect from "@/components/shared/AppMultiSelect.vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import MarkdownRenderer from "@/components/shared/MarkdownRenderer.vue";
import { MAX_PR_TITLE_CHARS } from "@/constants/pr";
import { currentLocale, useI18n } from "@/i18n";
import {
  aiPrDraft,
  aiPrDraftCancel,
  prBranches,
  prCreate,
  prCreatePreview,
  prDescriptionImageUpload,
  listRepositoryLabels,
  prParticipantSuggestions,
  prTemplates,
} from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";
import { useCapabilityStore } from "@/stores/useCapabilityStore";
import { usePrStore } from "@/stores/usePrStore";
import { useRepoStore } from "@/stores/useRepoStore";
import type {
  Platform,
  PlatformCapabilities,
  PrBranchOptions,
  PrCreatePreview,
  PrLabel,
  PrTemplate,
  User,
} from "@/types";
import { getErrorMessage } from "@/utils/error";
import { persistPrCreateWarnings, PR_CREATE_WARNING_QUERY } from "@/utils/prCreateWarnings";

interface RepositoryRef {
  owner: string;
  repo: string;
  fullName: string;
}

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const repoStore = useRepoStore();
const prStore = usePrStore();
const capabilities = useCapabilityStore();
const { t } = useI18n();

const sourceFullName = ref("");
const targetFullName = ref("");
const repositoriesLoading = ref(false);
const repositoryError = ref("");
const sourceBranch = ref("");
const targetBranch = ref("");
const sourceBranches = ref<string[]>([]);
const targetBranches = ref<string[]>([]);
const branchesLoading = ref(false);
const branchError = ref("");
const preview = ref<PrCreatePreview | null>(null);
const previewLoading = ref(false);
const previewError = ref("");
const previewTab = ref<"commits" | "diff">("commits");
const selectedDiffCommitSha = ref("");
const commitPreview = ref<PrCreatePreview | null>(null);
const commitPreviewLoading = ref(false);
const commitPreviewError = ref("");
const title = ref("");
const body = ref("");
const descriptionMode = ref<"edit" | "preview">("edit");
const descriptionTextarea = ref<HTMLTextAreaElement | null>(null);
const descriptionImageUploading = ref(false);
const descriptionImageError = ref("");
const descriptionImagePreviews = ref<Array<{ markdown: string; previewMarkdown: string }>>([]);
const draft = ref(false);
const reviewers = ref<string[]>([]);
const assignees = ref<string[]>([]);
const availableParticipants = ref<User[]>([]);
const participantsLoading = ref(false);
const participantsError = ref("");
const labels = ref<string[]>([]);
const availableLabels = ref<PrLabel[]>([]);
const labelsLoading = ref(false);
const labelsError = ref("");
const templates = ref<PrTemplate[]>([]);
const selectedTemplatePath = ref("");
const templatesLoading = ref(false);
const templatesError = ref("");
const draftFillMode = ref<"empty" | "overwrite">("empty");
const draftAssistantNotice = ref("");
const aiDraftLoading = ref(false);
const aiDraftError = ref("");
const submitting = ref(false);
const error = ref("");
let branchSequence = 0;
let previewSequence = 0;
let commitPreviewSequence = 0;
let labelsSequence = 0;
let participantsSequence = 0;
let templatesSequence = 0;
let aiDraftSequence = 0;
let activeAiDraftRequestId: string | null = null;
let descriptionImageSequence = 0;
let activeDescriptionImageMarker = "";

// Keep these limits aligned with validate_pr_draft_request and MAX_PR_DRAFT_DIFF_BYTES in Rust.
const AI_DRAFT_REQUEST_DIFF_LIMIT_BYTES = 1_048_576;
const AI_DRAFT_MODEL_DIFF_LIMIT_BYTES = 64 * 1024;
const MAX_DESCRIPTION_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_DESCRIPTION_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
const DESCRIPTION_IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function parsePlatform(value: unknown): Platform | null {
  return value === "github" || value === "gitlab" || value === "gitee" ? value : null;
}

const creationPlatform = computed<Platform>(
  () =>
    parsePlatform(route.params.platform) ??
    parsePlatform(route.query.platform) ??
    auth.activePlatform,
);
const creationActiveRepo = computed(() => repoStore.activeRepos[creationPlatform.value]);
const creationForkContext = computed(() => repoStore.forkContexts[creationPlatform.value]);
const creationViewingUpstream = computed(() => {
  const target = targetRepository.value;
  const fork = creationForkContext.value;
  return Boolean(target && fork?.upstreamFullName === target.fullName);
});
const targetRepository = computed<RepositoryRef | null>(() => {
  return parseRepository(targetFullName.value);
});
const platformCapabilities = computed<PlatformCapabilities | null>(
  () => capabilities.values[creationPlatform.value],
);
const isGitee = computed(() => creationPlatform.value === "gitee");
const requestType = computed(() => (creationPlatform.value === "gitlab" ? "MR" : "PR"));
const createLabel = computed(() => t("prNew.create", { type: requestType.value }));
const participantLabels = computed(() =>
  isGitee.value
    ? { reviewers: t("prNew.giteeReviewers"), assignees: t("prNew.giteeTesters") }
    : { reviewers: t("prNew.reviewers"), assignees: t("prNew.assignees") },
);

function parseRepository(fullName: string): RepositoryRef | null {
  const parts = fullName.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts.slice(1).join("/"), fullName: parts.join("/") };
}

const routeTarget = computed(() =>
  typeof route.query.target === "string" ? parseRepository(route.query.target) : null,
);
const isGlobalCreation = computed(() => !routeTarget.value);
const targetRepositories = computed<RepositoryRef[]>(() => {
  const references: RepositoryRef[] = [];
  const add = (reference: RepositoryRef | null) => {
    if (reference && !references.some((item) => item.fullName === reference.fullName)) {
      references.push(reference);
    }
  };
  add(
    creationActiveRepo.value
      ? {
          ...creationActiveRepo.value,
          fullName: `${creationActiveRepo.value.owner}/${creationActiveRepo.value.repo}`,
        }
      : null,
  );
  for (const item of repoStore.reposCache[creationPlatform.value]) {
    add(parseRepository(item.full_name));
    if (item.fork && item.parent_full_name) {
      add(parseRepository(item.parent_full_name));
    }
  }
  return references;
});
const targetRepositoryOptions = computed(() =>
  targetRepositories.value.map((item) => ({ value: item.fullName, label: item.fullName })),
);
const hasMoreRepositories = computed(() => {
  const platform = creationPlatform.value;
  return repoStore.pages[platform] < repoStore.totalPagesByPlatform[platform];
});
const repositoriesLoadingMore = computed(() => {
  const platform = creationPlatform.value;
  return repositoriesLoading.value || repoStore.loadingMoreByPlatform[platform];
});
const sourceRepositories = computed<RepositoryRef[]>(() => {
  const references: RepositoryRef[] = [];
  const add = (reference: RepositoryRef | null) => {
    if (reference && !references.some((item) => item.fullName === reference.fullName)) {
      references.push(reference);
    }
  };
  const target = targetRepository.value;
  add(target);
  if (target) {
    for (const item of repoStore.reposCache[creationPlatform.value]) {
      const isTarget = item.full_name === target.fullName;
      const isTargetFork = item.fork && item.parent_full_name === target.fullName;
      if (isTarget || isTargetFork) add(parseRepository(item.full_name));
    }
  }
  const fork = creationForkContext.value;
  if (fork && target && fork.upstreamFullName === target.fullName) {
    add({
      owner: fork.forkOwner,
      repo: fork.forkRepo,
      fullName: `${fork.forkOwner}/${fork.forkRepo}`,
    });
  }
  return references;
});
const sourceRepository = computed(() =>
  sourceRepositories.value.find((item) => item.fullName === sourceFullName.value),
);
const sourceRepositoryOptions = computed(() =>
  sourceRepositories.value.map((item) => ({ value: item.fullName, label: item.fullName })),
);
const sourceBranchOptions = computed(() =>
  sourceBranches.value.map((branch) => ({ value: branch, label: branch })),
);
const targetBranchOptions = computed(() =>
  targetBranches.value.map((branch) => ({ value: branch, label: branch })),
);

function labelColor(value: string | null): string | undefined {
  const color = value?.trim();
  if (!color || !/^#?[0-9a-f]{6}$/i.test(color)) return undefined;
  return color.startsWith("#") ? color : `#${color}`;
}

const labelOptions = computed(() =>
  availableLabels.value.map((label) => ({
    value: label.name,
    label: label.name,
    color: labelColor(label.color),
    description: label.description,
  })),
);
const participantOptions = computed(() =>
  availableParticipants.value.map((participant) => ({
    value: participant.login,
    label: participant.login,
    description:
      participant.name && participant.name !== participant.login ? participant.name : null,
    avatarUrl: participant.avatar_url,
  })),
);
const templateOptions = computed(() =>
  templates.value.map((template) => ({
    value: template.source_path,
    label: template.name,
  })),
);
const draftFillModeOptions = computed(() => [
  { value: "empty", label: t("prNew.fillEmpty") },
  { value: "overwrite", label: t("prNew.fillOverwrite") },
]);
const selectedTemplate = computed(() =>
  templates.value.find((template) => template.source_path === selectedTemplatePath.value),
);
const canFillWithAi = computed(
  () =>
    Boolean(preview.value?.commits.length) &&
    Boolean(preview.value?.diff.diff.trim()) &&
    !previewLoading.value &&
    !aiDraftLoading.value,
);
const descriptionPreviewBody = computed(() =>
  descriptionImagePreviews.value.reduce(
    (content, image) => content.split(image.markdown).join(image.previewMarkdown),
    body.value,
  ),
);
const aiDraftDiffLimitNotice = computed(() => {
  const diff = preview.value?.diff.diff ?? "";
  const bytes = new TextEncoder().encode(diff).length;
  if (bytes > AI_DRAFT_REQUEST_DIFF_LIMIT_BYTES) {
    return t("prNew.aiDiffRequestLimit");
  }
  if (bytes > AI_DRAFT_MODEL_DIFF_LIMIT_BYTES) {
    return t("prNew.aiDiffModelLimit");
  }
  return "";
});
const previewAdditions = computed(() =>
  preview.value?.diff.files.reduce((total, file) => total + file.additions, 0),
);
const previewDeletions = computed(() =>
  preview.value?.diff.files.reduce((total, file) => total + file.deletions, 0),
);
const diffCommitOptions = computed(() => [
  {
    value: "",
    label: t("prNew.allCommits", { count: preview.value?.commits.length ?? 0 }),
  },
  ...(preview.value?.commits.map((commit) => ({
    value: commit.sha,
    label: `${shortCommitSha(commit.sha)} · ${commit.title || t("prNew.untitledCommit")}`,
  })) ?? []),
]);
const displayedPreview = computed(() =>
  selectedDiffCommitSha.value ? commitPreview.value : preview.value,
);
const displayedDiff = computed(() => displayedPreview.value?.diff ?? null);
const displayedBaseRevision = computed(() =>
  selectedDiffCommitSha.value ? (commitPreview.value?.base_revision ?? "") : targetBranch.value,
);
const isCommitWithoutBase = computed(() =>
  Boolean(selectedDiffCommitSha.value && commitPreview.value && !commitPreview.value.base_revision),
);
const displayedPreviewIncomplete = computed(() => displayedPreview.value?.incomplete === true);
const displayedPreviewWarning = computed(() => {
  const reasons = displayedPreview.value?.incomplete_reasons ?? [];
  if (reasons.includes("pagination_failed")) {
    return t("prNew.previewPaginationFailed", { type: requestType.value });
  }
  if (reasons.includes("pagination_limit")) {
    return t("prNew.previewPaginationLimit", { type: requestType.value });
  }
  return t("prNew.previewPlatformLimit", { type: requestType.value });
});

function normalizedBranches(options: PrBranchOptions): string[] {
  return Array.from(
    new Set(
      options.default_branch ? [options.default_branch, ...options.branches] : options.branches,
    ),
  );
}

function preferredTargetBranch(options: PrBranchOptions, branches: string[]): string {
  return (
    (options.default_branch && branches.includes(options.default_branch)
      ? options.default_branch
      : null) ??
    branches.find((branch) => branch === "main") ??
    branches.find((branch) => branch === "master") ??
    branches[0] ??
    ""
  );
}

function shortCommitSha(sha: string): string {
  return sha.slice(0, 8);
}

function commitDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(currentLocale());
}

function truncateUtf8Input(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.length <= maxBytes) return value;
  return new TextDecoder().decode(encoded.subarray(0, maxBytes), { stream: true });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function descriptionImageFileName(file: File): string {
  const fallback = `pasted-image-${Date.now()}.${DESCRIPTION_IMAGE_EXTENSIONS[file.type] ?? "png"}`;
  const forbidden = new Set(["/", "\\", "\0", "\n", "\r", '"']);
  const normalized = Array.from(file.name.trim())
    .slice(0, 255)
    .map((character) => (forbidden.has(character) ? "-" : character))
    .join("");
  return normalized || fallback;
}

function removeDescriptionImageMarker(marker: string): void {
  if (marker && body.value.includes(marker)) body.value = body.value.replace(marker, "");
}

function invalidateDescriptionImageUpload(): void {
  descriptionImageSequence += 1;
  descriptionImageUploading.value = false;
  removeDescriptionImageMarker(activeDescriptionImageMarker);
  activeDescriptionImageMarker = "";
  descriptionImagePreviews.value = [];
}

async function handleDescriptionPaste(event: ClipboardEvent): Promise<void> {
  const clipboardItems = Array.from(event.clipboardData?.items ?? []);
  if (clipboardItems.some((item) => item.kind === "string" && item.type === "text/plain")) {
    return;
  }
  const imageItem = clipboardItems.find(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
  if (!imageItem) return;
  event.preventDefault();

  if (descriptionImageUploading.value) {
    descriptionImageError.value = t("prNew.imageUploadBusy");
    return;
  }
  const target = targetRepository.value;
  const file = imageItem.getAsFile();
  if (!target || !file) {
    descriptionImageError.value = t("prNew.imageReadFailed");
    return;
  }
  if (!SUPPORTED_DESCRIPTION_IMAGE_TYPES.has(file.type)) {
    descriptionImageError.value = t("prNew.imageTypeUnsupported");
    return;
  }
  if (file.size <= 0 || file.size > MAX_DESCRIPTION_IMAGE_BYTES) {
    descriptionImageError.value = t("prNew.imageSizeInvalid");
    return;
  }

  const textarea = descriptionTextarea.value;
  const start = textarea?.selectionStart ?? body.value.length;
  const end = textarea?.selectionEnd ?? start;
  const platform = creationPlatform.value;
  const sequence = ++descriptionImageSequence;
  const marker = `<!-- mergebeacon-image-upload:${sequence}-${Date.now()} -->`;
  activeDescriptionImageMarker = marker;
  descriptionImageError.value = "";
  descriptionImageUploading.value = true;
  body.value = `${body.value.slice(0, start)}${marker}${body.value.slice(end)}`;
  await nextTick();
  descriptionTextarea.value?.setSelectionRange(start + marker.length, start + marker.length);

  try {
    let uploadCapabilities = platformCapabilities.value;
    if (!uploadCapabilities) {
      try {
        uploadCapabilities = await capabilities.load(platform);
      } catch {
        if (
          sequence !== descriptionImageSequence ||
          platform !== creationPlatform.value ||
          target.fullName !== targetRepository.value?.fullName
        ) {
          return;
        }
        removeDescriptionImageMarker(marker);
        activeDescriptionImageMarker = "";
        descriptionImageError.value = t("prNew.imageCapabilityFailed");
        return;
      }
    }
    if (
      sequence !== descriptionImageSequence ||
      platform !== creationPlatform.value ||
      target.fullName !== targetRepository.value?.fullName ||
      !body.value.includes(marker)
    ) {
      return;
    }
    if (!uploadCapabilities.supports_pr_description_image_upload) {
      removeDescriptionImageMarker(marker);
      activeDescriptionImageMarker = "";
      descriptionImageError.value = t("prNew.imageUnsupported", { type: requestType.value });
      return;
    }

    const content = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const result = await prDescriptionImageUpload(
      platform,
      target.owner,
      target.repo,
      descriptionImageFileName(file),
      file.type,
      content,
    );
    if (
      sequence !== descriptionImageSequence ||
      platform !== creationPlatform.value ||
      target.fullName !== targetRepository.value?.fullName ||
      !body.value.includes(marker)
    ) {
      return;
    }
    descriptionImagePreviews.value.push({
      markdown: result.markdown,
      previewMarkdown: result.preview_markdown,
    });
    body.value = body.value.replace(marker, result.markdown);
    activeDescriptionImageMarker = "";
  } catch (cause) {
    if (sequence !== descriptionImageSequence) return;
    removeDescriptionImageMarker(marker);
    activeDescriptionImageMarker = "";
    descriptionImageError.value = getErrorMessage(cause, t("prNew.imageUploadFailed"));
  } finally {
    if (sequence === descriptionImageSequence) descriptionImageUploading.value = false;
  }
}

function cancelActiveAiDraft(): void {
  const requestId = activeAiDraftRequestId;
  activeAiDraftRequestId = null;
  if (!requestId) return;
  void aiPrDraftCancel(requestId).catch(() => {
    // Cancellation is best-effort and must not be presented as an AI draft error.
  });
}

function invalidateAiDraft(): void {
  aiDraftSequence += 1;
  aiDraftLoading.value = false;
  cancelActiveAiDraft();
}

function cancelAiDraftByUser(): void {
  invalidateAiDraft();
  aiDraftError.value = "";
  draftAssistantNotice.value = t("prNew.aiCancelled");
}

async function loadPreview(): Promise<void> {
  const target = targetRepository.value;
  const source = sourceRepository.value;
  const platform = creationPlatform.value;
  const nextSourceBranch = sourceBranch.value;
  const nextTargetBranch = targetBranch.value;
  const sequence = ++previewSequence;
  invalidateAiDraft();
  aiDraftError.value = "";
  draftAssistantNotice.value = "";
  commitPreviewSequence += 1;
  preview.value = null;
  selectedDiffCommitSha.value = "";
  commitPreview.value = null;
  commitPreviewLoading.value = false;
  commitPreviewError.value = "";
  previewError.value = "";
  if (
    !target ||
    !source ||
    !nextSourceBranch ||
    !nextTargetBranch ||
    (source.fullName === target.fullName && nextSourceBranch === nextTargetBranch)
  ) {
    previewLoading.value = false;
    return;
  }
  previewLoading.value = true;
  try {
    const result = await prCreatePreview(platform, target.owner, target.repo, {
      source_owner: source.owner,
      source_repo: source.repo,
      source_branch: nextSourceBranch,
      target_branch: nextTargetBranch,
    });
    if (sequence !== previewSequence) return;
    preview.value = result;
  } catch (cause) {
    if (sequence !== previewSequence) return;
    previewError.value = getErrorMessage(
      cause,
      t("prNew.previewLoadFailed", { type: requestType.value }),
    );
  } finally {
    if (sequence === previewSequence) previewLoading.value = false;
  }
}

async function loadTemplates(): Promise<void> {
  const target = targetRepository.value;
  const platform = creationPlatform.value;
  const sequence = ++templatesSequence;
  templatesError.value = "";
  if (!target) {
    templatesLoading.value = false;
    return;
  }
  templatesLoading.value = true;
  try {
    const result = await prTemplates(platform, target.owner, target.repo);
    if (
      sequence !== templatesSequence ||
      platform !== creationPlatform.value ||
      target.fullName !== targetRepository.value?.fullName
    ) {
      return;
    }
    const seen = new Set<string>();
    templates.value = result.flatMap((template) => {
      const path = template.source_path.trim();
      if (!path || seen.has(path)) return [];
      seen.add(path);
      return [
        {
          ...template,
          source_path: path,
          name: template.name.trim() || path.split("/").at(-1) || path,
        },
      ];
    });
    if (!templates.value.some((template) => template.source_path === selectedTemplatePath.value)) {
      selectedTemplatePath.value = "";
    }
  } catch (cause) {
    if (sequence !== templatesSequence) return;
    templatesError.value = getErrorMessage(
      cause,
      t("prNew.templatesLoadFailed", { type: requestType.value }),
    );
  } finally {
    if (sequence === templatesSequence) templatesLoading.value = false;
  }
}

function preservedDraftFieldsNotice(
  source: "template" | "ai",
  preserveTitle: boolean,
  preserveBody: boolean,
): string {
  const fields = [
    preserveTitle ? t("prNew.title") : "",
    preserveBody ? t("prNew.description") : "",
  ].filter(Boolean);
  if (fields.length === 0) return "";
  return t("prNew.fieldsPreserved", {
    source: source === "template" ? t("prNew.templateSource") : "AI",
    fields: fields.join(t("prNew.fieldJoiner")),
  });
}

function applyTemplate(): void {
  const template = selectedTemplate.value;
  if (!template) return;
  const overwrite = draftFillMode.value === "overwrite";
  const preserveTitle = !overwrite && Boolean(template.title.trim()) && Boolean(title.value.trim());
  const preserveBody = !overwrite && Boolean(body.value.trim());
  if (template.title.trim() && !preserveTitle) title.value = template.title;
  if (!preserveBody) {
    body.value = template.body;
    descriptionMode.value = "edit";
  }
  aiDraftError.value = "";
  draftAssistantNotice.value = preservedDraftFieldsNotice("template", preserveTitle, preserveBody);
}

async function fillWithAi(): Promise<void> {
  const currentPreview = preview.value;
  const target = targetRepository.value;
  const source = sourceRepository.value;
  if (!currentPreview || !target || !source || !canFillWithAi.value) return;

  const platform = creationPlatform.value;
  const nextSourceBranch = sourceBranch.value;
  const nextTargetBranch = targetBranch.value;
  const nextTemplatePath = selectedTemplatePath.value;
  const nextFillMode = draftFillMode.value;
  const currentTitle = title.value;
  const currentBody = body.value;
  const preserveTitle = nextFillMode === "empty" && Boolean(currentTitle.trim());
  const preserveBody = nextFillMode === "empty" && Boolean(currentBody.trim());
  aiDraftError.value = "";
  draftAssistantNotice.value = preservedDraftFieldsNotice("ai", preserveTitle, preserveBody);
  if (preserveTitle && preserveBody) return;

  const sequence = ++aiDraftSequence;
  const requestId = crypto.randomUUID();
  activeAiDraftRequestId = requestId;
  aiDraftLoading.value = true;
  try {
    const result = await aiPrDraft(requestId, {
      source_branch: nextSourceBranch,
      target_branch: nextTargetBranch,
      commits: currentPreview.commits.slice(0, 100),
      diff: truncateUtf8Input(currentPreview.diff.diff, AI_DRAFT_REQUEST_DIFF_LIMIT_BYTES),
      template_body: selectedTemplate.value?.body ?? "",
    });
    if (
      !result ||
      sequence !== aiDraftSequence ||
      platform !== creationPlatform.value ||
      target.fullName !== targetRepository.value?.fullName ||
      source.fullName !== sourceRepository.value?.fullName ||
      nextSourceBranch !== sourceBranch.value ||
      nextTargetBranch !== targetBranch.value ||
      nextTemplatePath !== selectedTemplatePath.value ||
      nextFillMode !== draftFillMode.value ||
      currentTitle !== title.value ||
      currentBody !== body.value ||
      currentPreview !== preview.value
    ) {
      return;
    }
    if (!preserveTitle) title.value = result.title;
    if (!preserveBody) {
      body.value = result.body;
      descriptionMode.value = "edit";
    }
    draftAssistantNotice.value = preservedDraftFieldsNotice("ai", preserveTitle, preserveBody);
  } catch (cause) {
    if (sequence !== aiDraftSequence) return;
    aiDraftError.value = getErrorMessage(
      cause,
      t("prNew.aiDraftFailed", { type: requestType.value }),
    );
  } finally {
    if (activeAiDraftRequestId === requestId) activeAiDraftRequestId = null;
    if (sequence === aiDraftSequence) aiDraftLoading.value = false;
  }
}

async function loadCommitPreview(): Promise<void> {
  const target = targetRepository.value;
  const source = sourceRepository.value;
  const platform = creationPlatform.value;
  const commitSha = selectedDiffCommitSha.value;
  const nextSourceBranch = sourceBranch.value;
  const nextTargetBranch = targetBranch.value;
  const sequence = ++commitPreviewSequence;
  commitPreview.value = null;
  commitPreviewError.value = "";
  if (!target || !source || !commitSha || !nextSourceBranch || !nextTargetBranch) {
    commitPreviewLoading.value = false;
    return;
  }
  commitPreviewLoading.value = true;
  try {
    const result = await prCreatePreview(platform, target.owner, target.repo, {
      source_owner: source.owner,
      source_repo: source.repo,
      source_branch: nextSourceBranch,
      target_branch: nextTargetBranch,
      commit_sha: commitSha,
    });
    if (sequence !== commitPreviewSequence) return;
    commitPreview.value = result;
  } catch (cause) {
    if (sequence !== commitPreviewSequence) return;
    commitPreviewError.value = getErrorMessage(cause, t("prNew.commitDiffFailed"));
  } finally {
    if (sequence === commitPreviewSequence) commitPreviewLoading.value = false;
  }
}

async function loadBranches(preserveExisting = false): Promise<void> {
  const target = targetRepository.value;
  const source = sourceRepository.value;
  if (!target || !source) return;
  const platform = creationPlatform.value;
  const sequence = ++branchSequence;
  branchesLoading.value = true;
  branchError.value = "";
  try {
    const targetRequest = prBranches(platform, target.owner, target.repo);
    const sourceRequest =
      source.fullName === target.fullName
        ? targetRequest
        : prBranches(platform, source.owner, source.repo);
    const [targetOptions, sourceOptions] = await Promise.all([targetRequest, sourceRequest]);
    if (sequence !== branchSequence) return;
    targetBranches.value = normalizedBranches(targetOptions);
    sourceBranches.value = normalizedBranches(sourceOptions);
    if (!targetBranches.value.includes(targetBranch.value)) {
      targetBranch.value = preferredTargetBranch(targetOptions, targetBranches.value);
    }
    if (!sourceBranches.value.includes(sourceBranch.value)) {
      sourceBranch.value =
        sourceBranches.value.find(
          (branch) => source.fullName !== target.fullName || branch !== targetBranch.value,
        ) ??
        sourceBranches.value[0] ??
        "";
    }
  } catch (cause) {
    if (sequence !== branchSequence) return;
    if (!preserveExisting) {
      sourceBranches.value = [];
      targetBranches.value = [];
    }
    branchError.value = getErrorMessage(cause, t("prNew.branchesLoadFailed"));
  } finally {
    if (sequence === branchSequence) branchesLoading.value = false;
  }
}

function refreshBranches(): void {
  void loadBranches(true);
}

async function loadLabels(): Promise<void> {
  const target = targetRepository.value;
  const platform = creationPlatform.value;
  const sequence = ++labelsSequence;
  labels.value = [];
  availableLabels.value = [];
  labelsError.value = "";
  if (!target || platformCapabilities.value?.supports_pr_label_management === false) {
    labelsLoading.value = false;
    return;
  }
  labelsLoading.value = true;
  try {
    const result = await listRepositoryLabels(platform, target.owner, target.repo);
    if (sequence !== labelsSequence) return;
    const seen = new Set<string>();
    availableLabels.value = result.filter((label) => {
      const name = label.name.trim();
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      label.name = name;
      return true;
    });
  } catch (cause) {
    if (sequence !== labelsSequence) return;
    labelsError.value = getErrorMessage(cause, t("prNew.labelsLoadFailed"));
  } finally {
    if (sequence === labelsSequence) labelsLoading.value = false;
  }
}

async function loadParticipantSuggestions(): Promise<void> {
  const target = targetRepository.value;
  const platform = creationPlatform.value;
  const sequence = ++participantsSequence;
  reviewers.value = [];
  assignees.value = [];
  availableParticipants.value = [];
  participantsError.value = "";
  if (
    !target ||
    (platformCapabilities.value?.supports_pr_reviewer_management === false &&
      platformCapabilities.value?.supports_pr_assignee_management === false)
  ) {
    participantsLoading.value = false;
    return;
  }
  participantsLoading.value = true;
  try {
    const result = await prParticipantSuggestions(platform, target.owner, target.repo);
    if (sequence !== participantsSequence) return;
    const seen = new Set<string>();
    availableParticipants.value = result.filter((participant) => {
      const login = participant.login.trim();
      const key = login.toLocaleLowerCase();
      if (!login || seen.has(key)) return false;
      seen.add(key);
      participant.login = login;
      return true;
    });
  } catch (cause) {
    if (sequence !== participantsSequence) return;
    participantsError.value = getErrorMessage(cause, t("prNew.participantsLoadFailed"));
  } finally {
    if (sequence === participantsSequence) participantsLoading.value = false;
  }
}

function selectInitialSource(): void {
  const target = targetRepository.value;
  if (!target) {
    sourceFullName.value = "";
    return;
  }
  const fork = creationForkContext.value;
  sourceFullName.value =
    creationViewingUpstream.value && fork ? `${fork.forkOwner}/${fork.forkRepo}` : target.fullName;
}

function selectInitialTarget(): void {
  const preferred = routeTarget.value ?? targetRepositories.value[0] ?? null;
  targetFullName.value = preferred?.fullName ?? "";
}

async function loadInitialRepositories(platform: Platform): Promise<void> {
  repositoriesLoading.value = true;
  repositoryError.value = "";
  try {
    await repoStore.ensureRepos(platform);
    if (platform === creationPlatform.value) {
      repositoryError.value = repoStore.errors[platform] ?? "";
    }
  } finally {
    repositoriesLoading.value = false;
  }
}

async function loadMoreRepositories(): Promise<void> {
  const platform = creationPlatform.value;
  if (!isGlobalCreation.value || repositoriesLoadingMore.value) return;
  repositoryError.value = "";
  await repoStore.loadMore(platform);
  if (platform === creationPlatform.value) {
    repositoryError.value = repoStore.errors[platform] ?? "";
  }
}

const canSubmit = computed(() => {
  const target = targetRepository.value;
  const source = sourceRepository.value;
  if (!target || !source || !platformCapabilities.value?.supports_pr_creation) return false;
  const normalizedTitle = title.value.trim();
  if (
    !normalizedTitle ||
    Array.from(normalizedTitle).length > MAX_PR_TITLE_CHARS ||
    !sourceBranch.value ||
    !targetBranch.value
  )
    return false;
  if (
    branchesLoading.value ||
    previewLoading.value ||
    descriptionImageUploading.value ||
    submitting.value ||
    branchError.value ||
    previewError.value ||
    !preview.value
  )
    return false;
  if (
    !preview.value.incomplete &&
    preview.value.commits.length === 0 &&
    preview.value.diff.files.length === 0
  )
    return false;
  return !(source.fullName === target.fullName && sourceBranch.value === targetBranch.value);
});

async function handleSubmit(): Promise<void> {
  const target = targetRepository.value;
  const source = sourceRepository.value;
  if (!target || !source || !canSubmit.value) return;
  const platform = creationPlatform.value;
  submitting.value = true;
  error.value = "";
  try {
    const outcome = await prCreate(platform, target.owner, target.repo, {
      source_owner: source.owner,
      source_repo: source.repo,
      source_branch: sourceBranch.value,
      target_branch: targetBranch.value,
      title: title.value.trim(),
      body: body.value,
      draft: platformCapabilities.value?.supports_pr_draft_toggle ? draft.value : false,
      reviewers: platformCapabilities.value?.supports_pr_reviewer_management ? reviewers.value : [],
      assignees: platformCapabilities.value?.supports_pr_assignee_management ? assignees.value : [],
      labels: platformCapabilities.value?.supports_pr_label_management ? labels.value : [],
    });
    prStore.invalidateStateCounts(platform, target.owner, target.repo);
    repoStore.setActiveRepo(target.owner, target.repo, platform);
    repoStore.setForkContext(null, platform);
    prStore.clearContext();
    const createWarnings = outcome.failures.map((failure) => failure.message);
    persistPrCreateWarnings(platform, target.owner, target.repo, outcome.number, createWarnings);
    await router.push({
      name: "pr-detail",
      params: {
        platform,
        owner: target.owner,
        repo: target.repo,
        number: outcome.number,
      },
      query: createWarnings.length > 0 ? { [PR_CREATE_WARNING_QUERY]: "1" } : undefined,
    });
  } catch (cause) {
    error.value = getErrorMessage(cause, t("prNew.createFailed", { type: requestType.value }));
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  const platform = creationPlatform.value;
  const capabilitiesRequest = capabilities.load(platform).catch(() => {
    // Capability store exposes the loading error below.
  });
  if (isGlobalCreation.value) await loadInitialRepositories(platform);
  selectInitialTarget();
  const previousSource = sourceFullName.value;
  selectInitialSource();
  if (sourceFullName.value === previousSource) await loadBranches();
  await capabilitiesRequest;
});

watch(sourceFullName, () => {
  sourceBranches.value = [];
  sourceBranch.value = "";
  void loadBranches();
});
watch(
  () => [
    creationPlatform.value,
    targetRepository.value?.fullName,
    sourceRepository.value?.fullName,
    sourceBranch.value,
    targetBranch.value,
  ],
  () => void loadPreview(),
);
watch(selectedDiffCommitSha, () => void loadCommitPreview());
watch(selectedTemplatePath, () => {
  if (aiDraftLoading.value) invalidateAiDraft();
});
watch([title, body], () => {
  if (aiDraftLoading.value) invalidateAiDraft();
  if (activeDescriptionImageMarker && !body.value.includes(activeDescriptionImageMarker)) {
    descriptionImageSequence += 1;
    activeDescriptionImageMarker = "";
    descriptionImageUploading.value = false;
  }
});
watch(draftFillMode, () => {
  draftAssistantNotice.value = "";
  if (aiDraftLoading.value) invalidateAiDraft();
});
watch(
  () => [creationPlatform.value, targetRepository.value?.fullName] as const,
  async () => {
    invalidateDescriptionImageUpload();
    descriptionImageError.value = "";
    const sequence = ++branchSequence;
    templatesSequence += 1;
    selectedTemplatePath.value = "";
    templates.value = [];
    templatesError.value = "";
    void loadTemplates();
    void loadLabels();
    void loadParticipantSuggestions();
    sourceBranches.value = [];
    targetBranches.value = [];
    sourceBranch.value = "";
    targetBranch.value = "";
    branchError.value = "";
    if (!targetRepositories.value.some((item) => item.fullName === targetFullName.value)) {
      selectInitialTarget();
    }
    try {
      await capabilities.load(creationPlatform.value);
    } catch {
      // Capability store exposes the loading error below.
    }
    if (sequence !== branchSequence) return;
    const previousSource = sourceFullName.value;
    selectInitialSource();
    if (sourceFullName.value === previousSource) await loadBranches();
  },
);
onUnmounted(() => {
  branchSequence += 1;
  previewSequence += 1;
  commitPreviewSequence += 1;
  labelsSequence += 1;
  participantsSequence += 1;
  templatesSequence += 1;
  invalidateDescriptionImageUpload();
  invalidateAiDraft();
});
</script>

<template>
  <AppLayout compact-sidebar>
    <template #header>
      <div class="pr-new-header page-heading">
        <div>
          <h2>{{ createLabel }}</h2>
          <p v-if="targetRepository">
            {{ t("prNew.targetRepositoryValue", { repository: targetRepository.fullName }) }}
          </p>
          <p v-else>{{ t("prNew.selectTargetFirst") }}</p>
        </div>
        <RouterLink class="btn btn-sm" to="/pr">{{ t("prNew.back") }}</RouterLink>
      </div>
    </template>

    <form class="pr-create-form" @submit.prevent="handleSubmit">
      <section class="card form-section">
        <div class="section-heading source-section-heading">
          <div>
            <h3>{{ t("prNew.sourceHeading") }}</h3>
            <p>{{ t("prNew.sourceHint") }}</p>
          </div>
          <button
            class="btn btn-sm"
            type="button"
            :disabled="branchesLoading || !sourceRepository || !targetRepository"
            :aria-label="
              branchesLoading ? t('prNew.refreshingBranches') : t('prNew.refreshBranches')
            "
            @click="refreshBranches"
          >
            {{ branchesLoading ? t("prNew.refreshingBranchesShort") : t("prNew.refreshBranches") }}
          </button>
        </div>
        <div v-if="isGlobalCreation" class="target-repository-field field">
          <span>{{ t("prNew.targetRepository") }}</span>
          <AppSelect
            v-model="targetFullName"
            :options="targetRepositoryOptions"
            :placeholder="
              repositoriesLoading
                ? t('common.loadingMore')
                : targetRepositories.length
                  ? t('prNew.selectTargetRepository')
                  : t('prNew.noRepositories')
            "
            searchable
            :search-placeholder="t('prNew.searchTargetRepository')"
            :aria-label="t('prNew.targetRepository')"
            :has-more="hasMoreRepositories"
            :loading-more="repositoriesLoadingMore"
            :load-more-text="
              repositoryError ? t('prNew.retryRepositories') : t('prNew.loadMoreRepositories')
            "
            @load-more="loadMoreRepositories"
          />
          <p v-if="repositoryError" class="error-msg" role="alert">{{ repositoryError }}</p>
        </div>
        <div class="branch-grid">
          <div class="field">
            <span>{{ t("prNew.sourceRepository") }}</span>
            <AppSelect
              v-model="sourceFullName"
              :options="sourceRepositoryOptions"
              searchable
              :search-placeholder="t('prNew.searchRepository')"
              :aria-label="t('prNew.sourceRepository')"
            />
          </div>
          <div class="field">
            <span>{{ t("prNew.sourceBranch") }}</span>
            <AppSelect
              v-model="sourceBranch"
              :options="sourceBranchOptions"
              :placeholder="
                branchesLoading ? t('common.loadingMore') : t('prNew.selectSourceBranch')
              "
              searchable
              :search-placeholder="t('prNew.searchSourceBranch')"
              :aria-label="t('prNew.sourceBranch')"
            />
          </div>
          <div class="branch-arrow" aria-hidden="true">→</div>
          <div class="field">
            <span>{{ t("prNew.targetBranch") }}</span>
            <AppSelect
              v-model="targetBranch"
              :options="targetBranchOptions"
              :placeholder="
                branchesLoading ? t('common.loadingMore') : t('prNew.selectTargetBranch')
              "
              searchable
              :search-placeholder="t('prNew.searchTargetBranch')"
              :aria-label="t('prNew.targetBranch')"
            />
          </div>
        </div>
        <p v-if="branchError" class="error-msg" role="alert">{{ branchError }}</p>
        <p
          v-else-if="
            sourceRepository?.fullName === targetRepository?.fullName &&
            sourceBranch === targetBranch
          "
          class="validation-note"
        >
          {{ t("prNew.sameBranch") }}
        </p>
      </section>

      <section
        v-if="
          sourceBranch &&
          targetBranch &&
          !(
            sourceRepository?.fullName === targetRepository?.fullName &&
            sourceBranch === targetBranch
          )
        "
        class="card form-section preview-section"
      >
        <div class="section-heading preview-heading">
          <div>
            <h3>{{ t("prNew.previewHeading") }}</h3>
            <p>
              {{ sourceRepository?.fullName }}:{{ sourceBranch }} →
              {{ targetRepository?.fullName }}:{{ targetBranch }}
            </p>
          </div>
          <div v-if="preview" class="preview-summary" :aria-label="t('prNew.changeStats')">
            <span>{{ t("prNew.commitCount", { count: preview.commits.length }) }}</span>
            <span>{{ t("prNew.fileCount", { count: preview.diff.files.length }) }}</span>
            <strong class="additions">+{{ previewAdditions }}</strong>
            <strong class="deletions">-{{ previewDeletions }}</strong>
          </div>
        </div>

        <div v-if="displayedPreviewIncomplete" class="preview-warning" role="alert">
          <strong>{{ t("prNew.previewIncomplete") }}</strong>
          <span>{{ displayedPreviewWarning }}</span>
        </div>

        <div class="preview-tabs" role="tablist" :aria-label="t('prNew.createPreview')">
          <button
            type="button"
            role="tab"
            :aria-selected="previewTab === 'commits'"
            :class="{ active: previewTab === 'commits' }"
            @click="previewTab = 'commits'"
          >
            Commit
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="previewTab === 'diff'"
            :class="{ active: previewTab === 'diff' }"
            @click="previewTab = 'diff'"
          >
            Diff
          </button>
        </div>

        <div v-if="previewLoading" class="preview-loading" role="status">
          {{ t("prNew.comparingBranches") }}
        </div>
        <div v-else-if="previewError" class="preview-error" role="alert">
          <span>{{ previewError }}</span>
          <button class="btn btn-sm" type="button" @click="loadPreview">
            {{ t("common.retry") }}
          </button>
        </div>
        <template v-else-if="preview">
          <ol v-if="previewTab === 'commits'" class="commit-list">
            <li v-for="commit in preview.commits" :key="commit.sha" class="commit-row">
              <code>{{ shortCommitSha(commit.sha) }}</code>
              <div>
                <strong>{{ commit.title || t("prNew.untitledCommit") }}</strong>
                <span>
                  {{ commit.author_name || t("common.unknownAuthor") }}
                  <time v-if="commit.authored_at" :datetime="commit.authored_at">
                    {{ commitDate(commit.authored_at) }}
                  </time>
                </span>
              </div>
            </li>
            <li v-if="preview.commits.length === 0" class="preview-empty">
              {{ t("prNew.noCommits") }}
            </li>
          </ol>
          <div v-else class="diff-preview-panel">
            <div class="diff-preview-toolbar">
              <span>{{ t("prNew.diffRange") }}</span>
              <AppSelect
                v-model="selectedDiffCommitSha"
                :options="diffCommitOptions"
                size="sm"
                :aria-label="t('prNew.diffRange')"
              />
            </div>
            <div v-if="commitPreviewLoading" class="preview-loading" role="status">
              {{ t("prNew.loadingCommitDiff") }}
            </div>
            <div v-else-if="commitPreviewError" class="preview-error" role="alert">
              <span>{{ commitPreviewError }}</span>
              <button class="btn btn-sm" type="button" @click="loadCommitPreview">
                {{ t("common.retry") }}
              </button>
            </div>
            <template v-else-if="displayedDiff">
              <p v-if="isCommitWithoutBase" class="preview-scope-note">
                {{ t("prNew.rootCommitNote") }}
              </p>
              <DiffViewer
                :diff="displayedDiff"
                :platform="creationPlatform"
                :base-owner="
                  selectedDiffCommitSha ? sourceRepository?.owner : targetRepository?.owner
                "
                :base-repo="selectedDiffCommitSha ? sourceRepository?.repo : targetRepository?.repo"
                :head-owner="sourceRepository?.owner"
                :head-repo="sourceRepository?.repo"
                :base-sha="displayedBaseRevision"
                :head-sha="selectedDiffCommitSha || sourceBranch"
                read-only
              />
            </template>
          </div>
        </template>
      </section>

      <section class="card form-section">
        <div class="section-heading">
          <div>
            <h3>{{ t("prNew.descriptionHeading") }}</h3>
            <p>{{ t("prNew.descriptionHint") }}</p>
          </div>
        </div>
        <div class="draft-assistant">
          <div class="template-picker field">
            <span>{{ t("prNew.templateLabel", { type: requestType }) }}</span>
            <AppSelect
              v-model="selectedTemplatePath"
              :options="templateOptions"
              :placeholder="
                templatesLoading && templates.length === 0
                  ? t('prNew.loadingTemplates')
                  : templates.length
                    ? t('prNew.selectTemplate')
                    : t('prNew.noTemplates')
              "
              searchable
              :search-placeholder="t('prNew.searchTemplates')"
              :aria-label="t('prNew.templateLabel', { type: requestType })"
            />
          </div>
          <div class="draft-fill-mode field">
            <span>{{ t("prNew.fillMode") }}</span>
            <AppSelect
              v-model="draftFillMode"
              :options="draftFillModeOptions"
              size="sm"
              :aria-label="t('prNew.fillModeAria')"
            />
          </div>
          <div class="draft-assistant-actions">
            <button
              class="btn btn-sm"
              type="button"
              :disabled="!selectedTemplate"
              @click="applyTemplate"
            >
              {{ t("prNew.applyTemplate") }}
            </button>
            <button
              class="btn btn-sm"
              type="button"
              :disabled="templatesLoading || !targetRepository"
              @click="loadTemplates"
            >
              {{ templatesLoading ? t("prNew.loading") : t("common.reload") }}
            </button>
            <button
              class="btn btn-sm ai-draft-button"
              type="button"
              :disabled="!canFillWithAi"
              @click="fillWithAi"
            >
              {{ aiDraftLoading ? t("prNew.aiGenerating") : t("prNew.aiFill") }}
            </button>
            <button
              v-if="aiDraftLoading"
              class="btn btn-sm"
              type="button"
              @click="cancelAiDraftByUser"
            >
              {{ t("prNew.cancelGeneration") }}
            </button>
          </div>
        </div>
        <p v-if="templatesError" class="error-msg" role="alert">{{ templatesError }}</p>
        <p v-if="aiDraftError" class="error-msg" role="alert">{{ aiDraftError }}</p>
        <p v-if="aiDraftDiffLimitNotice" class="draft-assistant-warning" role="status">
          {{ aiDraftDiffLimitNotice }}
        </p>
        <p v-if="draftAssistantNotice" class="draft-assistant-notice" role="status">
          {{ draftAssistantNotice }}
        </p>
        <p class="draft-assistant-help">
          {{ t("prNew.assistantHelp", { type: requestType }) }}
        </p>
        <label class="field field-wide">
          <span>{{ t("prNew.title") }}</span>
          <input
            v-model="title"
            class="input"
            type="text"
            :maxlength="MAX_PR_TITLE_CHARS"
            :placeholder="t('prNew.titlePlaceholder')"
          />
        </label>
        <div class="field field-wide description-field">
          <div class="description-toolbar">
            <span>{{ t("prNew.description") }}</span>
            <div class="description-tabs" role="tablist" :aria-label="t('prNew.markdownMode')">
              <button
                type="button"
                role="tab"
                :aria-selected="descriptionMode === 'edit'"
                :class="{ active: descriptionMode === 'edit' }"
                @click="descriptionMode = 'edit'"
              >
                {{ t("prNew.edit") }}
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="descriptionMode === 'preview'"
                :class="{ active: descriptionMode === 'preview' }"
                @click="descriptionMode = 'preview'"
              >
                {{ t("prNew.preview") }}
              </button>
            </div>
          </div>
          <template v-if="descriptionMode === 'edit'">
            <textarea
              ref="descriptionTextarea"
              v-model="body"
              class="input"
              rows="10"
              :aria-label="t('prNew.markdownDescription')"
              :placeholder="t('prNew.descriptionPlaceholder')"
              @paste="handleDescriptionPaste"
            />
            <p v-if="descriptionImageUploading" class="description-upload-status" role="status">
              <template v-if="platformCapabilities">{{ t("prNew.imageUploading") }}</template>
              <template v-else>{{ t("prNew.imageCapabilityLoading") }}</template>
            </p>
            <p v-if="descriptionImageError" class="error-msg" role="alert">
              {{ descriptionImageError }}
            </p>
            <p class="description-upload-help">
              <template v-if="!platformCapabilities">
                <template v-if="capabilities.errors[creationPlatform]">
                  {{ t("prNew.imageHelpCapabilityFailed") }}
                </template>
                <template v-else>{{ t("prNew.imageHelpCapabilityLoading") }}</template>
              </template>
              <template v-else-if="platformCapabilities.supports_pr_description_image_upload">
                {{ t("prNew.imageHelpSupported") }}
              </template>
              <template v-else>
                {{ t("prNew.imageHelpUnsupported") }}
              </template>
            </p>
          </template>
          <div v-else class="description-preview" role="tabpanel">
            <MarkdownRenderer v-if="body.trim()" :content="descriptionPreviewBody" />
            <p v-else class="description-preview-empty">{{ t("prNew.noPreviewContent") }}</p>
          </div>
        </div>
        <label v-if="platformCapabilities?.supports_pr_draft_toggle" class="draft-option">
          <input v-model="draft" type="checkbox" />
          <span>
            <strong>{{ t("prNew.createDraft") }}</strong>
            <small>{{ t("prNew.createDraftHint") }}</small>
          </span>
        </label>
      </section>

      <section class="card form-section">
        <div class="section-heading">
          <div>
            <h3>{{ t("prNew.metadataHeading") }}</h3>
            <p>{{ t("prNew.metadataHint") }}</p>
          </div>
        </div>
        <div class="metadata-grid">
          <label v-if="platformCapabilities?.supports_pr_reviewer_management" class="field">
            <span>{{ participantLabels.reviewers }}</span>
            <AppMultiSelect
              v-model="reviewers"
              :options="participantOptions"
              :placeholder="
                participantsLoading
                  ? t('common.loadingMore')
                  : t('prNew.selectParticipant', { role: participantLabels.reviewers })
              "
              :search-placeholder="
                t('prNew.searchParticipant', { role: participantLabels.reviewers })
              "
              :empty-text="t('prNew.noMembers')"
              :empty-search-text="t('prNew.noMatchingMembers')"
              :aria-label="participantLabels.reviewers"
              :disabled="participantsLoading || Boolean(participantsError)"
            />
          </label>
          <label v-if="platformCapabilities?.supports_pr_assignee_management" class="field">
            <span>{{ participantLabels.assignees }}</span>
            <AppMultiSelect
              v-model="assignees"
              :options="participantOptions"
              :placeholder="
                participantsLoading
                  ? t('common.loadingMore')
                  : t('prNew.selectParticipant', { role: participantLabels.assignees })
              "
              :search-placeholder="
                t('prNew.searchParticipant', { role: participantLabels.assignees })
              "
              :empty-text="t('prNew.noMembers')"
              :empty-search-text="t('prNew.noMatchingMembers')"
              :aria-label="participantLabels.assignees"
              :disabled="participantsLoading || Boolean(participantsError)"
            />
          </label>
          <label v-if="platformCapabilities?.supports_pr_label_management" class="field">
            <span>{{ t("prNew.labels") }}</span>
            <AppMultiSelect
              v-model="labels"
              :options="labelOptions"
              :placeholder="labelsLoading ? t('common.loadingMore') : t('prNew.selectLabels')"
              :search-placeholder="t('prNew.searchLabels')"
              :empty-text="t('prNew.noLabels')"
              :empty-search-text="t('prNew.noMatchingLabels')"
              :aria-label="t('prNew.labels')"
              :disabled="labelsLoading || Boolean(labelsError)"
            />
          </label>
        </div>
        <p v-if="participantsError" class="error-msg" role="alert">{{ participantsError }}</p>
        <p v-if="labelsError" class="error-msg" role="alert">{{ labelsError }}</p>
      </section>

      <p v-if="capabilities.errors[creationPlatform]" class="error-msg" role="alert">
        {{ capabilities.errors[creationPlatform] }}
      </p>
      <p v-if="error" class="error-msg" role="alert">{{ error }}</p>
      <p
        v-if="platformCapabilities && !platformCapabilities.supports_pr_creation"
        class="validation-note"
        role="status"
      >
        {{ t("prNew.unsupported", { type: requestType }) }}
      </p>
      <div class="form-actions">
        <span>{{ t("prNew.localSafety") }}</span>
        <button class="btn btn-primary" type="submit" :disabled="!canSubmit">
          {{ submitting ? t("prNew.creating") : createLabel }}
        </button>
      </div>
    </form>
  </AppLayout>
</template>

<style scoped src="./PrNewPage.css"></style>
