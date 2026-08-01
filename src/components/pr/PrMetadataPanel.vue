<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { listRepositoryLabels, prParticipantSuggestions } from "@/api";
import AppMultiSelect from "@/components/shared/AppMultiSelect.vue";
import MarkdownRenderer from "@/components/shared/MarkdownRenderer.vue";
import { MAX_PR_TITLE_CHARS } from "@/constants/pr";
import { currentLocale, useI18n } from "@/i18n";
import type {
  Platform,
  PlatformCapabilities,
  PrDetail,
  PrLabel,
  PrMetadataPermissions,
  PrMetadataUpdate,
  PrReviewStatus,
  User,
} from "@/types";
import { getErrorMessage } from "@/utils/error";
import { labelTagColorClass } from "@/utils/labelColorClass";
import { resolvePrContentLink } from "@/utils/prContentLinks";

const props = defineProps<{
  detail: PrDetail;
  platform: Platform;
  owner: string;
  repo: string;
  capabilities: PlatformCapabilities | null;
  saving: boolean;
  statusMessage?: string;
  errorMessage?: string;
}>();

const emit = defineEmits<{
  save: [update: PrMetadataUpdate];
  "open-issue": [number: number];
  "open-link": [href: string];
  "open-external": [href: string];
}>();

const { t } = useI18n();

const editing = ref(false);
const title = ref("");
const body = ref("");
const descriptionMode = ref<"edit" | "preview">("edit");
const draft = ref(false);
const reviewers = ref<string[]>([]);
const assignees = ref<string[]>([]);
const labels = ref<string[]>([]);
const milestone = ref("");
const validationError = ref("");
const availableParticipants = ref<User[]>([]);
const availableLabels = ref<PrLabel[]>([]);
const participantsLoading = ref(false);
const labelsLoading = ref(false);
const participantsError = ref("");
const labelsError = ref("");
let optionsSequence = 0;

const permissions = computed<PrMetadataPermissions>(() => props.detail.metadata_permissions);
const canUse = (supported: boolean | undefined, permission: boolean | null): boolean =>
  supported === true && permission !== false;

const canEditTitleBody = computed(() =>
  canUse(props.capabilities?.supports_pr_title_body_edit, permissions.value.can_edit_title_body),
);
const canToggleDraft = computed(() =>
  canUse(props.capabilities?.supports_pr_draft_toggle, permissions.value.can_toggle_draft),
);
const canManageReviewers = computed(() =>
  canUse(
    props.capabilities?.supports_pr_reviewer_management,
    permissions.value.can_manage_reviewers,
  ),
);
const canManageAssignees = computed(() =>
  canUse(
    props.capabilities?.supports_pr_assignee_management,
    permissions.value.can_manage_assignees,
  ),
);
const canManageLabels = computed(() =>
  canUse(props.capabilities?.supports_pr_label_management, permissions.value.can_manage_labels),
);
const canManageMilestone = computed(() =>
  canUse(
    props.capabilities?.supports_pr_milestone_management,
    permissions.value.can_manage_milestone,
  ),
);
const isGitee = computed(() => props.capabilities?.platform === "gitee");
const participantLabels = computed(() =>
  isGitee.value
    ? { reviewers: t("metadata.reviewersGitee"), assignees: t("metadata.assigneesGitee") }
    : { reviewers: t("metadata.reviewers"), assignees: t("metadata.assignees") },
);
const categoryLabels = computed(() =>
  isGitee.value
    ? { labels: t("metadata.labelsGitee"), milestone: t("metadata.milestoneGitee") }
    : { labels: t("metadata.labels"), milestone: t("metadata.milestone") },
);
const reviewStatusLabels = computed<Record<PrReviewStatus, string>>(() => ({
  pending: t("metadata.reviewPending"),
  approved: t("metadata.reviewApproved"),
  changes_requested: t("metadata.reviewChangesRequested"),
  commented: t("metadata.reviewCommented"),
  dismissed: t("metadata.reviewDismissed"),
  unknown: t("metadata.reviewUnknown"),
}));
const reviewerEntries = computed(() => {
  if (props.detail.reviewer_statuses?.length) return props.detail.reviewer_statuses;
  return props.detail.reviewers.map((user) => ({
    user,
    status: "unknown" as const,
    web_url: null,
  }));
});

const closingIssuePattern =
  /(?:^|[\s,])(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)[\s:]+#(\d+)\b/gi;
const markdownLinkPattern = /\[[^\]]*]\((\S+?)(?:\s+["'][^"']*["'])?\)/g;

function uniqueIssueNumbers(numbers: Iterable<number>): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const number of numbers) {
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) continue;
    seen.add(number);
    result.push(number);
  }
  return result;
}

const linkedIssueNumbers = computed(() => {
  const numbers: number[] = [];
  for (const match of props.detail.body.matchAll(closingIssuePattern))
    numbers.push(Number(match[1]));
  for (const match of props.detail.body.matchAll(markdownLinkPattern)) {
    const resolved = resolvePrContentLink(match[1], {
      platform: props.platform,
      owner: props.owner,
      repo: props.repo,
      webUrl: props.detail.web_url,
    });
    if (
      resolved?.kind === "issue" &&
      resolved.target.owner === props.owner &&
      resolved.target.repo === props.repo
    ) {
      numbers.push(resolved.target.number);
    }
  }
  return uniqueIssueNumbers(numbers);
});

function openIssue(number: number): void {
  emit("open-issue", number);
}

function handleDescriptionLinkClick(payload: { href: string }): void {
  emit("open-link", payload.href);
}

function openReviewerPage(url: string): void {
  emit("open-external", url);
}

function labelColor(value: string | null): string | undefined {
  const color = value?.trim();
  if (!color || !/^#?[0-9a-f]{6}$/i.test(color)) return undefined;
  return color.startsWith("#") ? color : `#${color}`;
}

function summaryLabelColor(name: string): string | null {
  const colors = props.detail.summary.label_colors;
  if (!colors) return null;
  const exactColor = colors[name];
  if (exactColor) return exactColor;

  const normalizedName = name.toLocaleLowerCase();
  return (
    Object.entries(colors).find(([label]) => label.toLocaleLowerCase() === normalizedName)?.[1] ??
    null
  );
}

const participantOptions = computed(() => {
  const options = new Map<
    string,
    {
      value: string;
      label: string;
      description?: string | null;
      avatarUrl?: string | null;
    }
  >();
  for (const participant of [
    ...props.detail.reviewers,
    ...props.detail.assignees,
    ...availableParticipants.value,
  ]) {
    const login = participant.login.trim();
    const key = login.toLocaleLowerCase();
    if (!login || options.has(key)) continue;
    options.set(key, {
      value: login,
      label: login,
      description: participant.name && participant.name !== login ? participant.name : null,
      avatarUrl: participant.avatar_url,
    });
  }
  return [...options.values()];
});

const labelOptions = computed(() => {
  const options = new Map<
    string,
    {
      value: string;
      label: string;
      color?: string;
      description?: string | null;
    }
  >();
  for (const label of [
    ...props.detail.summary.labels.map((name) => ({
      name,
      color: summaryLabelColor(name),
      description: null,
    })),
    ...availableLabels.value,
  ]) {
    const name = label.name.trim();
    const key = name.toLocaleLowerCase();
    if (!name) continue;
    const existing = options.get(key);
    if (existing) {
      existing.color ||= labelColor(label.color);
      existing.description ||= label.description;
      continue;
    }
    options.set(key, {
      value: name,
      label: name,
      color: labelColor(label.color),
      description: label.description,
    });
  }
  return [...options.values()];
});

const hasEditableField = computed(
  () =>
    canEditTitleBody.value ||
    canToggleDraft.value ||
    canManageReviewers.value ||
    canManageAssignees.value ||
    canManageLabels.value ||
    canManageMilestone.value,
);
const hasUnknownPermission = computed(() =>
  [
    props.capabilities?.supports_pr_title_body_edit ? permissions.value.can_edit_title_body : false,
    props.capabilities?.supports_pr_draft_toggle ? permissions.value.can_toggle_draft : false,
    props.capabilities?.supports_pr_reviewer_management
      ? permissions.value.can_manage_reviewers
      : false,
    props.capabilities?.supports_pr_assignee_management
      ? permissions.value.can_manage_assignees
      : false,
    props.capabilities?.supports_pr_label_management ? permissions.value.can_manage_labels : false,
    props.capabilities?.supports_pr_milestone_management
      ? permissions.value.can_manage_milestone
      : false,
  ].some((value) => value == null),
);

function resetForm(): void {
  title.value = props.detail.summary.title;
  body.value = props.detail.body;
  descriptionMode.value = "edit";
  draft.value = props.detail.draft ?? false;
  reviewers.value = props.detail.reviewers.map((user) => user.login).filter(Boolean);
  assignees.value = props.detail.assignees.map((user) => user.login).filter(Boolean);
  labels.value = [...props.detail.summary.labels];
  milestone.value = props.detail.milestone?.title ?? "";
  validationError.value = "";
}

function invalidateOptions(): void {
  optionsSequence += 1;
  participantsLoading.value = false;
  labelsLoading.value = false;
}

watch(
  () => [props.detail, props.platform, props.owner, props.repo] as const,
  () => {
    invalidateOptions();
    resetForm();
    availableParticipants.value = [];
    availableLabels.value = [];
    editing.value = false;
  },
  { immediate: true },
);

async function loadParticipantOptions(sequence: number): Promise<void> {
  if (!canManageReviewers.value && !canManageAssignees.value) return;
  participantsLoading.value = true;
  try {
    const result = await prParticipantSuggestions(props.platform, props.owner, props.repo);
    if (sequence !== optionsSequence) return;
    const seen = new Set<string>();
    availableParticipants.value = result.filter((participant) => {
      const login = participant.login.trim();
      const key = login.toLocaleLowerCase();
      if (!login || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (cause) {
    if (sequence === optionsSequence) {
      participantsError.value = getErrorMessage(cause, t("metadata.participantsLoadFailed"));
    }
  } finally {
    if (sequence === optionsSequence) participantsLoading.value = false;
  }
}

async function loadLabelOptions(sequence: number): Promise<void> {
  if (!canManageLabels.value) return;
  labelsLoading.value = true;
  try {
    const result = await listRepositoryLabels(props.platform, props.owner, props.repo);
    if (sequence !== optionsSequence) return;
    const seen = new Set<string>();
    availableLabels.value = result.filter((label) => {
      const name = label.name.trim();
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (cause) {
    if (sequence === optionsSequence) {
      labelsError.value = getErrorMessage(cause, t("metadata.labelsLoadFailed"));
    }
  } finally {
    if (sequence === optionsSequence) labelsLoading.value = false;
  }
}

function loadOptions(): void {
  const sequence = ++optionsSequence;
  availableParticipants.value = [];
  availableLabels.value = [];
  participantsError.value = "";
  labelsError.value = "";
  void Promise.all([loadParticipantOptions(sequence), loadLabelOptions(sequence)]);
}

function normalizeSelection(value: string[]): string[] {
  const seen = new Set<string>();
  return value
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function startEditing(): void {
  resetForm();
  editing.value = true;
  loadOptions();
}

function cancelEditing(): void {
  invalidateOptions();
  resetForm();
  editing.value = false;
}

function submit(): void {
  const normalizedTitle = title.value.trim();
  if (!normalizedTitle) {
    validationError.value = t("metadata.titleRequired");
    return;
  }
  if (Array.from(normalizedTitle).length > MAX_PR_TITLE_CHARS) {
    validationError.value = t("metadata.titleTooLong", { count: MAX_PR_TITLE_CHARS });
    return;
  }
  validationError.value = "";
  emit("save", {
    title: canEditTitleBody.value ? normalizedTitle : props.detail.summary.title,
    body: canEditTitleBody.value ? body.value : props.detail.body,
    draft: props.capabilities?.supports_pr_draft_toggle
      ? canToggleDraft.value
        ? draft.value
        : props.detail.draft
      : null,
    reviewers: canManageReviewers.value
      ? normalizeSelection(reviewers.value)
      : props.detail.reviewers.map((user) => user.login),
    assignees: canManageAssignees.value
      ? normalizeSelection(assignees.value)
      : props.detail.assignees.map((user) => user.login),
    labels: canManageLabels.value ? normalizeSelection(labels.value) : props.detail.summary.labels,
    milestone: canManageMilestone.value
      ? milestone.value.trim() || null
      : (props.detail.milestone?.title ?? null),
    expected_updated_at: props.detail.summary.updated_at,
  });
}

onUnmounted(invalidateOptions);
</script>

<template>
  <section class="metadata-panel" aria-labelledby="pr-metadata-heading">
    <div class="metadata-heading-row">
      <div>
        <p class="metadata-eyebrow">{{ t("metadata.eyebrow") }}</p>
        <h3 id="pr-metadata-heading">{{ t("metadata.heading") }}</h3>
      </div>
      <button
        v-if="!editing"
        class="btn btn-sm btn-outline"
        type="button"
        :disabled="!hasEditableField || saving"
        :title="hasEditableField ? t('metadata.editTitle') : t('metadata.editUnavailable')"
        data-testid="edit-pr-metadata"
        @click="startEditing"
      >
        {{ t("metadata.edit") }}
      </button>
    </div>

    <div v-if="!editing" class="metadata-summary">
      <div class="metadata-item">
        <span class="metadata-label">{{ t("metadata.state") }}</span>
        <span class="metadata-value">{{
          detail.draft == null ? t("metadata.unavailable") : detail.draft ? "Draft" : "Ready"
        }}</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">{{ participantLabels.reviewers }}</span>
        <span v-if="reviewerEntries.length === 0" class="metadata-value">{{
          t("metadata.unassigned")
        }}</span>
        <span v-else class="metadata-value metadata-reviewer-list">
          <template v-for="reviewer in reviewerEntries" :key="reviewer.user.login">
            <a
              v-if="reviewer.web_url"
              class="metadata-reviewer"
              :href="reviewer.web_url"
              target="_blank"
              rel="noopener noreferrer"
              :title="t('metadata.openReviewer', { login: reviewer.user.login })"
              data-testid="metadata-reviewer-link"
              @click.prevent="openReviewerPage(reviewer.web_url)"
            >
              <span class="metadata-reviewer-name">{{ reviewer.user.login }}</span>
              <span
                class="metadata-review-status"
                :class="`metadata-review-status-${reviewer.status}`"
              >
                {{ reviewStatusLabels[reviewer.status] }}
              </span>
            </a>
            <span v-else class="metadata-reviewer">
              <span class="metadata-reviewer-name">{{ reviewer.user.login }}</span>
              <span
                class="metadata-review-status"
                :class="`metadata-review-status-${reviewer.status}`"
              >
                {{ reviewStatusLabels[reviewer.status] }}
              </span>
            </span>
          </template>
        </span>
      </div>
      <div v-if="capabilities?.supports_pr_assignee_management" class="metadata-item">
        <span class="metadata-label">{{ participantLabels.assignees }}</span>
        <span class="metadata-value">
          {{
            detail.assignees
              .map((user) => user.login)
              .join(currentLocale() === "zh-CN" ? "、" : ", ") || t("metadata.unassigned")
          }}
        </span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">{{ categoryLabels.labels }}</span>
        <span class="metadata-value metadata-tags">
          <span
            v-for="label in detail.summary.labels"
            :key="label"
            class="metadata-tag"
            :class="labelTagColorClass(summaryLabelColor(label))"
          >
            {{ label }}
          </span>
          <span v-if="detail.summary.labels.length === 0">{{ t("metadata.unassigned") }}</span>
        </span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">{{ categoryLabels.milestone }}</span>
        <span class="metadata-value">{{
          detail.milestone?.title || t("metadata.unassigned")
        }}</span>
      </div>
      <div v-if="linkedIssueNumbers.length > 0" class="metadata-item metadata-linked-issues">
        <span class="metadata-label">{{ t("metadata.linkedIssues") }}</span>
        <span class="metadata-value metadata-linked-issue-list">
          <button
            v-for="issueNumber in linkedIssueNumbers"
            :key="issueNumber"
            class="metadata-linked-issue"
            type="button"
            :aria-label="t('metadata.openIssue', { number: issueNumber })"
            @click="openIssue(issueNumber)"
          >
            #{{ issueNumber }}
          </button>
        </span>
      </div>
      <MarkdownRenderer
        v-if="detail.body"
        :content="detail.body"
        link-mode="emit"
        repository-references
        variant="document"
        class="metadata-description metadata-markdown"
        @link-click="handleDescriptionLinkClick"
      />
      <p v-else class="metadata-description metadata-description-empty">
        {{ t("metadata.noDescription") }}
      </p>
    </div>

    <form v-else class="metadata-form" @submit.prevent="submit">
      <label class="field field-wide">
        <span>{{ t("metadata.title") }}</span>
        <input
          v-model="title"
          data-testid="metadata-title"
          type="text"
          :maxlength="MAX_PR_TITLE_CHARS"
          :disabled="!canEditTitleBody || saving"
        />
      </label>
      <div class="field-wide metadata-description-field">
        <div class="metadata-description-toolbar">
          <span id="metadata-description-label">{{ t("metadata.description") }}</span>
          <div
            class="metadata-description-tabs"
            role="tablist"
            :aria-label="t('metadata.descriptionMode')"
          >
            <button
              id="metadata-description-edit-tab"
              type="button"
              role="tab"
              :aria-selected="descriptionMode === 'edit'"
              aria-controls="metadata-description-editor"
              :class="{ active: descriptionMode === 'edit' }"
              @click="descriptionMode = 'edit'"
            >
              {{ t("metadata.descriptionEdit") }}
            </button>
            <button
              id="metadata-description-preview-tab"
              type="button"
              role="tab"
              :aria-selected="descriptionMode === 'preview'"
              aria-controls="metadata-description-preview"
              :class="{ active: descriptionMode === 'preview' }"
              @click="descriptionMode = 'preview'"
            >
              {{ t("metadata.descriptionPreview") }}
            </button>
          </div>
        </div>
        <div
          v-if="descriptionMode === 'edit'"
          id="metadata-description-editor"
          role="tabpanel"
          aria-labelledby="metadata-description-edit-tab"
        >
          <textarea
            v-model="body"
            data-testid="metadata-body"
            rows="5"
            aria-labelledby="metadata-description-label"
            :disabled="!canEditTitleBody || saving"
          />
        </div>
        <div
          v-else
          id="metadata-description-preview"
          class="metadata-description-preview"
          role="tabpanel"
          aria-labelledby="metadata-description-preview-tab"
        >
          <MarkdownRenderer
            v-if="body.trim()"
            :content="body"
            link-mode="emit"
            repository-references
            variant="document"
            class="metadata-markdown"
            @link-click="handleDescriptionLinkClick"
          />
          <p v-else class="metadata-description-preview-empty">
            {{ t("metadata.noPreview") }}
          </p>
        </div>
      </div>
      <label v-if="capabilities?.supports_pr_draft_toggle" class="draft-control">
        <input
          v-model="draft"
          data-testid="metadata-draft"
          type="checkbox"
          :disabled="!canToggleDraft || saving"
        />
        <span>{{ t("metadata.markDraft") }}</span>
      </label>
      <label v-if="capabilities?.supports_pr_reviewer_management" class="field">
        <span>{{ participantLabels.reviewers }}</span>
        <AppMultiSelect
          v-model="reviewers"
          :options="participantOptions"
          :placeholder="
            participantsLoading
              ? t('common.loadingMore')
              : t('metadata.selectParticipant', { participant: participantLabels.reviewers })
          "
          :search-placeholder="
            t('metadata.searchParticipant', { participant: participantLabels.reviewers })
          "
          :empty-text="t('metadata.noParticipants')"
          :empty-search-text="t('metadata.noMatchingParticipants')"
          :aria-label="participantLabels.reviewers"
          :disabled="!canManageReviewers || saving || participantsLoading"
          data-testid="metadata-reviewers"
        />
      </label>
      <label v-if="capabilities?.supports_pr_assignee_management" class="field">
        <span>{{ participantLabels.assignees }}</span>
        <AppMultiSelect
          v-model="assignees"
          :options="participantOptions"
          :placeholder="
            participantsLoading
              ? t('common.loadingMore')
              : t('metadata.selectParticipant', { participant: participantLabels.assignees })
          "
          :search-placeholder="
            t('metadata.searchParticipant', { participant: participantLabels.assignees })
          "
          :empty-text="t('metadata.noParticipants')"
          :empty-search-text="t('metadata.noMatchingParticipants')"
          :aria-label="participantLabels.assignees"
          :disabled="!canManageAssignees || saving || participantsLoading"
          data-testid="metadata-assignees"
        />
      </label>
      <label v-if="capabilities?.supports_pr_label_management" class="field">
        <span>{{ categoryLabels.labels }}</span>
        <AppMultiSelect
          v-model="labels"
          :options="labelOptions"
          :placeholder="labelsLoading ? t('common.loadingMore') : t('metadata.selectLabels')"
          :search-placeholder="t('metadata.searchLabels')"
          :empty-text="t('metadata.noLabels')"
          :empty-search-text="t('metadata.noMatchingLabels')"
          :aria-label="categoryLabels.labels"
          :disabled="!canManageLabels || saving || labelsLoading"
          data-testid="metadata-labels"
        />
      </label>
      <label v-if="capabilities?.supports_pr_milestone_management" class="field">
        <span>{{ categoryLabels.milestone }}</span>
        <input
          v-model="milestone"
          data-testid="metadata-milestone"
          type="text"
          :disabled="!canManageMilestone || saving"
          :placeholder="t('metadata.milestoneRemove')"
        />
      </label>
      <p v-if="hasUnknownPermission" class="permission-note">
        {{ t("metadata.permissionUnknown") }}
      </p>
      <div v-if="participantsError || labelsError" class="options-error" role="alert">
        <p class="error-msg">
          {{
            [participantsError, labelsError]
              .filter(Boolean)
              .join(currentLocale() === "zh-CN" ? "；" : "; ")
          }}
        </p>
        <button
          class="btn btn-sm btn-outline"
          type="button"
          :disabled="saving || participantsLoading || labelsLoading"
          data-testid="metadata-options-retry"
          @click="loadOptions"
        >
          {{ t("metadata.reloadOptions") }}
        </button>
      </div>
      <p v-if="validationError" class="error-msg" role="alert">{{ validationError }}</p>
      <div class="metadata-form-actions">
        <button class="btn btn-sm" type="button" :disabled="saving" @click="cancelEditing">
          {{ t("common.cancel") }}
        </button>
        <button class="btn btn-sm btn-primary" type="submit" :disabled="saving">
          {{ saving ? t("metadata.saving") : t("metadata.save") }}
        </button>
      </div>
    </form>

    <p v-if="statusMessage" class="metadata-status success-msg" role="status">
      {{ statusMessage }}
    </p>
    <p v-if="errorMessage" class="metadata-status error-msg" role="alert">
      {{ errorMessage }}
    </p>
  </section>
</template>

<style scoped src="./PrMetadataPanel.css"></style>
