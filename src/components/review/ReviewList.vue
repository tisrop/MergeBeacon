<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import type {
  DiffSide,
  Platform,
  PrComment,
  PrFile,
  Review,
  ReviewThreadSummary,
  StandardPatchFile,
} from "@/types";
import {
  reviewCommentDelete,
  reviewCommentUpdate,
  reviewCommentsList,
  reviewList,
  reviewThreadReply,
  reviewThreadSetResolved,
} from "@/api";
import {
  extractDiffHunk,
  findStandardPatch,
  inferDiffSide,
  patchContainsLine,
} from "@/utils/diffHunk";
import { getErrorMessage } from "@/utils/error";
import { motionAwareScrollBehavior } from "@/utils/motion";
import MarkdownRenderer from "@/components/shared/MarkdownRenderer.vue";
import { currentLocale, useI18n } from "@/i18n";
import MiniDiffView from "./MiniDiffView.vue";

const props = defineProps<{
  platform: Platform;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string | null;
  diffFiles?: PrFile[];
  diffPatches?: StandardPatchFile[];
  canResolveThreads?: boolean;
}>();

const emit = defineEmits<{
  threadSummary: [summary: ReviewThreadSummary];
  locateComment: [path: string, line: number | null, side: DiffSide | null];
  openLink: [href: string];
}>();

const { t } = useI18n();

type ThreadFilter = "all" | "unresolved" | "resolved";

interface GeneralReviewItem {
  id: string;
  author: Review["author"];
  body: string;
  time: string;
  kind: "general_comment" | "overall_review";
  state: string;
}

interface ReviewThread {
  id: string;
  comments: PrComment[];
  path: string;
  line: number | null;
  startLine: number | null;
  diffHunk: string | null;
  contextLine: number | null;
  displayPath: string;
  locationPath: string;
  side: DiffSide | null;
  canLocate: boolean;
  canNavigate: boolean;
  outdated: boolean;
  resolved: boolean | null;
  resolvable: boolean;
  updatedAt: string;
}

const generalItems = ref<GeneralReviewItem[]>([]);
const threads = ref<ReviewThread[]>([]);
const loading = ref(false);
const error = ref("");
const threadFilter = ref<ThreadFilter>("all");
const expandedBodies = ref(new Set<string>());
const codeExpanded = ref(new Set<string>());
const updatingThreads = ref(new Set<string>());
const threadErrors = ref<Record<string, string>>({});
const replyBodies = ref<Record<string, string>>({});
const editingComments = ref(new Set<string>());
const editingBodies = ref<Record<string, string>>({});
const deletingComments = ref(new Set<string>());
const deleteConfirmations = ref(new Set<string>());
const commentErrors = ref<Record<string, string>>({});
const activeThreadId = ref<string | null>(null);
const threadElements = new Map<string, HTMLElement>();
const loadedComments = ref<PrComment[]>([]);
let requestSequence = 0;
let resolutionOperationSequence = 0;
const activeResolutionOperations = new Map<string, number>();

const filteredThreads = computed(() => {
  if (threadFilter.value === "resolved")
    return threads.value.filter((thread) => thread.resolved === true);
  if (threadFilter.value === "unresolved") {
    return threads.value.filter((thread) => thread.resolved === false);
  }
  return threads.value;
});

const overallReviewCount = computed(
  () => generalItems.value.filter((item) => item.kind === "overall_review").length,
);
const generalCommentCount = computed(
  () => generalItems.value.filter((item) => item.kind === "general_comment").length,
);
const resolvedCount = computed(
  () => threads.value.filter((thread) => thread.resolved === true).length,
);
const unresolvedCount = computed(
  () => threads.value.filter((thread) => thread.resolved === false).length,
);

function itemId(threadId: string, comment: PrComment): string {
  return `${threadId}:${String(comment.id)}`;
}

function toggleBody(id: string): void {
  const next = new Set(expandedBodies.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedBodies.value = next;
}

function handleLinkClick(payload: { href: string }): void {
  emit("openLink", payload.href);
}

function toggleCode(id: string): void {
  const next = new Set(codeExpanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  codeExpanded.value = next;
}

function isOutdated(comment: PrComment): boolean {
  const originalCommit = comment.original_commit_id ?? comment.commit_id;
  if (!originalCommit || !props.headSha) return false;
  return originalCommit !== props.headSha;
}

function threadIsOutdated(thread: ReviewThread): boolean {
  return thread.outdated;
}

function reviewKind(review: Review): GeneralReviewItem["kind"] {
  return review.kind;
}

function reviewContextKey(): string {
  return [props.platform, props.owner, props.repo, props.prNumber].join("\u0000");
}

function buildThreads(comments: PrComment[]): ReviewThread[] {
  const grouped = new Map<string, PrComment[]>();
  comments.forEach((comment) => {
    const threadId = comment.thread_id || String(comment.id);
    const current = grouped.get(threadId) ?? [];
    current.push(comment);
    grouped.set(threadId, current);
  });

  return [...grouped.entries()]
    .map(([id, threadComments]) => {
      const chronological = [...threadComments].sort(
        (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
      );
      const root =
        chronological.find((comment) => comment.reply_to_id === null) ?? chronological[0];
      const sorted = [root, ...chronological.filter((comment) => comment !== root)];
      const patch = findStandardPatch(props.diffPatches ?? [], root.path);
      const displayPath = patch?.new_path || patch?.filename || root.path;
      const file = props.diffFiles?.find((candidate) => candidate.filename === displayPath);
      const originalContextLine = root.original_line ?? root.line;
      const inferredSide = root.side ?? (patch ? inferDiffSide(patch, root.path) : undefined);
      const latest = chronological.at(-1) ?? root;
      const hasCurrentDiff = props.diffFiles !== undefined || props.diffPatches !== undefined;
      const canLocate = !hasCurrentDiff
        ? root.line !== null
        : Boolean(file && root.line && patch && patchContainsLine(patch, root.line, inferredSide));
      const canNavigate = hasCurrentDiff ? Boolean(file) : Boolean(displayPath);
      const outdated = hasCurrentDiff ? !canLocate : isOutdated(root);
      let diffHunk = root.diff_hunk;
      if (!diffHunk && canLocate && root.line && patch) {
        diffHunk = extractDiffHunk(patch, root.line, inferredSide) ?? null;
      }
      return {
        id,
        comments: sorted,
        path: root.path,
        displayPath,
        locationPath: root.path || displayPath,
        side: inferredSide ?? null,
        line: root.line,
        startLine: root.start_line,
        diffHunk,
        contextLine: outdated ? originalContextLine : root.line,
        canLocate,
        canNavigate,
        outdated,
        resolved: root.resolved,
        resolvable: root.resolvable,
        updatedAt: latest.created_at,
      };
    })
    .sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
}

function emitSummary(): void {
  const summary: ReviewThreadSummary = {
    comments: threads.value.reduce((total, thread) => total + thread.comments.length, 0),
    threads: threads.value.length,
    unresolved: unresolvedCount.value,
    by_file: {},
  };
  threads.value.forEach((thread) => {
    if (!thread.displayPath) return;
    const current = summary.by_file[thread.displayPath] ?? { comments: 0, unresolved: 0 };
    current.comments += thread.comments.length;
    if (thread.resolved === false) current.unresolved += 1;
    summary.by_file[thread.displayPath] = current;
  });
  emit("threadSummary", summary);
}

function commentKey(thread: ReviewThread, comment: PrComment): string {
  return `${thread.id}:${String(comment.id)}`;
}

function setThreadElement(threadId: string, element: unknown): void {
  if (element instanceof HTMLElement) threadElements.set(threadId, element);
  else threadElements.delete(threadId);
}

function threadContextKey(): string {
  return reviewContextKey();
}

async function reloadAfterMutation(contextKey: string): Promise<void> {
  if (threadContextKey() !== contextKey) return;
  await loadReviews();
}

function setCommentError(key: string, message: string): void {
  commentErrors.value = { ...commentErrors.value, [key]: message };
}

async function replyToThread(thread: ReviewThread): Promise<void> {
  const body = replyBodies.value[thread.id]?.trim() ?? "";
  if (!body || thread.comments.length === 0) return;
  const contextKey = threadContextKey();
  const root = thread.comments[0];
  const operationKey = `${thread.id}:reply`;
  const nextUpdating = new Set(updatingThreads.value);
  nextUpdating.add(operationKey);
  updatingThreads.value = nextUpdating;
  setCommentError(operationKey, "");
  try {
    await reviewThreadReply(
      props.platform,
      props.owner,
      props.repo,
      props.prNumber,
      thread.id,
      String(root.id),
      body,
    );
    if (threadContextKey() === contextKey) {
      replyBodies.value = { ...replyBodies.value, [thread.id]: "" };
    }
    await reloadAfterMutation(contextKey);
  } catch (mutationError) {
    if (threadContextKey() === contextKey)
      setCommentError(operationKey, getErrorMessage(mutationError, t("review.replyFailed")));
  } finally {
    if (threadContextKey() === contextKey) {
      const after = new Set(updatingThreads.value);
      after.delete(operationKey);
      updatingThreads.value = after;
    }
  }
}

function beginEdit(comment: PrComment): void {
  const key = String(comment.id);
  editingComments.value = new Set(editingComments.value).add(key);
  editingBodies.value = { ...editingBodies.value, [key]: comment.body };
}

function finishEdit(key: string): void {
  const next = new Set(editingComments.value);
  next.delete(key);
  editingComments.value = next;
  const nextBodies = { ...editingBodies.value };
  delete nextBodies[key];
  editingBodies.value = nextBodies;
}

function cancelEdit(comment: PrComment): void {
  finishEdit(String(comment.id));
}

async function saveEdit(thread: ReviewThread, comment: PrComment): Promise<void> {
  const commentId = String(comment.id);
  const body = editingBodies.value[commentId]?.trim() ?? "";
  if (!body) return;
  const contextKey = threadContextKey();
  const operationKey = `${thread.id}:${commentId}:edit`;
  const nextUpdating = new Set(updatingThreads.value);
  nextUpdating.add(operationKey);
  updatingThreads.value = nextUpdating;
  setCommentError(operationKey, "");
  try {
    await reviewCommentUpdate(
      props.platform,
      props.owner,
      props.repo,
      props.prNumber,
      thread.id,
      commentId,
      body,
    );
    if (threadContextKey() === contextKey) finishEdit(commentId);
    await reloadAfterMutation(contextKey);
  } catch (mutationError) {
    if (threadContextKey() === contextKey)
      setCommentError(operationKey, getErrorMessage(mutationError, t("review.editFailed")));
  } finally {
    if (threadContextKey() === contextKey) {
      const after = new Set(updatingThreads.value);
      after.delete(operationKey);
      updatingThreads.value = after;
    }
  }
}

async function deleteComment(thread: ReviewThread, comment: PrComment): Promise<void> {
  const commentId = String(comment.id);
  const confirmationKey = commentKey(thread, comment);
  if (!deleteConfirmations.value.has(confirmationKey)) {
    deleteConfirmations.value = new Set(deleteConfirmations.value).add(confirmationKey);
    return;
  }
  const contextKey = threadContextKey();
  const operationKey = `${thread.id}:${commentId}:delete`;
  const nextDeleting = new Set(deletingComments.value);
  nextDeleting.add(commentId);
  deletingComments.value = nextDeleting;
  setCommentError(operationKey, "");
  try {
    await reviewCommentDelete(
      props.platform,
      props.owner,
      props.repo,
      props.prNumber,
      thread.id,
      commentId,
    );
    await reloadAfterMutation(contextKey);
  } catch (mutationError) {
    if (threadContextKey() === contextKey)
      setCommentError(operationKey, getErrorMessage(mutationError, t("review.deleteFailed")));
  } finally {
    if (threadContextKey() === contextKey) {
      const after = new Set(deletingComments.value);
      after.delete(commentId);
      deletingComments.value = after;
    }
  }
}

function navigateUnresolvedThread(direction: -1 | 1): void {
  const candidates = threads.value.filter((thread) => thread.resolved === false);
  if (candidates.length === 0) return;
  threadFilter.value = "all";
  const currentIndex = candidates.findIndex((thread) => thread.id === activeThreadId.value);
  const nextIndex =
    currentIndex < 0
      ? direction > 0
        ? 0
        : candidates.length - 1
      : (currentIndex + direction + candidates.length) % candidates.length;
  const target = candidates[nextIndex];
  activeThreadId.value = target.id;
  void nextTick(() => {
    threadElements.get(target.id)?.scrollIntoView({
      behavior: motionAwareScrollBehavior(),
      block: "center",
    });
    threadElements.get(target.id)?.focus();
  });
}

async function loadReviews(): Promise<void> {
  const sequence = ++requestSequence;
  loading.value = true;
  error.value = "";
  try {
    const [reviews, comments] = await Promise.all([
      reviewList(props.platform, props.owner, props.repo, props.prNumber),
      reviewCommentsList(props.platform, props.owner, props.repo, props.prNumber),
    ]);
    if (sequence !== requestSequence) return;
    loadedComments.value = comments;
    generalItems.value = reviews
      .filter((review) => review.body.trim().length > 0)
      .map((review) => ({
        id: `review-${review.kind}-${String(review.id)}`,
        author: review.author,
        body: review.body,
        time: review.submitted_at,
        kind: reviewKind(review),
        state: review.state,
      }))
      .sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime());
    threads.value = buildThreads(comments);
    emitSummary();
  } catch (loadError) {
    if (sequence !== requestSequence) return;
    error.value = getErrorMessage(loadError, t("review.loadFailed"));
    generalItems.value = [];
    threads.value = [];
    emitSummary();
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

async function setThreadResolved(thread: ReviewThread, resolved: boolean): Promise<void> {
  if (!props.canResolveThreads || !thread.resolvable || updatingThreads.value.has(thread.id))
    return;
  const contextKey = reviewContextKey();
  const operationKey = `${contextKey}\u0000${thread.id}`;
  const operationId = ++resolutionOperationSequence;
  activeResolutionOperations.set(operationKey, operationId);
  const request = {
    platform: props.platform,
    owner: props.owner,
    repo: props.repo,
    prNumber: props.prNumber,
  };
  const nextUpdating = new Set(updatingThreads.value);
  nextUpdating.add(thread.id);
  updatingThreads.value = nextUpdating;
  threadErrors.value = { ...threadErrors.value, [thread.id]: "" };
  try {
    await reviewThreadSetResolved(
      request.platform,
      request.owner,
      request.repo,
      request.prNumber,
      thread.id,
      resolved,
    );
    if (
      reviewContextKey() !== contextKey ||
      activeResolutionOperations.get(operationKey) !== operationId
    )
      return;
    threads.value = threads.value.map((candidate) =>
      candidate.id === thread.id
        ? {
            ...candidate,
            resolved,
            comments: candidate.comments.map((comment) => ({ ...comment, resolved })),
          }
        : candidate,
    );
    emitSummary();
  } catch (updateError) {
    if (
      reviewContextKey() !== contextKey ||
      activeResolutionOperations.get(operationKey) !== operationId
    )
      return;
    threadErrors.value = {
      ...threadErrors.value,
      [thread.id]: getErrorMessage(
        updateError,
        resolved ? t("review.resolveFailed") : t("review.reopenThreadFailed"),
      ),
    };
  } finally {
    if (activeResolutionOperations.get(operationKey) === operationId) {
      activeResolutionOperations.delete(operationKey);
      if (reviewContextKey() === contextKey) {
        const after = new Set(updatingThreads.value);
        after.delete(thread.id);
        updatingThreads.value = after;
      }
    }
  }
}

function locateThread(thread: ReviewThread): void {
  if (!thread.canNavigate) return;
  emit("locateComment", thread.locationPath, thread.canLocate ? thread.line : null, thread.side);
}

const PREVIEW_LENGTH = 180;
function needsExpand(body: string): boolean {
  return body.length > PREVIEW_LENGTH;
}

onMounted(loadReviews);
watch(
  () => [props.platform, props.owner, props.repo, props.prNumber] as const,
  () => {
    updatingThreads.value = new Set();
    threadErrors.value = {};
    replyBodies.value = {};
    editingComments.value = new Set();
    editingBodies.value = {};
    deletingComments.value = new Set();
    deleteConfirmations.value = new Set();
    commentErrors.value = {};
    activeThreadId.value = null;
    threadElements.clear();
    expandedBodies.value = new Set();
    codeExpanded.value = new Set();
    void loadReviews();
  },
);

watch(
  [() => props.diffFiles, () => props.diffPatches, () => props.headSha],
  () => {
    if (loadedComments.value.length === 0) return;
    threads.value = buildThreads(loadedComments.value);
    emitSummary();
  },
  { deep: true },
);

defineExpose({ refresh: loadReviews });
</script>

<template>
  <section class="review-list" aria-labelledby="review-list-title">
    <header class="review-list-heading">
      <div>
        <h4 id="review-list-title">{{ t("review.progress") }}</h4>
        <p>
          {{
            t("review.progressSummary", {
              overallReviews: overallReviewCount,
              generalComments: generalCommentCount,
              threads: threads.length,
              lineComments: threads.reduce((total, thread) => total + thread.comments.length, 0),
            })
          }}
        </p>
      </div>
      <button class="btn btn-sm" type="button" :disabled="loading" @click="loadReviews">
        {{ loading ? t("review.refreshing") : t("review.refresh") }}
      </button>
    </header>

    <p v-if="error" class="error-msg" role="alert">{{ error }}</p>
    <div v-if="loading && threads.length === 0 && generalItems.length === 0" class="loading-state">
      <div v-for="index in 3" :key="index" class="skeleton skeleton-review" />
    </div>

    <template v-else>
      <section
        v-if="generalItems.length > 0"
        class="review-section"
        aria-labelledby="general-review-title"
      >
        <h5 id="general-review-title">{{ t("review.generalSection") }}</h5>
        <ol class="general-review-timeline">
          <li v-for="item in generalItems" :key="item.id" class="general-review-timeline-item">
            <article class="general-review-item">
              <header class="comment-header">
                <img
                  :src="item.author.avatar_url"
                  :alt="t('review.avatarAlt', { login: item.author.login })"
                  class="avatar"
                />
                <strong>{{ item.author.login }}</strong>
                <span class="kind-badge">
                  {{
                    item.kind === "overall_review"
                      ? t("review.overallReview")
                      : t("review.generalComment")
                  }}
                </span>
                <span v-if="item.kind === 'overall_review' && item.state" class="review-state">{{
                  item.state
                }}</span>
                <time :datetime="item.time">{{
                  new Date(item.time).toLocaleString(currentLocale())
                }}</time>
              </header>
              <MarkdownRenderer
                :content="item.body"
                link-mode="emit"
                repository-references
                class="comment-body comment-markdown"
                @link-click="handleLinkClick"
              />
            </article>
          </li>
        </ol>
      </section>

      <section class="review-section" aria-labelledby="thread-list-title">
        <div class="thread-section-heading">
          <div>
            <h5 id="thread-list-title">{{ t("review.lineThreads") }}</h5>
            <span
              v-if="threads.some((thread) => thread.resolved !== null)"
              class="resolution-summary"
            >
              {{
                t("review.resolutionSummary", {
                  unresolved: unresolvedCount,
                  resolved: resolvedCount,
                })
              }}
            </span>
          </div>
          <div class="thread-filters" :aria-label="t('review.threadFilter')">
            <button
              type="button"
              :class="{ active: threadFilter === 'all' }"
              @click="threadFilter = 'all'"
            >
              {{ t("review.allThreads", { count: threads.length }) }}
            </button>
            <button
              type="button"
              :class="{ active: threadFilter === 'unresolved' }"
              @click="threadFilter = 'unresolved'"
            >
              {{ t("review.unresolvedCount", { count: unresolvedCount }) }}
            </button>
            <button
              type="button"
              :class="{ active: threadFilter === 'resolved' }"
              @click="threadFilter = 'resolved'"
            >
              {{ t("review.resolvedCount", { count: resolvedCount }) }}
            </button>
          </div>
          <div class="thread-navigation" :aria-label="t('review.unresolvedNavigation')">
            <button
              class="btn btn-sm"
              type="button"
              :disabled="unresolvedCount === 0"
              :title="t('review.previousUnresolvedTitle')"
              @click="navigateUnresolvedThread(-1)"
            >
              {{ t("review.previousUnresolved") }}
            </button>
            <button
              class="btn btn-sm"
              type="button"
              :disabled="unresolvedCount === 0"
              :title="t('review.nextUnresolvedTitle')"
              @click="navigateUnresolvedThread(1)"
            >
              {{ t("review.nextUnresolved") }}
            </button>
          </div>
        </div>

        <div v-if="threads.length === 0" class="empty-state">
          <p>{{ t("review.noThreads") }}</p>
        </div>
        <div v-else-if="filteredThreads.length === 0" class="empty-state">
          <p>{{ t("review.noFilteredThreads") }}</p>
        </div>
        <div v-else class="threads">
          <article
            v-for="thread in filteredThreads"
            :key="thread.id"
            :ref="(element) => setThreadElement(thread.id, element)"
            tabindex="-1"
            class="review-thread"
            :class="{
              outdated: threadIsOutdated(thread),
              resolved: thread.resolved === true,
              active: activeThreadId === thread.id,
            }"
          >
            <header class="thread-header">
              <div class="thread-location">
                <span class="kind-badge">{{ t("review.lineComment") }}</span>
                <button
                  type="button"
                  class="path-button"
                  :disabled="!thread.canNavigate"
                  :title="
                    thread.canLocate
                      ? t('review.locateLine')
                      : thread.canNavigate
                        ? t('review.locateFile')
                        : t('review.fileNotFound')
                  "
                  @click="locateThread(thread)"
                >
                  {{ thread.displayPath }}<template v-if="thread.line">:{{ thread.line }}</template>
                </button>
                <span v-if="threadIsOutdated(thread)" class="outdated-badge">{{
                  t("review.codeOutdated")
                }}</span>
              </div>
              <div class="thread-status-actions">
                <span v-if="thread.resolved === true" class="resolution-badge resolved">{{
                  t("review.resolved")
                }}</span>
                <span v-else-if="thread.resolved === false" class="resolution-badge unresolved">{{
                  t("review.unresolved")
                }}</span>
                <span v-else class="resolution-badge local-only">{{
                  t("review.resolutionUnavailable")
                }}</span>
                <button
                  v-if="canResolveThreads && thread.resolvable"
                  type="button"
                  class="btn btn-sm"
                  :disabled="updatingThreads.has(thread.id)"
                  @click="setThreadResolved(thread, thread.resolved !== true)"
                >
                  {{
                    updatingThreads.has(thread.id)
                      ? t("review.processing")
                      : thread.resolved === true
                        ? t("review.reopenThread")
                        : t("review.resolveThread")
                  }}
                </button>
              </div>
            </header>

            <div
              v-if="thread.diffHunk"
              class="code-context"
              :class="{ collapsed: thread.canLocate && !codeExpanded.has(thread.id) }"
            >
              <button
                v-if="thread.canLocate"
                type="button"
                class="code-hint"
                @click="toggleCode(thread.id)"
              >
                <span
                  >{{ codeExpanded.has(thread.id) ? "▾" : "▸" }}
                  {{ t("review.viewOriginalCode") }}</span
                >
                <span v-if="threadIsOutdated(thread)" class="outdated-hint">{{
                  t("review.codeLocationChanged")
                }}</span>
              </button>
              <div v-else class="code-hint original-code-hint">
                <span>{{ t("review.originalCode") }}</span>
                <span class="outdated-hint">{{ t("review.diffCannotLocate") }}</span>
              </div>
              <MiniDiffView
                v-if="!thread.canLocate || codeExpanded.has(thread.id)"
                :diff-hunk="thread.diffHunk"
                :outdated="threadIsOutdated(thread)"
                :comment-line="thread.contextLine ?? undefined"
                :comment-start-line="thread.startLine ?? undefined"
              />
            </div>
            <div v-else-if="!thread.canLocate" class="original-context-fallback">
              <strong>{{ t("review.commentCannotLocate") }}</strong>
              <span>
                {{ t("review.originalLocation") }}{{ thread.path || t("review.unknownFile")
                }}<template v-if="thread.contextLine"> :{{ thread.contextLine }}</template>
              </span>
              <span v-if="thread.comments[0]?.original_commit_id">
                {{ t("review.originalCommit") }}{{ thread.comments[0].original_commit_id }}
              </span>
              <span>{{ t("review.commentPreserved") }}</span>
            </div>

            <ol class="thread-comments">
              <li
                v-for="comment in thread.comments"
                :key="itemId(thread.id, comment)"
                :class="{ reply: comment.reply_to_id !== null }"
              >
                <header class="comment-header">
                  <img
                    :src="comment.author.avatar_url"
                    :alt="t('review.avatarAlt', { login: comment.author.login })"
                    class="avatar"
                  />
                  <strong>{{ comment.author.login }}</strong>
                  <span v-if="comment.reply_to_id !== null" class="reply-badge">{{
                    t("review.replyBadge")
                  }}</span>
                  <time :datetime="comment.created_at">{{
                    new Date(comment.created_at).toLocaleString(currentLocale())
                  }}</time>
                  <span v-if="comment.can_edit || comment.can_delete" class="comment-actions">
                    <button
                      v-if="comment.can_edit && !editingComments.has(String(comment.id))"
                      type="button"
                      class="text-button"
                      @click="beginEdit(comment)"
                    >
                      {{ t("review.edit") }}
                    </button>
                    <button
                      v-if="comment.can_delete"
                      type="button"
                      class="text-button danger"
                      :disabled="deletingComments.has(String(comment.id))"
                      @click="deleteComment(thread, comment)"
                    >
                      {{
                        deleteConfirmations.has(commentKey(thread, comment))
                          ? t("review.confirmDelete")
                          : t("review.delete")
                      }}
                    </button>
                  </span>
                </header>
                <template v-if="editingComments.has(String(comment.id))">
                  <textarea
                    v-model="editingBodies[String(comment.id)]"
                    class="input comment-editor"
                    rows="4"
                    :aria-label="t('review.editComment')"
                  />
                  <div class="comment-edit-actions">
                    <button
                      type="button"
                      class="btn btn-sm btn-primary"
                      :disabled="updatingThreads.has(`${thread.id}:${String(comment.id)}:edit`)"
                      @click="saveEdit(thread, comment)"
                    >
                      {{ t("common.save") }}
                    </button>
                    <button type="button" class="btn btn-sm" @click="cancelEdit(comment)">
                      {{ t("common.cancel") }}
                    </button>
                  </div>
                </template>
                <template v-else>
                  <MarkdownRenderer
                    :content="comment.body"
                    link-mode="emit"
                    repository-references
                    class="comment-body comment-markdown"
                    :class="{
                      'comment-body-collapsed':
                        needsExpand(comment.body) &&
                        !expandedBodies.has(itemId(thread.id, comment)),
                    }"
                    @link-click="handleLinkClick"
                  />
                  <button
                    v-if="needsExpand(comment.body)"
                    type="button"
                    class="comment-body-toggle"
                    :aria-expanded="expandedBodies.has(itemId(thread.id, comment))"
                    @click="toggleBody(itemId(thread.id, comment))"
                  >
                    {{
                      expandedBodies.has(itemId(thread.id, comment))
                        ? t("review.collapse")
                        : t("review.expand")
                    }}
                  </button>
                </template>
                <p
                  v-if="
                    commentErrors[`${thread.id}:${String(comment.id)}:edit`] ||
                    commentErrors[`${thread.id}:${String(comment.id)}:delete`]
                  "
                  class="error-msg comment-error"
                  role="alert"
                >
                  {{
                    commentErrors[`${thread.id}:${String(comment.id)}:edit`] ||
                    commentErrors[`${thread.id}:${String(comment.id)}:delete`]
                  }}
                </p>
              </li>
            </ol>
            <form class="thread-reply-form" @submit.prevent="replyToThread(thread)">
              <textarea
                v-model="replyBodies[thread.id]"
                class="input thread-reply-input"
                rows="3"
                :placeholder="t('review.replyPlaceholder')"
                :aria-label="t('review.replyThread')"
                :disabled="updatingThreads.has(`${thread.id}:reply`)"
              />
              <div class="thread-reply-actions">
                <button
                  type="submit"
                  class="btn btn-sm btn-primary"
                  :disabled="
                    updatingThreads.has(`${thread.id}:reply`) || !replyBodies[thread.id]?.trim()
                  "
                >
                  {{
                    updatingThreads.has(`${thread.id}:reply`)
                      ? t("review.replying")
                      : t("review.reply")
                  }}
                </button>
              </div>
            </form>
            <p
              v-if="commentErrors[`${thread.id}:reply`]"
              class="error-msg thread-error"
              role="alert"
            >
              {{ commentErrors[`${thread.id}:reply`] }}
            </p>
            <p v-if="threadErrors[thread.id]" class="error-msg thread-error" role="alert">
              {{ threadErrors[thread.id] }}
            </p>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped src="./ReviewList.css"></style>
