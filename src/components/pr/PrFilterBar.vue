<script setup lang="ts">
import { usePrStore } from "@/stores/usePrStore";
import type { PrState } from "@/types";

const pr = usePrStore();

const states: { value: PrState; label: string }[] = [
  { value: "open", label: "开放" },
  { value: "closed", label: "已关闭" },
  { value: "merged", label: "已合并" },
  { value: "all", label: "全部" },
];
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
