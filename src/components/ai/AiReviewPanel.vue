<script setup lang="ts">
import { computed, ref, onUnmounted, watch } from "vue";
import { storeToRefs } from "pinia";
import type {
  Platform,
  AiReviewFocus,
  AiReviewHistoryEntry,
  AiReviewMode,
  AiReviewLanguage,
  AiReviewLanguagePreference,
  AiReviewResult,
  AiSuggestion,
  PrContext,
  AiSuggestionAction,
  AiStreamEvent,
  CommandErrorPayload,
} from "@/types";
import {
  aiReview,
  aiReviewCancel,
  aiGetConfig,
  aiReviewStream,
  prCompareDiff,
  prDetail,
  prDiff,
  reviewCommentAdd,
  reviewSubmit,
} from "@/api";
import { normalizeApiError, type ApiError } from "@/api/errors";
import { discoverAiRepositoryRules, type DiscoveredAiRules } from "@/services/aiRepositoryRules";
import { getErrorMessage } from "@/utils/error";
import { draftPositionIsCurrent } from "@/utils/aiReviewDraft";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import AiSuggestionCard from "./AiSuggestionCard.vue";
import AppSelect from "@/components/shared/AppSelect.vue";
import {
  appendAiReviewHistory,
  loadAiReviewHistory,
  loadRepositoryRules,
  saveRepositoryRules,
  updateAiReviewHistoryResult,
} from "@/services/aiReviewPersistence";
import { useReviewDraftStore, type UnifiedReviewDraft } from "@/stores/useReviewDraftStore";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";
import { useI18n } from "@/i18n";

const props = defineProps<{
  platform: Platform;
  owner: string;
  repo: string;
  prNumber: number;
  diff: string;
  context: PrContext | null;
  headSha: string;
  supportsCompareDiff: boolean;
}>();

const emit = defineEmits<{
  locateSuggestion: [suggestion: AiSuggestion];
}>();

const { locale, t } = useI18n();
const uiSettings = useUiSettingsStore();
const { aiReviewLanguagePreference } = storeToRefs(uiSettings);
const reviewLanguageChanged = ref(false);
const reviewLanguagePreference = computed<AiReviewLanguagePreference>({
  get: () => aiReviewLanguagePreference.value,
  set: (value) => {
    if (value === aiReviewLanguagePreference.value) return;
    uiSettings.setAiReviewLanguagePreference(value);
    reviewLanguageChanged.value = true;
  },
});
const effectiveReviewLanguage = computed<AiReviewLanguage>(() =>
  reviewLanguagePreference.value === "auto" ? locale.value : reviewLanguagePreference.value,
);
const reviewLanguages = computed(() => [
  { value: "auto", label: t("language.followInterface") },
  { value: "zh-CN", label: t("language.chinese") },
  { value: "en-US", label: t("language.english") },
]);
function languageLabel(language: AiReviewLanguage): string {
  return t(language === "zh-CN" ? "language.chinese" : "language.english");
}

const focus = ref<AiReviewFocus>("all");
const reviewMode = ref<AiReviewMode>("full");
const useStreaming = ref(true);
const loading = ref(false);
const error = ref("");
const errorDetails = ref<ApiError | null>(null);
const reviewStatus = ref("");
const result = ref<AiReviewResult | null>(null);
const resultHeadSha = ref("");
const resultFocus = ref<AiReviewFocus | null>(null);
const resultMode = ref<AiReviewMode>("full");
const resultBaseSha = ref("");
const resultModel = ref("");
const resultTruncated = ref(false);
const resultLanguage = ref<AiReviewLanguage>(effectiveReviewLanguage.value);
const currentHistoryId = ref("");
const isResultOutdated = computed(
  () => !!result.value && !!resultHeadSha.value && resultHeadSha.value !== props.headSha,
);

const reviewStorageKey = computed(
  () =>
    `mergebeacon:ai-review-head:${props.platform}:${encodeURIComponent(props.owner)}:${encodeURIComponent(props.repo)}:${props.prNumber}`,
);

function loadLastSuccessfulHeadSha(): string {
  try {
    return localStorage.getItem(reviewStorageKey.value) ?? "";
  } catch {
    return "";
  }
}

const lastSuccessfulHeadSha = ref(loadLastSuccessfulHeadSha());
const repositoryRules = ref(
  loadRepositoryRules({ platform: props.platform, owner: props.owner, repo: props.repo }),
);
const discoveredRules = ref<DiscoveredAiRules | null>(null);
const rulesStatus = ref("");
const history = ref<AiReviewHistoryEntry[]>(
  loadAiReviewHistory({
    platform: props.platform,
    owner: props.owner,
    repo: props.repo,
    prNumber: props.prNumber,
  }),
);
const hasIncrementalBase = computed(
  () =>
    props.supportsCompareDiff &&
    !!lastSuccessfulHeadSha.value &&
    lastSuccessfulHeadSha.value !== props.headSha,
);
const incrementalDisabledReason = computed(() => {
  if (!props.supportsCompareDiff) return t("ai.compareUnavailable");
  if (!lastSuccessfulHeadSha.value) return t("ai.incrementalNoBase");
  if (lastSuccessfulHeadSha.value === props.headSha) return t("ai.incrementalNoChanges");
  return "";
});
const canStartReview = computed(
  () => !!props.diff && (reviewMode.value === "full" || hasIncrementalBase.value),
);

function saveLastSuccessfulHeadSha(headSha: string, storageKey = reviewStorageKey.value) {
  if (storageKey === reviewStorageKey.value) lastSuccessfulHeadSha.value = headSha;
  try {
    localStorage.setItem(storageKey, headSha);
  } catch {
    // 本地存储不可用时保留内存状态，不影响当前评审。
  }
}

type ReviewDraft = UnifiedReviewDraft & { source: "ai"; suggestionIndex: number };

const reviewDrafts = useReviewDraftStore();
const reviewReference = computed(() => ({
  platform: props.platform,
  owner: props.owner,
  repo: props.repo,
  prNumber: props.prNumber,
}));
function loadAiDrafts(): ReviewDraft[] {
  return reviewDrafts
    .list(reviewReference.value)
    .filter(
      (draft): draft is ReviewDraft => draft.source === "ai" && draft.suggestionIndex !== null,
    )
    .map((draft) => ({ ...draft }));
}
const drafts = ref<ReviewDraft[]>(loadAiDrafts());
watch(drafts, (value) => reviewDrafts.replaceSource(reviewReference.value, "ai", value), {
  deep: true,
});
const submittingDrafts = ref(false);
const draftStatus = ref("");
const draftError = ref("");

const streamReceivedData = ref(false);
const streamStatusText = computed(() =>
  streamReceivedData.value ? t("ai.streamingSummary") : t("ai.connecting"),
);
let unlistenChunk: UnlistenFn | null = null;
let unlistenDone: UnlistenFn | null = null;
let unlistenError: UnlistenFn | null = null;
let activeRequestId: string | null = null;
let activeReviewHeadSha = "";
let activeReviewFocus: AiReviewFocus | null = null;
let activeReviewDiff = "";
let activeReviewContext: PrContext | null = null;
let activeReviewMode: AiReviewMode = "full";
let activeReviewBaseSha = "";
let activeReviewModel = t("common.unknownModel");
let activeReviewTruncated = false;
let activeReviewLanguage: AiReviewLanguage = effectiveReviewLanguage.value;
let activeReviewStorageKey = "";
let historySequence = 0;
let reviewSequence = 0;
let disposed = false;
let resultPersistenceTimer: ReturnType<typeof setTimeout> | null = null;
let rulesRequestSequence = 0;

const foci = computed<{ value: AiReviewFocus; label: string }[]>(() => [
  { value: "all", label: t("ai.focusAll") },
  { value: "security", label: t("ai.focusSecurity") },
  { value: "performance", label: t("ai.focusPerformance") },
  { value: "logic", label: t("ai.focusLogic") },
  { value: "code_style", label: t("ai.focusStyle") },
]);

const reviewModes = computed(() => [
  { value: "full", label: t("ai.reviewFull") },
  {
    value: "incremental",
    label: t("ai.incremental"),
    disabled: !hasIncrementalBase.value,
  },
]);

watch(
  () => `${props.platform}:${props.owner}:${props.repo}:${props.prNumber}`,
  () => {
    repositoryRules.value = loadRepositoryRules(reviewReference.value);
    history.value = loadAiReviewHistory(reviewReference.value);
    currentHistoryId.value = "";
    rulesStatus.value = "";
    drafts.value = loadAiDrafts();
    restoreDraftHistory();
  },
);

watch(
  () => `${props.platform}:${props.owner}:${props.repo}:${props.prNumber}:${props.headSha}`,
  async () => {
    const sequence = ++rulesRequestSequence;
    discoveredRules.value = null;
    if (!props.headSha) return;
    try {
      const discovered = await discoverAiRepositoryRules({
        platform: props.platform,
        owner: props.owner,
        repo: props.repo,
        revision: props.headSha,
      });
      if (sequence === rulesRequestSequence && !disposed) discoveredRules.value = discovered;
    } catch (cause) {
      if (sequence === rulesRequestSequence && !disposed) {
        rulesStatus.value = t("ai.repositoryRulesAutoFailed", {
          message: getErrorMessage(cause, t("common.unknownError")),
        });
      }
    }
  },
  { immediate: true },
);

function saveRules(): void {
  repositoryRules.value = saveRepositoryRules(reviewReference.value, repositoryRules.value);
  rulesStatus.value = repositoryRules.value
    ? t("ai.repositoryRulesSaved")
    : t("ai.repositoryRulesCleared");
}

function reviewContextWithRules(context: PrContext | null): PrContext | null {
  const rules = [
    discoveredRules.value
      ? `${t("ai.rulesRepositoryLabel", { path: discoveredRules.value.path })}\n${discoveredRules.value.content}`
      : "",
    repositoryRules.value.trim()
      ? `${t("ai.rulesLocalLabel")}\n${repositoryRules.value.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!context && !rules) return null;
  return {
    title: context?.title ?? "",
    body: context?.body ?? "",
    repository_rules: rules || null,
  };
}

function cloneResult(reviewResult: AiReviewResult): AiReviewResult {
  return JSON.parse(JSON.stringify(reviewResult)) as AiReviewResult;
}

interface ReviewResultMetadata {
  headSha: string;
  baseSha: string;
  focus: AiReviewFocus | null;
  mode: AiReviewMode;
  model: string;
  truncated: boolean;
  language: AiReviewLanguage;
}

function recordSuccessfulReview(
  reviewResult: AiReviewResult,
  metadata: ReviewResultMetadata,
): void {
  const createdAt = Date.now();
  const entry: AiReviewHistoryEntry = {
    id: `${metadata.headSha}:${createdAt}:${historySequence++}`,
    created_at: createdAt,
    head_sha: metadata.headSha,
    base_sha: metadata.baseSha || null,
    focus: metadata.focus ?? "all",
    mode: metadata.mode,
    model: metadata.model,
    truncated: metadata.truncated,
    language: metadata.language,
    result: cloneResult(reviewResult),
  };
  history.value = appendAiReviewHistory(reviewReference.value, entry);
  currentHistoryId.value = entry.id;
}

function persistCurrentResult(): void {
  if (!result.value || !currentHistoryId.value) return;
  history.value = updateAiReviewHistoryResult(
    reviewReference.value,
    currentHistoryId.value,
    cloneResult(result.value),
  );
}

function scheduleCurrentResultPersistence(): void {
  if (resultPersistenceTimer) clearTimeout(resultPersistenceTimer);
  resultPersistenceTimer = setTimeout(() => {
    resultPersistenceTimer = null;
    persistCurrentResult();
  }, 300);
}

function loadHistoryEntry(entry: AiReviewHistoryEntry): void {
  const draftHistoryIds = new Set(drafts.value.map((draft) => draft.historyId).filter(Boolean));
  if (drafts.value.length > 0 && !draftHistoryIds.has(entry.id)) {
    draftError.value = t("ai.draftCannotSwitchHistory");
    return;
  }
  result.value = cloneResult(entry.result);
  resultHeadSha.value = entry.head_sha;
  resultFocus.value = entry.focus;
  resultMode.value = entry.mode;
  resultBaseSha.value = entry.base_sha ?? "";
  resultModel.value = entry.model;
  resultTruncated.value = entry.truncated;
  resultLanguage.value = entry.language;
  currentHistoryId.value = entry.id;
  draftError.value = "";
}

function restoreDraftHistory(): void {
  const historyId = drafts.value[0]?.historyId;
  if (!historyId) return;
  const entry = history.value.find((candidate) => candidate.id === historyId);
  if (entry) loadHistoryEntry(entry);
}

restoreDraftHistory();

async function startReview() {
  if (drafts.value.length > 0) {
    draftError.value = t("ai.draftExisting");
    return;
  }
  if (!props.diff) {
    error.value = t("ai.noDiff");
    return;
  }
  if (!props.headSha) {
    error.value = t("ai.noRevision");
    return;
  }
  if (reviewMode.value === "incremental" && !hasIncrementalBase.value) {
    error.value = incrementalDisabledReason.value || t("ai.incrementalUnavailable");
    return;
  }
  reviewLanguageChanged.value = false;

  const sequence = ++reviewSequence;
  const reviewPlatform = props.platform;
  const reviewOwner = props.owner;
  const reviewRepo = props.repo;
  const reviewStorageKeySnapshot = reviewStorageKey.value;
  const reviewHeadSha = props.headSha;
  const reviewDiff = props.diff;
  const reviewContext = reviewContextWithRules(props.context);
  const reviewLanguage = effectiveReviewLanguage.value;

  await cancelActiveReview();
  if (disposed || sequence !== reviewSequence) return;
  cleanupListeners();
  loading.value = true;
  error.value = "";
  errorDetails.value = null;
  reviewStatus.value = "";
  draftError.value = "";
  streamReceivedData.value = false;
  activeReviewHeadSha = reviewHeadSha;
  activeReviewStorageKey = reviewStorageKeySnapshot;
  activeReviewFocus = focus.value;
  activeReviewContext = reviewContext;
  activeReviewMode = reviewMode.value;
  activeReviewBaseSha = reviewMode.value === "incremental" ? lastSuccessfulHeadSha.value : "";
  activeReviewLanguage = reviewLanguage;
  activeReviewModel = t("common.unknownModel");
  try {
    activeReviewModel = (await aiGetConfig()).model || t("common.unknownModel");
  } catch {
    // Model metadata is informative and must not block a configured review request.
  }
  if (disposed || sequence !== reviewSequence) return;

  try {
    if (activeReviewMode === "incremental") {
      const compared = await prCompareDiff(
        reviewPlatform,
        reviewOwner,
        reviewRepo,
        activeReviewBaseSha,
        activeReviewHeadSha,
      );
      if (!compared.diff.trim()) {
        throw new Error(t("ai.incrementalEmpty"));
      }
      activeReviewDiff = compared.diff;
    } else {
      activeReviewDiff = reviewDiff;
    }
  } catch (e) {
    if (disposed || sequence !== reviewSequence) return;
    loading.value = false;
    error.value = getErrorMessage(e, t("ai.incrementalCompareFailed"));
    return;
  }
  if (disposed || sequence !== reviewSequence) return;
  activeReviewTruncated = new TextEncoder().encode(activeReviewDiff).length > 65_536;
  result.value = null;
  resultHeadSha.value = "";
  resultFocus.value = null;
  resultMode.value = activeReviewMode;
  resultBaseSha.value = activeReviewBaseSha;
  resultModel.value = activeReviewModel;
  resultTruncated.value = activeReviewTruncated;
  resultLanguage.value = activeReviewLanguage;
  currentHistoryId.value = "";

  if (useStreaming.value) {
    await startStreamingReview(sequence);
  } else {
    await startNonStreamingReview(sequence);
  }
}

defineExpose({ startReview });

async function startNonStreamingReview(sequence: number) {
  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  const metadata: ReviewResultMetadata = {
    headSha: activeReviewHeadSha,
    baseSha: activeReviewBaseSha,
    focus: activeReviewFocus,
    mode: activeReviewMode,
    model: activeReviewModel,
    truncated: activeReviewTruncated,
    language: activeReviewLanguage,
  };
  const storageKey = activeReviewStorageKey;
  const diff = activeReviewDiff;
  const context = activeReviewContext;
  try {
    const reviewResult = await aiReview(requestId, {
      diff,
      context,
      file_filter: null,
      focus: metadata.focus,
      language: metadata.language,
    });
    if (!reviewResult || disposed || sequence !== reviewSequence || activeRequestId !== requestId) {
      return;
    }
    result.value = reviewResult;
    resultHeadSha.value = metadata.headSha;
    resultFocus.value = metadata.focus;
    resultMode.value = metadata.mode;
    resultBaseSha.value = metadata.baseSha;
    resultModel.value = metadata.model;
    resultTruncated.value = metadata.truncated;
    resultLanguage.value = metadata.language;
    saveLastSuccessfulHeadSha(metadata.headSha, storageKey);
    recordSuccessfulReview(result.value, metadata);
  } catch (e) {
    if (disposed || sequence !== reviewSequence || activeRequestId !== requestId) return;
    errorDetails.value = normalizeApiError(e);
    error.value = getErrorMessage(errorDetails.value, t("ai.reviewFailed"));
  } finally {
    if (sequence === reviewSequence && activeRequestId === requestId) {
      activeRequestId = null;
      loading.value = false;
    }
  }
}

async function startStreamingReview(sequence: number) {
  const requestId = crypto.randomUUID();
  activeRequestId = requestId;
  try {
    const chunkUnlisten = await listen<AiStreamEvent<string>>("ai-review-chunk", (event) => {
      if (event.payload.request_id !== activeRequestId) return;
      streamReceivedData.value = true;
    });
    if (disposed || sequence !== reviewSequence || activeRequestId !== requestId) {
      chunkUnlisten();
      return;
    }
    unlistenChunk = chunkUnlisten;

    const doneUnlisten = await listen<AiStreamEvent<AiReviewResult>>("ai-review-done", (event) => {
      if (event.payload.request_id !== activeRequestId) return;
      result.value = event.payload.payload;
      resultHeadSha.value = activeReviewHeadSha;
      resultFocus.value = activeReviewFocus;
      resultMode.value = activeReviewMode;
      resultBaseSha.value = activeReviewBaseSha;
      resultModel.value = activeReviewModel;
      resultTruncated.value = activeReviewTruncated;
      resultLanguage.value = activeReviewLanguage;
      saveLastSuccessfulHeadSha(activeReviewHeadSha, activeReviewStorageKey);
      recordSuccessfulReview(result.value, {
        headSha: activeReviewHeadSha,
        baseSha: activeReviewBaseSha,
        focus: activeReviewFocus,
        mode: activeReviewMode,
        model: activeReviewModel,
        truncated: activeReviewTruncated,
        language: activeReviewLanguage,
      });
      activeRequestId = null;
      loading.value = false;
      cleanupListeners();
    });
    if (disposed || sequence !== reviewSequence || activeRequestId !== requestId) {
      doneUnlisten();
      return;
    }
    unlistenDone = doneUnlisten;

    const errorUnlisten = await listen<AiStreamEvent<CommandErrorPayload | string>>(
      "ai-review-error",
      (event) => {
        if (event.payload.request_id !== activeRequestId) return;
        errorDetails.value = normalizeApiError(event.payload.payload);
        error.value = errorDetails.value.message;
        activeRequestId = null;
        loading.value = false;
        cleanupListeners();
      },
    );
    if (disposed || sequence !== reviewSequence || activeRequestId !== requestId) {
      errorUnlisten();
      return;
    }
    unlistenError = errorUnlisten;

    await aiReviewStream(requestId, {
      diff: activeReviewDiff,
      context: activeReviewContext,
      file_filter: null,
      focus: activeReviewFocus,
      language: activeReviewLanguage,
    });
  } catch (e) {
    if (activeRequestId === requestId) {
      activeRequestId = null;
      errorDetails.value = normalizeApiError(e);
      error.value = getErrorMessage(errorDetails.value, t("ai.streamStartFailed"));
      loading.value = false;
      cleanupListeners();
    }
  }
}

async function cancelActiveReview() {
  const requestId = activeRequestId;
  // Invalidate late events immediately; backend cancellation is best-effort and is not retried.
  activeRequestId = null;
  if (!requestId) return;
  try {
    await aiReviewCancel(requestId);
  } catch {
    // Cancellation is best-effort and must not be presented as an AI review error.
  }
}

async function interruptReview() {
  if (!loading.value) return;
  reviewSequence += 1;
  loading.value = false;
  streamReceivedData.value = false;
  error.value = "";
  errorDetails.value = null;
  reviewStatus.value = t("ai.reviewInterrupted");
  const cancellation = cancelActiveReview();
  cleanupListeners();
  await cancellation;
}

function cleanupListeners() {
  unlistenChunk?.();
  unlistenDone?.();
  unlistenError?.();
  unlistenChunk = null;
  unlistenDone = null;
  unlistenError = null;
}

onUnmounted(() => {
  disposed = true;
  reviewSequence += 1;
  if (resultPersistenceTimer) {
    clearTimeout(resultPersistenceTimer);
    resultPersistenceTimer = null;
    persistCurrentResult();
  }
  reviewDrafts.flushPersistence();
  void cancelActiveReview().finally(cleanupListeners);
});

function draftBody(index: number): string {
  const suggestion = result.value?.suggestions[index];
  if (!suggestion) return "";
  return suggestion.suggestion
    ? `${suggestion.description}\n\n${t("ai.draftSuggestion")}\n${suggestion.suggestion}`
    : suggestion.description;
}

function onAction(index: number, action: AiSuggestionAction) {
  if (!result.value || isResultOutdated.value) return;
  if (action === "reject") {
    result.value.suggestions[index].action = action;
    drafts.value = drafts.value.filter((draft) => draft.suggestionIndex !== index);
    persistCurrentResult();
    return;
  }

  const suggestion = result.value.suggestions[index];
  if (!drafts.value.some((draft) => draft.suggestionIndex === index)) {
    drafts.value.push({
      id: `${resultHeadSha.value}:${index}`,
      source: "ai",
      suggestionIndex: index,
      path: suggestion.file,
      startLine: suggestion.line_start,
      endLine: suggestion.line_end ?? suggestion.line_start,
      body: draftBody(index),
      headSha: resultHeadSha.value,
      event: "comment",
      historyId: currentHistoryId.value || null,
      touchedAt: Date.now(),
    });
  }
  suggestion.action = typeof action === "object" ? { edit: draftBody(index) } : "accept";
  draftStatus.value = "";
  draftError.value = "";
  persistCurrentResult();
}

function removeDraft(index: number) {
  const [removed] = drafts.value.splice(index, 1);
  if (removed && result.value?.suggestions[removed.suggestionIndex]) {
    result.value.suggestions[removed.suggestionIndex].action = undefined;
    persistCurrentResult();
  }
}

function recordDraftEdit(draft: ReviewDraft): void {
  draft.touchedAt = Date.now();
  const suggestion = result.value?.suggestions[draft.suggestionIndex];
  if (!suggestion) return;
  suggestion.action = draft.body.trim() ? { edit: draft.body } : "accept";
  scheduleCurrentResultPersistence();
}

async function validateDraftsAgainstCurrentRevision(): Promise<boolean> {
  try {
    const latestDetail = await prDetail(props.platform, props.owner, props.repo, props.prNumber);
    if (
      latestDetail.head_sha !== props.headSha ||
      drafts.value.some((draft) => draft.headSha !== latestDetail.head_sha)
    ) {
      draftError.value = t("ai.draftRevisionFailed");
      return false;
    }
    const inlineDrafts = drafts.value.filter((draft) => draft.path && draft.endLine);
    if (inlineDrafts.length === 0) return true;
    const latestDiff = await prDiff(props.platform, props.owner, props.repo, props.prNumber);
    const invalidDraft = inlineDrafts.find(
      (draft) => !draftPositionIsCurrent(draft, latestDiff.patches),
    );
    if (invalidDraft) {
      draftError.value = t("ai.draftInvalidPosition", {
        position: `${invalidDraft.path}:${invalidDraft.endLine}`,
      });
      return false;
    }
    return true;
  } catch (cause) {
    draftError.value = t("ai.draftValidationFailed", {
      message: getErrorMessage(cause, t("ai.draftLatestUnavailable")),
    });
    return false;
  }
}

async function submitDrafts() {
  if (submittingDrafts.value || drafts.value.length === 0) return;
  if (drafts.value.some((draft) => draft.headSha !== props.headSha)) {
    draftError.value = t("ai.draftOutdated");
    return;
  }
  if (drafts.value.some((draft) => !draft.body.trim())) {
    draftError.value = t("ai.draftEmpty");
    return;
  }
  if (!(await validateDraftsAgainstCurrentRevision())) return;

  submittingDrafts.value = true;
  draftStatus.value = "";
  draftError.value = "";
  const failed: ReviewDraft[] = [];
  const submittedSuggestionIndexes: number[] = [];
  let submitted = 0;
  let firstError = "";
  for (const draft of drafts.value) {
    try {
      if (draft.path && draft.endLine && draft.endLine > 0) {
        await reviewCommentAdd(
          props.platform,
          props.owner,
          props.repo,
          props.prNumber,
          draft.headSha,
          draft.path,
          draft.startLine && draft.startLine !== draft.endLine ? draft.startLine : null,
          draft.endLine,
          "right",
          draft.body.trim(),
        );
      } else {
        await reviewSubmit(
          props.platform,
          props.owner,
          props.repo,
          props.prNumber,
          draft.body.trim(),
          "comment",
          [],
        );
      }
      submitted++;
      submittedSuggestionIndexes.push(draft.suggestionIndex);
    } catch (cause) {
      failed.push(draft);
      if (!firstError) firstError = getErrorMessage(cause, t("ai.draftSubmitFailed"));
    }
  }
  drafts.value = failed;
  for (const suggestionIndex of submittedSuggestionIndexes) {
    if (result.value?.suggestions[suggestionIndex]) {
      result.value.suggestions[suggestionIndex].action = "submitted";
    }
  }
  persistCurrentResult();
  submittingDrafts.value = false;
  if (failed.length > 0) {
    draftError.value = t("ai.draftPartialFailure", {
      submitted,
      failed: failed.length,
      message: firstError,
    });
  } else {
    draftStatus.value = t("ai.draftSubmitSuccess", { count: submitted });
  }
}
</script>

<template>
  <div class="ai-panel">
    <div class="ai-toolbar">
      <div class="review-mode-select">
        <label for="ai-review-mode">{{ t("ai.range") }}:</label>
        <div class="review-mode-control">
          <AppSelect
            id="ai-review-mode"
            v-model="reviewMode"
            class="toolbar-select"
            size="sm"
            :options="reviewModes"
          />
        </div>
      </div>
      <div v-if="!hasIncrementalBase" class="incremental-hint" role="status">
        {{ t("ai.incrementalHint", { reason: incrementalDisabledReason }) }}
      </div>
      <div class="focus-select">
        <label for="ai-review-focus">{{ t("ai.category") }}:</label>
        <div class="focus-control">
          <AppSelect
            id="ai-review-focus"
            v-model="focus"
            class="toolbar-select"
            size="sm"
            :options="foci"
          />
        </div>
      </div>

      <div class="focus-select review-language-select">
        <label for="ai-review-language">{{ t("language.review") }}:</label>
        <div class="focus-control review-language-control">
          <AppSelect
            id="ai-review-language"
            v-model="reviewLanguagePreference"
            class="toolbar-select"
            size="sm"
            :options="reviewLanguages"
          />
        </div>
        <span
          v-if="reviewLanguageChanged"
          class="review-language-status"
          role="status"
          aria-live="polite"
        >
          {{ t("ai.reviewLanguageChanged") }}
        </span>
      </div>

      <label class="stream-toggle" :title="t('ai.streamingHint')">
        <input type="checkbox" v-model="useStreaming" :disabled="loading" />
        {{ t("ai.streaming") }}
      </label>

      <div class="review-actions">
        <button
          class="btn btn-primary"
          :disabled="(loading && !useStreaming) || !canStartReview"
          @click="startReview"
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
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          {{
            loading
              ? useStreaming
                ? t("ai.reviewRestart")
                : t("ai.reviewing")
              : t("ai.reviewStart")
          }}
        </button>
        <button
          v-if="loading"
          type="button"
          class="btn ai-interrupt-button"
          data-testid="interrupt-ai-review"
          @click="interruptReview"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="1" />
          </svg>
          {{ t("ai.reviewInterrupt") }}
        </button>
      </div>
    </div>

    <div class="ai-context-tools">
      <details class="repository-rules">
        <summary>{{ t("ai.repositoryRules") }}</summary>
        <p>{{ t("ai.repositoryRulesDescription") }}</p>
        <div v-if="discoveredRules" class="discovered-rules" role="status">
          <span>{{ t("ai.discoveredRules") }}</span>
          <code>{{ discoveredRules.path }}</code>
          <pre>{{ discoveredRules.content }}</pre>
        </div>
        <textarea
          v-model="repositoryRules"
          class="input"
          rows="4"
          maxlength="12000"
          :placeholder="t('ai.repositoryRulesPlaceholder')"
          :aria-label="t('ai.repositoryRulesAria')"
          @input="rulesStatus = ''"
        />
        <div class="rules-actions">
          <button class="btn btn-sm" type="button" @click="saveRules">
            {{ t("ai.saveRules") }}
          </button>
          <span v-if="rulesStatus" role="status">{{ rulesStatus }}</span>
        </div>
      </details>

      <details v-if="history.length > 0" class="review-history">
        <summary>{{ t("ai.history", { count: history.length }) }}</summary>
        <div class="history-list">
          <button
            v-for="entry in history"
            :key="entry.id"
            type="button"
            class="history-entry"
            :class="{ active: entry.id === currentHistoryId }"
            @click="loadHistoryEntry(entry)"
          >
            <span
              ><code>{{ entry.head_sha.slice(0, 12) }}</code> · {{ entry.model }} ·
              {{ languageLabel(entry.language) }}</span
            >
            <small>{{ new Date(entry.created_at).toLocaleString() }}</small>
          </button>
        </div>
      </details>
    </div>

    <!-- Streaming progress: keep the transport detail out of the user-facing review UI. -->
    <div v-if="loading && useStreaming" class="stream-preview" role="status" aria-live="polite">
      <div class="stream-label">
        <span class="stream-dot" />
        {{ streamStatusText }}
      </div>
      <div class="stream-progress" aria-hidden="true">
        <span :class="{ active: streamReceivedData }" />
      </div>
      <p class="stream-hint">{{ t("ai.progressHint") }}</p>
    </div>

    <!-- Non-streaming loading -->
    <div v-if="loading && !useStreaming" class="loading-state">
      <div class="spinner" />
      <p>{{ t("ai.loading") }}</p>
    </div>

    <div v-if="error" class="error-box">
      {{ error }}
    </div>

    <p v-if="reviewStatus" class="review-status" role="status" aria-live="polite">
      {{ reviewStatus }}
    </p>

    <div v-if="result" class="ai-result">
      <div v-if="isResultOutdated" class="outdated-warning" role="alert">
        {{ t("ai.outdated") }}
      </div>
      <div class="review-metadata">
        <span
          >{{ t("ai.resultVersion") }}<code>{{ resultHeadSha.slice(0, 12) }}</code></span
        >
        <span>{{
          t("ai.resultRange", {
            range: t(resultMode === "incremental" ? "ai.fullAfterIncremental" : "ai.reviewFull"),
          })
        }}</span>
        <span v-if="resultBaseSha"
          >{{ t("ai.versionBase") }} <code>{{ resultBaseSha.slice(0, 12) }}</code></span
        >
        <span v-if="resultFocus">{{
          t("ai.focusMetadata", {
            focus: foci.find((item) => item.value === resultFocus)?.label ?? "",
          })
        }}</span>
        <span>{{ t("ai.model", { model: resultModel || t("common.unknownModel") }) }}</span>
        <span>{{ t("ai.resultLanguage", { language: languageLabel(resultLanguage) }) }}</span>
        <span>{{
          t("ai.inputState", {
            state: t(resultTruncated ? "ai.diffTruncated" : "ai.diffComplete"),
          })
        }}</span>
      </div>
      <div class="summary-card">
        <h4>
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
            <path d="M12 2a4 4 0 0 1 4 4c0 2-2 4-4 4s-4-2-4-4a4 4 0 0 1 4-4z" />
            <path d="M12 14c-4.42 0-8 1.79-8 4v2h16v-2c0-2.21-3.58-4-8-4z" />
          </svg>
          {{ t("ai.resultOverview") }}
        </h4>
        <p>{{ result.summary }}</p>
      </div>

      <div v-if="result.suggestions.length > 0" class="suggestions">
        <h4>{{ t("ai.suggestionCount", { count: result.suggestions.length }) }}</h4>
        <AiSuggestionCard
          v-for="(s, idx) in result.suggestions"
          :key="idx"
          :suggestion="s"
          :disabled="isResultOutdated"
          @action="(a: AiSuggestionAction) => onAction(idx, a)"
          @locate="emit('locateSuggestion', s)"
        />
      </div>

      <section v-if="drafts.length > 0" class="draft-panel">
        <div class="draft-header">
          <div>
            <h4>{{ t("ai.draftPanel") }}</h4>
            <p>{{ t("ai.draftIntro", { platform }) }}</p>
          </div>
          <button
            class="btn btn-primary"
            :disabled="submittingDrafts || isResultOutdated"
            @click="submitDrafts"
          >
            {{
              submittingDrafts
                ? t("ai.draftSubmitting")
                : t("ai.draftSubmit", { count: drafts.length })
            }}
          </button>
        </div>
        <article v-for="(draft, index) in drafts" :key="draft.id" class="draft-item">
          <div class="draft-location">
            <span v-if="draft.path">
              {{ draft.path
              }}<template v-if="draft.endLine"
                >:{{ draft.startLine ?? draft.endLine
                }}<template v-if="draft.startLine && draft.startLine !== draft.endLine"
                  >-{{ draft.endLine }}</template
                ></template
              >
            </span>
            <span v-else>{{ t("ai.draftGlobal") }}</span>
            <button class="btn btn-sm" :disabled="submittingDrafts" @click="removeDraft(index)">
              {{ t("common.remove") }}
            </button>
          </div>
          <textarea
            v-model="draft.body"
            class="input"
            rows="5"
            :aria-label="t('ai.draftBody')"
            @input="recordDraftEdit(draft)"
          />
        </article>
      </section>

      <p v-if="draftStatus" class="draft-success" role="status">{{ draftStatus }}</p>
      <p v-if="draftError" class="error-box" role="alert">{{ draftError }}</p>

      <div v-if="result.suggestions.length === 0" class="no-issues">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        <p>{{ t("ai.noIssues") }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped src="./AiReviewPanel.css"></style>
