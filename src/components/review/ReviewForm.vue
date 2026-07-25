<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import type { Platform, ReviewEvent } from "@/types";
import { reviewSubmit } from "@/api";
import { getErrorMessage } from "@/utils/error";
import { useCapabilityStore } from "@/stores/useCapabilityStore";
import { useReviewDraftStore } from "@/stores/useReviewDraftStore";

const props = defineProps<{
  platform: Platform;
  owner: string;
  repo: string;
  prNumber: number;
  unviewedFileCount?: number;
  unresolvedThreadCount?: number;
}>();

const capabilities = useCapabilityStore();
const reviewDrafts = useReviewDraftStore();
const body = ref("");
const event = ref<ReviewEvent>("comment");
const submitting = ref(false);
const error = ref("");
const success = ref(false);
const confirmingPendingWork = ref(false);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const draftContext = computed(() => ({
  platform: props.platform,
  owner: props.owner,
  repo: props.repo,
  prNumber: props.prNumber,
}));
const unifiedDraftCount = computed(() => reviewDrafts.count(draftContext.value));

function loadManualDraft(): void {
  const draft = reviewDrafts
    .list(draftContext.value)
    .find((candidate) => candidate.source === "manual");
  body.value = draft?.body ?? "";
  event.value = draft?.event ?? "comment";
}

watch(() => `${props.platform}:${props.owner}:${props.repo}:${props.prNumber}`, loadManualDraft, {
  immediate: true,
});
watch([body, event], () => {
  if (!body.value.trim()) {
    reviewDrafts.remove(draftContext.value, "manual-review");
    return;
  }
  reviewDrafts.upsert(draftContext.value, {
    id: "manual-review",
    source: "manual",
    body: body.value,
    event: event.value,
    headSha: "",
    path: "",
    startLine: null,
    endLine: null,
    suggestionIndex: null,
    historyId: null,
    touchedAt: Date.now(),
  });
});

const allEvents: { value: ReviewEvent; label: string }[] = [
  { value: "comment", label: "评论" },
  { value: "approve", label: "批准" },
  { value: "request_changes", label: "请求修改" },
];
const platformCapabilities = computed(() => capabilities.values[props.platform]);
const isSupported = (candidate: ReviewEvent) =>
  platformCapabilities.value?.review_events.includes(candidate) ?? false;
watch(
  () => props.platform,
  async (platform) => {
    try {
      const loaded = await capabilities.load(platform);
      if (!loaded.review_events.includes(event.value)) event.value = "comment";
    } catch {
      // Store exposes the localized loading error; submitting remains disabled below.
    }
  },
  { immediate: true },
);

async function handleSubmit() {
  if (!body.value.trim() || !isSupported(event.value)) return;
  if (
    !confirmingPendingWork.value &&
    ((props.unviewedFileCount ?? 0) > 0 || (props.unresolvedThreadCount ?? 0) > 0)
  ) {
    confirmingPendingWork.value = true;
    return;
  }
  submitting.value = true;
  error.value = "";
  success.value = false;
  try {
    await reviewSubmit(
      props.platform,
      props.owner,
      props.repo,
      props.prNumber,
      body.value,
      event.value,
      [],
    );
    success.value = true;
    body.value = "";
    confirmingPendingWork.value = false;
  } catch (e) {
    error.value = getErrorMessage(e, "提交失败");
  } finally {
    submitting.value = false;
  }
}

function focusComposer(): void {
  textareaRef.value?.focus();
  textareaRef.value?.scrollIntoView({ block: "center" });
}

defineExpose({ focusComposer });

onUnmounted(() => reviewDrafts.flushPersistence());
</script>

<template>
  <div class="review-form">
    <h4>提交评审意见</h4>
    <p v-if="unifiedDraftCount" class="draft-summary">
      本 PR 共有 {{ unifiedDraftCount }} 条本地草稿，人工意见与 AI 建议统一保存在本机。
    </p>

    <div class="event-select">
      <button
        v-for="ev in allEvents"
        :key="ev.value"
        :class="{ active: event === ev.value }"
        :disabled="!isSupported(ev.value)"
        :title="isSupported(ev.value) ? undefined : '当前平台不支持此评审操作'"
        @click="event = ev.value"
      >
        {{ ev.label }}
      </button>
    </div>

    <textarea
      ref="textareaRef"
      v-model="body"
      class="input"
      placeholder="输入你的评审意见..."
      rows="5"
    />

    <div class="form-actions">
      <button
        class="btn btn-primary"
        :disabled="submitting || !body.trim() || !isSupported(event)"
        @click="handleSubmit"
      >
        {{ submitting ? "提交中..." : confirmingPendingWork ? "仍然提交" : "提交评审" }}
      </button>
      <span v-if="success" class="success-msg">✓ 评审已提交</span>
      <span v-if="error || capabilities.errors[platform]" class="error-msg">{{
        error || capabilities.errors[platform]
      }}</span>
    </div>
    <p v-if="confirmingPendingWork" class="pending-review-warning" role="alert">
      <template v-if="unviewedFileCount">还有 {{ unviewedFileCount }} 个文件未查看。</template>
      <template v-if="unviewedFileCount && unresolvedThreadCount"> </template>
      <template v-if="unresolvedThreadCount"
        >还有 {{ unresolvedThreadCount }} 个未解决线程。</template
      >
      再次点击“仍然提交”继续。
    </p>
  </div>
</template>

<style scoped src="./ReviewForm.css"></style>
