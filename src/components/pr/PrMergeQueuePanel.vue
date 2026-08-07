<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { prMergeQueueStatus } from "@/api";
import { currentLocale, useI18n } from "@/i18n";
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
const { t } = useI18n();

const status = ref<PrMergeQueueStatus | null>(null);
const loading = ref(false);
const error = ref("");
let requestSequence = 0;

const queueName = computed(() =>
  props.queueKind === "merge_train" ? "Merge Train" : "Merge Queue",
);
const stateLabels = computed<Record<MergeQueueState, string>>(() => ({
  not_queued: t("mergeQueue.stateNotQueued"),
  queued: t("mergeQueue.stateQueued"),
  waiting: t("mergeQueue.stateWaiting"),
  ready: t("mergeQueue.stateReady"),
  blocked: t("mergeQueue.stateBlocked"),
  merging: t("mergeQueue.stateMerging"),
  failed: t("mergeQueue.stateFailed"),
  merged: t("mergeQueue.stateMerged"),
  unknown: t("mergeQueue.stateUnknown"),
}));

const queued = computed(() =>
  Boolean(status.value?.available && status.value.state !== "not_queued"),
);

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(currentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  if (seconds < 60) return t("mergeQueue.durationSeconds", { seconds });
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return t("mergeQueue.durationMinutes", { minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0
    ? t("mergeQueue.durationHoursMinutes", { hours, minutes: remainder })
    : t("mergeQueue.durationHours", { hours });
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
    error.value = getErrorMessage(cause, t("mergeQueue.loadFailed", { queue: queueName.value }));
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

defineExpose({ refresh: loadStatus });
</script>

<template>
  <section class="merge-queue-panel" aria-labelledby="merge-queue-title" :aria-busy="loading">
    <header class="queue-header">
      <div class="queue-heading">
        <h3 id="merge-queue-title">{{ queueKind ? queueName : t("mergeQueue.genericName") }}</h3>
        <span class="readonly-badge">{{ t("mergeQueue.readonly") }}</span>
        <span v-if="loading && status" class="refresh-status" role="status" aria-live="polite">
          {{ t("mergeQueue.refreshing") }}
        </span>
      </div>
      <button
        v-if="queueKind"
        :class="['refresh-button', { loading }]"
        type="button"
        :title="t('mergeQueue.refresh')"
        :aria-label="t('mergeQueue.refresh')"
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
      {{ t("mergeQueue.unsupportedGitee") }}
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
      <button class="btn btn-sm" type="button" @click="loadStatus">{{ t("common.reload") }}</button>
    </div>

    <template v-else-if="status">
      <div v-if="!status.available" class="queue-unavailable" role="status">
        {{ status.failure_reason || t("mergeQueue.unavailable", { queue: queueName }) }}
      </div>

      <div v-else-if="status.state === 'not_queued'" class="queue-empty">
        {{
          t("mergeQueue.notQueued", { item: platform === "gitlab" ? "MR" : "PR", queue: queueName })
        }}
        <span v-if="status.target_branch"
          >{{ t("mergeQueue.targetBranch") }}：{{ status.target_branch }}</span
        >
      </div>

      <div v-else class="queue-status">
        <div class="queue-summary">
          <div>
            <span class="summary-label">{{ t("mergeQueue.currentState") }}</span>
            <strong :class="['queue-state', status.state]">{{ stateLabels[status.state] }}</strong>
          </div>
          <div v-if="status.position != null" class="queue-position">
            <span class="summary-label">{{ t("mergeQueue.position") }}</span>
            <strong>{{
              status.total == null
                ? t("mergeQueue.positionOnly", { position: status.position })
                : t("mergeQueue.positionTotal", { position: status.position, total: status.total })
            }}</strong>
          </div>
        </div>

        <dl v-if="queued" class="queue-details">
          <div v-if="status.target_branch">
            <dt>{{ t("mergeQueue.targetBranch") }}</dt>
            <dd>
              <code>{{ status.target_branch }}</code>
            </dd>
          </div>
          <div v-if="status.pipeline_status">
            <dt>Pipeline</dt>
            <dd>{{ status.pipeline_status }}</dd>
          </div>
          <div v-if="status.estimated_time_seconds != null">
            <dt>{{ t("mergeQueue.estimatedWait") }}</dt>
            <dd>{{ formatDuration(status.estimated_time_seconds) }}</dd>
          </div>
          <div v-if="status.enqueued_at">
            <dt>{{ t("mergeQueue.enqueuedAt") }}</dt>
            <dd>{{ formatDate(status.enqueued_at) }}</dd>
          </div>
          <div v-if="status.updated_at">
            <dt>{{ t("mergeQueue.updatedAt") }}</dt>
            <dd>{{ formatDate(status.updated_at) }}</dd>
          </div>
          <div v-if="status.head_sha">
            <dt>{{ t("mergeQueue.commit") }}</dt>
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
