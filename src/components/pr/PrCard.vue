<script setup lang="ts">
import { computed } from "vue";
import PrStatusSummary from "@/components/pr/PrStatusSummary.vue";
import type { PrState, PrSummary } from "@/types";
import { labelTagColorClass } from "@/utils/labelColorClass";
import { useI18n } from "@/i18n";

defineProps<{
  pr: PrSummary;
}>();

defineEmits<{
  click: [];
}>();
const { locale, t } = useI18n();
const stateLabels = computed<Record<PrState, string>>(() => ({
  open: t("pr.open"),
  closed: t("pr.closed"),
  merged: t("pr.merged"),
  all: t("pr.all"),
}));
</script>

<template>
  <button type="button" class="pr-card" @click="$emit('click')">
    <span class="pr-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="6" cy="5" r="2.5" />
        <circle cx="18" cy="19" r="2.5" />
        <path d="M6 7.5V16a3 3 0 0 0 3 3h6.5" />
        <path d="M12 5h3a3 3 0 0 1 3 3v8.5" />
      </svg>
    </span>
    <span class="pr-content">
      <div class="pr-card-top">
        <span class="pr-title">{{ pr.title }}</span>
        <span class="badge" :class="`badge-${pr.state}`">{{ stateLabels[pr.state] }}</span>
      </div>
      <PrStatusSummary v-if="pr.state === 'open' && pr.status" :status="pr.status" />
      <div class="pr-card-meta">
        <span class="pr-number">#{{ pr.number }}</span>
        <span>{{ t("common.updatedBy", { author: pr.author.login }) }}</span>
        <span>{{ new Date(pr.updated_at).toLocaleDateString(locale) }}</span>
        <span v-if="pr.labels.length" class="pr-labels">
          <span
            v-for="label in pr.labels"
            :key="label"
            class="label-tag"
            :class="labelTagColorClass(pr.label_colors?.[label])"
          >
            {{ label }}
          </span>
        </span>
      </div>
    </span>
    <svg
      class="chevron"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  </button>
</template>

<style scoped src="./PrCard.css"></style>
