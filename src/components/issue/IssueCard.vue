<script setup lang="ts">
import type { IssueSummary } from "@/types";
import { labelTagColorClass } from "@/utils/labelColorClass";

defineProps<{
  issue: IssueSummary;
}>();
</script>

<template>
  <div class="issue-card">
    <span class="issue-icon" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    </span>
    <div class="issue-content">
      <div class="issue-card-top">
        <span class="issue-title">{{ issue.title }}</span>
        <span class="badge" :class="`badge-${issue.state}`">{{ issue.state }}</span>
      </div>
      <div class="issue-meta">
        <span class="issue-number">#{{ issue.number }}</span>
        <span>{{ issue.author.login }}</span>
        <span>由 {{ issue.author.login }} 创建</span>
        <span>{{ new Date(issue.created_at).toLocaleDateString("zh-CN") }}</span>
        <span v-if="issue.labels.length" class="issue-labels">
          <span
            v-for="label in issue.labels"
            :key="label"
            class="label-tag"
            :class="labelTagColorClass(issue.label_colors?.[label])"
          >
            {{ label }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped src="./IssueCard.css"></style>
