<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "@/i18n";
import type { PrMergeReadiness, ReadinessState } from "@/types";

const { t } = useI18n();

const props = defineProps<{
  readiness: PrMergeReadiness | null;
  loading: boolean;
  error: string | null;
}>();
const emit = defineEmits<{ retry: [] }>();

const stateLabels = computed<Record<ReadinessState, string>>(() => ({
  ready: t("readiness.stateReady"),
  blocked: t("readiness.stateBlocked"),
  pending: t("readiness.statePending"),
  unknown: t("readiness.stateUnknown"),
}));
const stateIcons: Record<ReadinessState, string> = {
  ready: "✓",
  blocked: "!",
  pending: "…",
  unknown: "?",
};
const state = computed<ReadinessState>(
  () => props.readiness?.status ?? (props.error ? "unknown" : "pending"),
);
const stateLabel = computed(() => stateLabels.value[state.value]);
const stateIcon = computed(() => stateIcons[state.value]);

const statusDetails = computed(() => {
  if (props.error && !props.readiness) return [props.error];
  if (!props.readiness) {
    return [props.loading ? t("readiness.loading") : t("readiness.unavailable")];
  }

  const readiness = props.readiness;
  const details = readiness.blocking_reasons.map((reason) => reason.message);
  if (details.length > 0) return details;

  if (readiness.status === "ready") return [t("readiness.ready")];
  if (readiness.status === "pending") return [t("readiness.pending")];
  if (readiness.status === "unknown") return [t("readiness.unknown")];
  return [t("readiness.blocked")];
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
      :aria-label="loading ? t('readiness.refreshing') : t('readiness.refresh')"
      :title="loading ? t('readiness.refreshingShort') : t('readiness.refresh')"
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
