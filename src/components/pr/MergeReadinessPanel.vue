<script setup lang="ts">
import { computed } from "vue";
import type { PrMergeReadiness, ReadinessState } from "@/types";

const props = defineProps<{
  readiness: PrMergeReadiness | null;
  loading: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ retry: [] }>();

const stateLabels: Record<ReadinessState, string> = {
  ready: "可合并",
  blocked: "已阻断",
  pending: "检查中",
  unknown: "状态未知",
};
const stateIcons: Record<ReadinessState, string> = {
  ready: "✓",
  blocked: "!",
  pending: "…",
  unknown: "?",
};
const state = computed<ReadinessState>(
  () => props.readiness?.status ?? (props.error ? "unknown" : "pending"),
);
const stateLabel = computed(() => stateLabels[state.value]);
const stateIcon = computed(() => stateIcons[state.value]);

const statusDetails = computed(() => {
  if (props.error && !props.readiness) return [props.error];
  if (!props.readiness) return [props.loading ? "正在读取最新合并条件" : "尚未获取合并状态"];

  const readiness = props.readiness;
  const details = readiness.blocking_reasons.map((reason) => reason.message);
  if (details.length > 0) return details;

  if (readiness.status === "ready") return ["所有合并条件均已满足"];
  if (readiness.status === "pending") return ["平台检查尚未全部完成"];
  if (readiness.status === "unknown") {
    return ["平台未返回完整合并信息；仍可尝试合并，平台会在提交时执行最终校验"];
  }
  return ["存在未满足的合并条件"];
});
</script>

<template>
  <div class="readiness-control">
    <div
      class="readiness-status"
      :class="`state-${state}`"
      role="status"
      tabindex="0"
      :aria-describedby="'merge-readiness-details'"
    >
      <span class="state-icon" aria-hidden="true">{{ stateIcon }}</span>
      <span>{{ stateLabel }}</span>
    </div>

    <button
      class="refresh-button"
      type="button"
      :disabled="loading"
      :aria-label="loading ? '正在刷新合并状态' : '刷新合并状态'"
      :title="loading ? '正在刷新…' : '刷新合并状态'"
      @click="emit('retry')"
    >
      <svg
        :class="{ spinning: loading }"
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
        <path d="M20 11a8 8 0 1 0-2.34 5.66" />
        <path d="M20 4v7h-7" />
      </svg>
    </button>

    <div id="merge-readiness-details" class="readiness-tooltip" role="tooltip">
      <ul>
        <li v-for="detail in statusDetails" :key="detail">{{ detail }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped src="./MergeReadinessPanel.css"></style>
