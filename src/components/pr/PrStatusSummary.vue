<script setup lang="ts">
import type { PrStatusSummary, ReadinessState } from "@/types";
import { computed } from "vue";
import { useI18n } from "@/i18n";

const props = defineProps<{
  status: PrStatusSummary;
}>();
const { t } = useI18n();

const overallLabels = computed<Record<ReadinessState, string>>(() => ({
  ready: t("pr.readinessReady"),
  blocked: t("pr.readinessBlocked"),
  pending: t("pr.readinessPending"),
  unknown: t("pr.readinessUnknown"),
}));

const approvalLabels = computed<Record<ReadinessState, string>>(() => ({
  ready: t("review.approvalReady"),
  blocked: t("review.approvalBlocked"),
  pending: t("review.approvalPending"),
  unknown: t("review.approvalUnknown"),
}));

const checksLabels = computed<Record<ReadinessState, string>>(() => ({
  ready: t("review.checksReady"),
  blocked: t("review.checksBlocked"),
  pending: t("review.checksPending"),
  unknown: t("review.checksUnknown"),
}));

function blockingReasonText(): string {
  const reasons = props.status.blocking_reasons.map((reason) => reason.message);
  return reasons.length > 0
    ? reasons.join(t("common.messageSeparator"))
    : overallLabels.value[props.status.status];
}

const chipClasses: Record<ReadinessState, string> = {
  ready: "chip-success",
  blocked: "chip-danger",
  pending: "chip-warning",
  unknown: "chip-muted",
};
</script>

<template>
  <span
    class="status-summary"
    :title="blockingReasonText()"
    :aria-label="`${t('inbox.readiness')}: ${blockingReasonText()}`"
  >
    <span class="chip chip-strong" :class="chipClasses[props.status.status]">
      {{ overallLabels[props.status.status] }}
    </span>
    <span class="chip" :class="chipClasses[props.status.approvals_status]">
      {{ approvalLabels[props.status.approvals_status] }}
    </span>
    <span class="chip" :class="chipClasses[props.status.checks_status]">
      {{ checksLabels[props.status.checks_status] }}
    </span>
    <span v-if="props.status.draft" class="chip chip-warning">{{ t("pr.stateDraft") }}</span>
    <span v-if="props.status.has_conflicts" class="chip chip-danger">{{
      t("pr.stateConflict")
    }}</span>
  </span>
</template>

<style scoped src="./PrStatusSummary.css"></style>
