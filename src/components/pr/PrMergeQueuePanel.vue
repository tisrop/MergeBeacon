<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { prMergeQueueStatus } from "@/api";
import { getErrorMessage } from "@/utils/error";
import type { MergeQueueKind, MergeQueueState, Platform, PrMergeQueueStatus } from "@/types";

const props = defineProps<{
  platform: Platform;
  owner: string;
  repo: string;
  prNumber: number;
  revision: string;
  // undefined: capabilities loading; null: unsupported platform; value: query this queue type.
  queueKind: MergeQueueKind | null | undefined;
}>();

const status = ref<PrMergeQueueStatus | null>(null);
const loading = ref(false);
const error = ref("");
let requestSequence = 0;

const queueName = computed(() =>
  props.queueKind === "merge_train" ? "Merge Train" : "Merge Queue",
);
const stateLabels: Record<MergeQueueState, string> = {
  not_queued: "未入队",
  queued: "排队中",
  waiting: "等待检查",
  ready: "可以合并",
  blocked: "已阻塞",
  merging: "合并中",
  failed: "失败",
  merged: "已合并",
  unknown: "状态未知",
};

const queued = computed(() =>
  Boolean(status.value?.available && status.value.state !== "not_queued"),
);

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `约 ${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `约 ${hours} 小时 ${remainder} 分钟` : `约 ${hours} 小时`;
}

async function loadStatus(): Promise<void> {
  if (props.queueKind === undefined) {
    requestSequence += 1;
    status.value = null;
    error.value = "";
    loading.value = true;
    return;
  }
  if (props.queueKind === null) {
    requestSequence += 1;
    status.value = null;
    error.value = "";
    loading.value = false;
    return;
  }
  const sequence = ++requestSequence;
  loading.value = true;
  error.value = "";
  try {
    const result = await prMergeQueueStatus(
      props.platform,
      props.owner,
      props.repo,
      props.prNumber,
    );
    if (sequence === requestSequence) status.value = result;
  } catch (cause) {
    if (sequence !== requestSequence) return;
    error.value = getErrorMessage(cause, `无法读取 ${queueName.value} 状态`);
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

watch(
  () =>
    `${props.platform}:${props.owner}:${props.repo}:${props.prNumber}:${props.revision}:${String(props.queueKind)}`,
  () => void loadStatus(),
  { immediate: true },
);

onUnmounted(() => {
  requestSequence += 1;
});
</script>

<template>
  <section class="merge-queue-panel" aria-labelledby="merge-queue-title" :aria-busy="loading">
    <header class="queue-header">
      <div class="queue-heading">
        <h3 id="merge-queue-title">{{ queueKind ? queueName : "合并队列" }}</h3>
        <span class="readonly-badge">只读</span>
        <span v-if="loading && status" class="refresh-status" role="status" aria-live="polite">
          刷新中
        </span>
      </div>
      <button
        v-if="queueKind"
        :class="['refresh-button', { loading }]"
        type="button"
        title="刷新合并队列状态"
        aria-label="刷新合并队列状态"
        :disabled="loading"
        @click="loadStatus"
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
          <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
          <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
        </svg>
      </button>
    </header>

    <div v-if="queueKind === null" class="queue-unsupported" role="status">
      Gitee API 不提供 Merge Queue 或 Merge Train，当前仅展示分支依赖关系。
    </div>

    <div
      v-else-if="queueKind === undefined || (loading && !status)"
      class="queue-loading"
      role="status"
    >
      <div class="skeleton queue-skeleton" />
      <div class="skeleton queue-skeleton short" />
    </div>

    <div v-else-if="error" class="queue-error" role="alert">
      <span>{{ error }}</span>
      <button class="btn btn-sm" type="button" @click="loadStatus">重新加载</button>
    </div>

    <template v-else-if="status">
      <div v-if="!status.available" class="queue-unavailable" role="status">
        {{ status.failure_reason || `当前仓库未提供 ${queueName}` }}
      </div>

      <div v-else-if="status.state === 'not_queued'" class="queue-empty">
        当前 {{ platform === "gitlab" ? "MR" : "PR" }} 尚未加入 {{ queueName }}。
        <span v-if="status.target_branch">目标分支：{{ status.target_branch }}</span>
      </div>

      <div v-else class="queue-status">
        <div class="queue-summary">
          <div>
            <span class="summary-label">当前状态</span>
            <strong :class="['queue-state', status.state]">{{ stateLabels[status.state] }}</strong>
          </div>
          <div v-if="status.position != null" class="queue-position">
            <span class="summary-label">队列位置</span>
            <strong>
              第 {{ status.position }} 位<span v-if="status.total != null">
                / 共 {{ status.total }} 项</span
              >
            </strong>
          </div>
        </div>

        <dl v-if="queued" class="queue-details">
          <div v-if="status.target_branch">
            <dt>目标分支</dt>
            <dd>
              <code>{{ status.target_branch }}</code>
            </dd>
          </div>
          <div v-if="status.pipeline_status">
            <dt>Pipeline</dt>
            <dd>{{ status.pipeline_status }}</dd>
          </div>
          <div v-if="status.estimated_time_seconds != null">
            <dt>预计等待</dt>
            <dd>{{ formatDuration(status.estimated_time_seconds) }}</dd>
          </div>
          <div v-if="status.enqueued_at">
            <dt>加入时间</dt>
            <dd>{{ formatDate(status.enqueued_at) }}</dd>
          </div>
          <div v-if="status.updated_at">
            <dt>更新时间</dt>
            <dd>{{ formatDate(status.updated_at) }}</dd>
          </div>
          <div v-if="status.head_sha">
            <dt>队列提交</dt>
            <dd>
              <code :title="status.head_sha">{{ status.head_sha.slice(0, 12) }}</code>
            </dd>
          </div>
        </dl>

        <div v-if="status.failure_reason" class="queue-failure" role="alert">
          {{ status.failure_reason }}
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped src="./PrMergeQueuePanel.css"></style>
