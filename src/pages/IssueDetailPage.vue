<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { useRoute } from "vue-router";
import CloseConfirmDialog from "@/components/shared/CloseConfirmDialog.vue";
import AppLayout from "@/components/layout/AppLayout.vue";
import AppMultiSelect from "@/components/shared/AppMultiSelect.vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import MarkdownRenderer from "@/components/shared/MarkdownRenderer.vue";
import { currentLocale, useI18n } from "@/i18n";
import {
  issueCommentAdd,
  issueCommentsList,
  issueDetail,
  issueMetadataUpdate,
  listRepositoryLabels,
} from "@/api";
import type { Issue, IssueComment, IssueMetadataUpdate, Platform, PrLabel } from "@/types";
import { getErrorMessage } from "@/utils/error";
import { labelTagColorClass } from "@/utils/labelColorClass";

interface IssueRouteContext {
  platform: Platform;
  owner: string;
  repo: string;
  number: number;
}

const route = useRoute();
const { t } = useI18n();
const issue = ref<Issue | null>(null);
const loading = ref(false);
const error = ref("");
const comments = ref<IssueComment[]>([]);
const commentsLoading = ref(false);
const commentsError = ref("");
const commentBody = ref("");
const commentSubmitting = ref(false);
const commentSubmitError = ref("");
const editing = ref(false);
const editTitle = ref("");
const editBody = ref("");
const editState = ref<"open" | "closed">("open");
const editLabels = ref<string[]>([]);
const editDescriptionMode = ref<"edit" | "preview">("edit");
const metadataSaving = ref(false);
const metadataError = ref("");
const metadataStatus = ref("");
const closeConfirmOpen = ref(false);
const closeSubmitting = ref(false);
const closeError = ref("");
const availableLabels = ref<PrLabel[]>([]);
const labelsLoading = ref(false);
const labelsError = ref("");
let requestSequence = 0;
let commentsRequestSequence = 0;
let metadataMutationSequence = 0;
let closeMutationSequence = 0;
let commentMutationSequence = 0;
let labelsRequestSequence = 0;

const context = computed<IssueRouteContext | null>(() => {
  const platform = route.params.platform;
  const owner = route.params.owner;
  const repo = route.params.repo;
  const number = Number(route.params.number);
  if (
    (platform !== "github" && platform !== "gitlab" && platform !== "gitee") ||
    typeof owner !== "string" ||
    typeof repo !== "string" ||
    !Number.isInteger(number) ||
    number <= 0
  ) {
    return null;
  }
  return { platform, owner, repo, number };
});
const repositoryFullName = computed(() => {
  const current = context.value;
  return current ? `${current.owner}/${current.repo}` : "";
});
const platformLabel = computed(() => {
  const labels: Record<Platform, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    gitee: "Gitee",
  };
  return context.value ? labels[context.value.platform] : "";
});
const issueBody = computed(() => issue.value?.body.trim() ?? "");
const stateLabel = computed(() =>
  issue.value?.state === "closed" ? t("issue.closed") : t("issue.open"),
);
const canUse = (permission: boolean | null | undefined): boolean => permission === true;
const canEditTitleBody = computed(() =>
  canUse(issue.value?.metadata_permissions.can_edit_title_body),
);
const canChangeState = computed(() => canUse(issue.value?.metadata_permissions.can_change_state));
const canManageLabels = computed(() => canUse(issue.value?.metadata_permissions.can_manage_labels));
const canEditMetadata = computed(
  () => canEditTitleBody.value || canChangeState.value || canManageLabels.value,
);
const stateOptions = computed(() => [
  { value: "open", label: t("issue.open") },
  { value: "closed", label: t("issue.closed") },
]);
const labelOptions = computed(() => {
  const byName = new Map<string, PrLabel>();
  for (const label of availableLabels.value) byName.set(label.name.toLocaleLowerCase(), label);
  for (const name of issue.value?.labels ?? []) {
    if (!byName.has(name.toLocaleLowerCase())) {
      byName.set(name.toLocaleLowerCase(), {
        name,
        color: issueLabelColor(name),
        description: null,
      });
    }
  }
  return [...byName.values()].map((label) => ({
    value: label.name,
    label: label.name,
    color: label.color,
    description: label.description,
  }));
});

function issueLabelColor(name: string): string | null {
  const colors = issue.value?.label_colors;
  if (!colors) return null;
  const exactColor = colors[name];
  if (exactColor) return exactColor;

  const normalizedName = name.toLocaleLowerCase();
  return (
    Object.entries(colors).find(([label]) => label.toLocaleLowerCase() === normalizedName)?.[1] ??
    null
  );
}
const metadataHasChanges = computed(() => {
  const current = issue.value;
  if (!current) return false;
  const currentLabels = [...current.labels].map((label) => label.toLocaleLowerCase()).sort();
  const nextLabels = [...editLabels.value].map((label) => label.toLocaleLowerCase()).sort();
  return (
    current.title !== editTitle.value.trim() ||
    current.body !== editBody.value ||
    current.state !== editState.value ||
    currentLabels.join("\0") !== nextLabels.join("\0")
  );
});

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(currentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sameContext(left: IssueRouteContext, right: IssueRouteContext | null): boolean {
  return (
    right !== null &&
    left.platform === right.platform &&
    left.owner === right.owner &&
    left.repo === right.repo &&
    left.number === right.number
  );
}

async function loadIssue() {
  const current = context.value;
  const sequence = ++requestSequence;
  issue.value = null;
  error.value = "";
  if (!current) {
    loading.value = false;
    error.value = t("issue.invalidAddress");
    return;
  }

  loading.value = true;
  try {
    const result = await issueDetail(current.platform, current.owner, current.repo, current.number);
    if (sequence !== requestSequence || !sameContext(current, context.value)) return;
    issue.value = result;
  } catch (loadError) {
    if (sequence !== requestSequence || !sameContext(current, context.value)) return;
    error.value = getErrorMessage(loadError, t("issue.loadFailed"));
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

async function refreshIssue(current: IssueRouteContext) {
  const sequence = ++requestSequence;
  try {
    const result = await issueDetail(current.platform, current.owner, current.repo, current.number);
    if (sequence !== requestSequence || !sameContext(current, context.value)) return;
    issue.value = result;
  } catch {
    // 评论已经成功，静默刷新失败不应把已完成的操作显示为失败。
  }
}

async function loadComments() {
  const current = context.value;
  const sequence = ++commentsRequestSequence;
  comments.value = [];
  commentsError.value = "";
  if (!current) {
    commentsLoading.value = false;
    return;
  }

  commentsLoading.value = true;
  try {
    const result = await issueCommentsList(
      current.platform,
      current.owner,
      current.repo,
      current.number,
    );
    if (sequence !== commentsRequestSequence || !sameContext(current, context.value)) return;
    comments.value = [...result].sort((left, right) =>
      left.created_at.localeCompare(right.created_at),
    );
  } catch (loadError) {
    if (sequence !== commentsRequestSequence || !sameContext(current, context.value)) return;
    commentsError.value = getErrorMessage(loadError, t("issue.commentLoadFailed"));
  } finally {
    if (sequence === commentsRequestSequence) commentsLoading.value = false;
  }
}

async function loadLabelOptions() {
  const current = context.value;
  const sequence = ++labelsRequestSequence;
  labelsError.value = "";
  if (!current || !canManageLabels.value) {
    availableLabels.value = [];
    labelsLoading.value = false;
    return;
  }

  labelsLoading.value = true;
  try {
    const result = await listRepositoryLabels(current.platform, current.owner, current.repo);
    if (sequence !== labelsRequestSequence || !sameContext(current, context.value)) return;
    const seen = new Set<string>();
    availableLabels.value = result.filter((label) => {
      const name = label.name.trim();
      const key = name.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      label.name = name;
      return true;
    });
  } catch (loadError) {
    if (sequence !== labelsRequestSequence || !sameContext(current, context.value)) return;
    labelsError.value = getErrorMessage(loadError, t("issue.labelLoadFailed"));
  } finally {
    if (sequence === labelsRequestSequence) labelsLoading.value = false;
  }
}

function beginEditing() {
  if (!issue.value || !canEditMetadata.value) return;
  editTitle.value = issue.value.title;
  editBody.value = issue.value.body;
  editState.value = issue.value.state === "closed" ? "closed" : "open";
  editLabels.value = [...issue.value.labels];
  editDescriptionMode.value = canEditTitleBody.value ? "edit" : "preview";
  metadataError.value = "";
  metadataStatus.value = "";
  editing.value = true;
  if (canManageLabels.value) void loadLabelOptions();
}

function cancelEditing() {
  editing.value = false;
  metadataError.value = "";
}

function beginClosing(): void {
  if (!issue.value || issue.value.state !== "open" || !canChangeState.value) return;
  closeError.value = "";
  metadataStatus.value = "";
  closeConfirmOpen.value = true;
}

function cancelClosing(): void {
  if (closeSubmitting.value) return;
  closeConfirmOpen.value = false;
  closeError.value = "";
}

async function closeIssue(): Promise<void> {
  const current = context.value;
  const currentIssue = issue.value;
  if (
    !current ||
    !currentIssue ||
    currentIssue.state !== "open" ||
    !canChangeState.value ||
    closeSubmitting.value
  ) {
    return;
  }

  const sequence = ++closeMutationSequence;
  const update: IssueMetadataUpdate = {
    title: currentIssue.title,
    body: currentIssue.body,
    state: "closed",
    labels: currentIssue.labels,
    expected_updated_at: currentIssue.updated_at,
  };
  closeSubmitting.value = true;
  closeError.value = "";
  try {
    const result = await issueMetadataUpdate(
      current.platform,
      current.owner,
      current.repo,
      current.number,
      update,
    );
    if (sequence !== closeMutationSequence || !sameContext(current, context.value)) return;
    requestSequence += 1;
    issue.value = result;
    closeConfirmOpen.value = false;
    metadataStatus.value = t("issue.closeSuccess");
  } catch (closeIssueError) {
    if (sequence !== closeMutationSequence || !sameContext(current, context.value)) return;
    closeError.value = getErrorMessage(closeIssueError, t("issue.closeFailed"));
  } finally {
    if (sequence === closeMutationSequence) closeSubmitting.value = false;
  }
}

async function saveMetadata() {
  const current = context.value;
  const currentIssue = issue.value;
  if (
    !current ||
    !currentIssue ||
    !canEditMetadata.value ||
    !metadataHasChanges.value ||
    !editTitle.value.trim()
  ) {
    return;
  }
  const sequence = ++metadataMutationSequence;
  const update: IssueMetadataUpdate = {
    title: editTitle.value,
    body: editBody.value,
    state: editState.value,
    labels: editLabels.value,
    expected_updated_at: currentIssue.updated_at,
  };
  metadataSaving.value = true;
  metadataError.value = "";
  metadataStatus.value = "";
  try {
    const result = await issueMetadataUpdate(
      current.platform,
      current.owner,
      current.repo,
      current.number,
      update,
    );
    if (sequence !== metadataMutationSequence || !sameContext(current, context.value)) return;
    issue.value = result;
    editing.value = false;
    metadataStatus.value = t("issue.metadataSaved");
  } catch (saveError) {
    if (sequence !== metadataMutationSequence || !sameContext(current, context.value)) return;
    metadataError.value = getErrorMessage(saveError, t("issue.metadataSaveFailed"));
  } finally {
    if (sequence === metadataMutationSequence) metadataSaving.value = false;
  }
}

async function submitComment() {
  const current = context.value;
  const body = commentBody.value.trim();
  if (!current || !body) return;
  const sequence = ++commentMutationSequence;
  commentSubmitting.value = true;
  commentSubmitError.value = "";
  try {
    const result = await issueCommentAdd(
      current.platform,
      current.owner,
      current.repo,
      current.number,
      body,
    );
    if (sequence !== commentMutationSequence || !sameContext(current, context.value)) return;
    comments.value = [...comments.value, result];
    commentBody.value = "";
    void refreshIssue(current);
  } catch (submitError) {
    if (sequence !== commentMutationSequence || !sameContext(current, context.value)) return;
    commentSubmitError.value = getErrorMessage(submitError, t("issue.commentFailed"));
  } finally {
    if (sequence === commentMutationSequence) commentSubmitting.value = false;
  }
}

watch(
  context,
  () => {
    metadataMutationSequence += 1;
    closeMutationSequence += 1;
    commentMutationSequence += 1;
    labelsRequestSequence += 1;
    editing.value = false;
    metadataSaving.value = false;
    metadataStatus.value = "";
    closeConfirmOpen.value = false;
    closeSubmitting.value = false;
    closeError.value = "";
    commentBody.value = "";
    commentSubmitting.value = false;
    commentSubmitError.value = "";
    availableLabels.value = [];
    labelsLoading.value = false;
    void loadIssue();
    void loadComments();
  },
  { immediate: true },
);

onScopeDispose(() => {
  requestSequence += 1;
  commentsRequestSequence += 1;
  labelsRequestSequence += 1;
  metadataMutationSequence += 1;
  closeMutationSequence += 1;
  commentMutationSequence += 1;
});
</script>

<template>
  <AppLayout compact-sidebar>
    <template #header>
      <div class="issue-detail-header page-heading">
        <div>
          <h2>{{ t("issue.detailTitle") }}</h2>
          <p v-if="context">{{ platformLabel }} · {{ repositoryFullName }} #{{ context.number }}</p>
          <p v-else>{{ t("issue.invalidAddress") }}</p>
        </div>
        <router-link to="/issue" class="btn btn-sm">{{ t("issue.backToList") }}</router-link>
      </div>
    </template>

    <div v-if="loading" class="loading-skeleton">
      <div class="skeleton skeleton-title" />
      <div class="skeleton skeleton-meta" />
      <div class="skeleton skeleton-body" />
    </div>

    <div v-else-if="error" class="issue-detail-error state-panel" role="alert">
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <strong>{{ error }}</strong>
      <button v-if="context" type="button" class="btn btn-sm" @click="loadIssue">
        {{ t("common.reload") }}
      </button>
    </div>

    <article v-else-if="issue" class="issue-detail">
      <section class="issue-detail-summary">
        <div class="issue-detail-title-row">
          <span class="issue-detail-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </span>
          <div class="issue-detail-title">
            <h3>{{ issue.title }}</h3>
            <div class="issue-detail-meta">
              <span>#{{ issue.number }}</span>
              <span>{{ issue.author.login }}</span>
              <span>{{ t("issue.createdAt", { date: formatDate(issue.created_at) }) }}</span>
              <span>{{ t("issue.updatedAt", { date: formatDate(issue.updated_at) }) }}</span>
            </div>
          </div>
          <div class="issue-detail-actions">
            <span class="badge" :class="`badge-${issue.state}`">{{ stateLabel }}</span>
            <button
              v-if="!editing && canEditMetadata"
              type="button"
              class="btn btn-sm"
              @click="beginEditing"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" />
              </svg>
              {{ t("issue.edit") }}
            </button>
            <button
              v-if="!editing && issue.state === 'open' && canChangeState"
              type="button"
              class="btn btn-danger btn-sm"
              data-testid="open-close-issue"
              @click="beginClosing"
            >
              {{ t("issue.close") }}
            </button>
          </div>
        </div>

        <div
          v-if="issue.labels.length && !editing"
          class="issue-detail-labels"
          :aria-label="t('issue.labelAria')"
        >
          <span
            v-for="label in issue.labels"
            :key="label"
            class="label-tag"
            :class="labelTagColorClass(issueLabelColor(label))"
          >
            {{ label }}
          </span>
        </div>
      </section>

      <form v-if="editing" class="issue-metadata-editor" @submit.prevent="saveMetadata">
        <div class="issue-editor-grid">
          <label class="field issue-editor-title">
            <span>{{ t("issue.title") }}</span>
            <input
              v-model="editTitle"
              class="input"
              maxlength="256"
              autocomplete="off"
              :disabled="!canEditTitleBody"
            />
          </label>
          <label class="field">
            <span>{{ t("issue.state") }}</span>
            <AppSelect
              v-model="editState"
              :options="stateOptions"
              :disabled="!canChangeState"
              :aria-label="t('issue.stateAria')"
            />
          </label>
        </div>

        <div class="field">
          <div
            class="issue-editor-tabs"
            role="tablist"
            :aria-label="t('issue.editDescriptionMode')"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="editDescriptionMode === 'edit'"
              :class="{ active: editDescriptionMode === 'edit' }"
              @click="editDescriptionMode = 'edit'"
            >
              {{ t("issue.edit") }}
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="editDescriptionMode === 'preview'"
              :class="{ active: editDescriptionMode === 'preview' }"
              @click="editDescriptionMode = 'preview'"
            >
              {{ t("issue.preview") }}
            </button>
          </div>
          <textarea
            v-if="editDescriptionMode === 'edit'"
            v-model="editBody"
            class="input issue-editor-body"
            rows="10"
            :aria-label="t('issue.body')"
            :disabled="!canEditTitleBody"
          />
          <div v-else class="issue-editor-preview" role="tabpanel">
            <MarkdownRenderer v-if="editBody.trim()" :content="editBody" variant="document" />
            <p v-else>{{ t("issue.emptyPreview") }}</p>
          </div>
        </div>

        <div class="field">
          <span>{{ t("issue.labels") }}</span>
          <AppMultiSelect
            v-model="editLabels"
            :options="labelOptions"
            :disabled="labelsLoading || !canManageLabels"
            :placeholder="labelsLoading ? t('issue.labelLoading') : t('issue.labelPlaceholder')"
            :search-placeholder="t('issue.labelSearch')"
            :empty-text="t('issue.labelEmpty')"
            :empty-search-text="t('issue.labelNoMatch')"
            :aria-label="t('issue.selectLabelsAria')"
          />
          <div v-if="labelsError" class="issue-inline-error">
            <span>{{ labelsError }}</span>
            <button type="button" @click="loadLabelOptions">{{ t("common.reload") }}</button>
          </div>
        </div>

        <p v-if="metadataError" class="issue-action-error" role="alert">{{ metadataError }}</p>
        <div class="issue-editor-actions">
          <button
            type="button"
            class="btn btn-sm"
            :disabled="metadataSaving"
            @click="cancelEditing"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            :disabled="metadataSaving || !metadataHasChanges || !editTitle.trim()"
          >
            {{ metadataSaving ? t("issue.metadataSaving") : t("issue.metadataSave") }}
          </button>
        </div>
      </form>

      <p v-if="metadataStatus" class="issue-action-status" role="status">{{ metadataStatus }}</p>

      <section v-if="!editing" class="issue-detail-body">
        <MarkdownRenderer
          v-if="issueBody"
          :content="issueBody"
          class="issue-markdown"
          variant="document"
        />
        <p v-else class="issue-empty-body">{{ t("issue.emptyBody") }}</p>
      </section>

      <section class="issue-comments" aria-labelledby="issue-comments-heading">
        <div class="issue-comments-heading">
          <div>
            <h3 id="issue-comments-heading">{{ t("issue.comments") }}</h3>
            <span>{{ t("issue.commentCount", { count: comments.length }) }}</span>
          </div>
          <button
            v-if="commentsError"
            type="button"
            class="btn btn-sm"
            :disabled="commentsLoading"
            @click="loadComments"
          >
            {{ t("common.reload") }}
          </button>
        </div>

        <div
          v-if="commentsLoading"
          class="issue-comments-loading"
          :aria-label="t('issue.commentLoading')"
        >
          <div class="skeleton" />
          <div class="skeleton" />
        </div>
        <p v-else-if="commentsError" class="issue-comments-message" role="alert">
          {{ commentsError }}
        </p>
        <p v-else-if="comments.length === 0" class="issue-comments-message">
          {{ t("issue.emptyComments") }}
        </p>
        <div v-else class="issue-comment-list">
          <article v-for="comment in comments" :key="String(comment.id)" class="issue-comment">
            <header>
              <img
                v-if="comment.author.avatar_url"
                :src="comment.author.avatar_url"
                :alt="t('issue.avatarAlt', { author: comment.author.login })"
                referrerpolicy="no-referrer"
              />
              <span v-else class="issue-comment-avatar" aria-hidden="true">
                {{ comment.author.login.slice(0, 1).toLocaleUpperCase() }}
              </span>
              <strong>{{ comment.author.login }}</strong>
              <time :datetime="comment.created_at">{{ formatDate(comment.created_at) }}</time>
            </header>
            <MarkdownRenderer
              :content="comment.body"
              class="issue-comment-body"
              variant="document"
            />
          </article>
        </div>

        <form class="issue-comment-composer" @submit.prevent="submitComment">
          <label for="issue-comment-body">{{ t("issue.commentAdd") }}</label>
          <textarea
            id="issue-comment-body"
            v-model="commentBody"
            class="input"
            rows="5"
            :placeholder="t('issue.commentPlaceholder')"
          />
          <p v-if="commentSubmitError" class="issue-action-error" role="alert">
            {{ commentSubmitError }}
          </p>
          <div>
            <button
              type="submit"
              class="btn btn-primary btn-sm"
              :disabled="commentSubmitting || !commentBody.trim()"
            >
              {{ commentSubmitting ? t("issue.commentSubmitting") : t("issue.commentAdd") }}
            </button>
          </div>
        </form>
      </section>
    </article>

    <CloseConfirmDialog
      v-if="issue && context"
      :open="closeConfirmOpen"
      :title="t('issue.closeConfirmTitle', { number: issue.number })"
      :repository="repositoryFullName"
      :target="`#${issue.number} ${issue.title}`"
      :impact="t('issue.closeConfirmImpact')"
      :warning="t('issue.closeConfirmWarning')"
      :confirm-label="t('issue.close')"
      :loading="closeSubmitting"
      :error="closeError"
      @cancel="cancelClosing"
      @confirm="closeIssue"
    />
  </AppLayout>
</template>

<style scoped src="./IssueDetailPage.css"></style>
