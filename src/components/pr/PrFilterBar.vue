<script setup lang="ts">
import { computed } from "vue";
import { usePrStore } from "@/stores/usePrStore";
import type { PrState } from "@/types";
import { useI18n } from "@/i18n";

const pr = usePrStore();
const { t } = useI18n();

const states = computed<{ value: PrState; label: string }[]>(() => [
  { value: "open", label: t("pr.open") },
  { value: "closed", label: t("pr.closed") },
  { value: "merged", label: t("pr.merged") },
  { value: "all", label: t("pr.all") },
]);
</script>

<template>
  <div class="pr-filter-bar">
    <div class="filters">
      <button
        v-for="s in states"
        :key="s.value"
        :class="{ active: pr.filters.state === s.value }"
        :aria-pressed="pr.filters.state === s.value"
        @click="pr.setFilter(s.value)"
      >
        {{ s.label }}
        <span v-if="s.value !== 'all'" class="count">{{ pr.stateCounts[s.value] }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped src="./PrFilterBar.css"></style>
