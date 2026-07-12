<script setup lang="ts">
import type { IssueSummary } from "@/types";

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
          <span v-for="label in issue.labels" :key="label" class="label-tag">
            {{ label }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.issue-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  transition:
    box-shadow var(--transition-base),
    border-color var(--transition-base);
}

.issue-card:hover {
  box-shadow: var(--shadow-md);
  border-color: var(--color-primary-border);
}

.issue-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-success-border);
  border-radius: var(--radius-md);
  color: var(--color-success);
  background: var(--color-success-light);
}

.issue-icon svg {
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.issue-content {
  min-width: 0;
  flex: 1;
}

.issue-card-top {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.issue-title {
  flex: 1;
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-meta {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.issue-number {
  color: var(--color-text-tertiary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.issue-labels {
  display: flex;
  gap: var(--space-1);
}

.label-tag {
  padding: 2px 7px;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--color-text-secondary);
}
</style>
