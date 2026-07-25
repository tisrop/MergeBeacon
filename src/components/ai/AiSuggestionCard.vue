<script setup lang="ts">
import type { AiSuggestion, AiSuggestionAction, Severity } from "@/types";

defineProps<{
  suggestion: AiSuggestion;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  action: [action: AiSuggestionAction];
  locate: [];
}>();

const severityLabel: Record<Severity, string> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  info: "Info",
};
</script>

<template>
  <div class="suggestion-card" :class="`severity-${suggestion.severity}`">
    <div class="card-header">
      <span class="severity font-mono">
        <span class="severity-signal" :class="`signal-${suggestion.severity}`" aria-hidden="true" />
        {{ severityLabel[suggestion.severity] }}
      </span>
      <span class="category">{{ suggestion.category }}</span>
      <button
        class="file-loc"
        type="button"
        :disabled="disabled || !suggestion.file.trim()"
        :title="disabled ? '该建议基于旧版本，无法定位' : '在 Diff 中定位'"
        :aria-label="`在 Diff 中定位 ${suggestion.file}${suggestion.line_start ? ` 第 ${suggestion.line_start} 行` : ''}`"
        @click="emit('locate')"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        {{ suggestion.file }}
        <template v-if="suggestion.line_start">
          :{{ suggestion.line_start }}
          <template v-if="suggestion.line_end && suggestion.line_end !== suggestion.line_start">
            -{{ suggestion.line_end }}
          </template>
        </template>
      </button>
    </div>

    <p class="description">{{ suggestion.description }}</p>

    <div v-if="suggestion.suggestion" class="suggestion-code">
      <pre>{{ suggestion.suggestion }}</pre>
    </div>

    <div class="card-actions" v-if="!suggestion.action">
      <button class="btn btn-sm btn-accept" :disabled="disabled" @click="emit('action', 'accept')">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        加入草稿
      </button>
      <button
        class="btn btn-sm btn-edit"
        :disabled="disabled"
        @click="emit('action', { edit: '' })"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        编辑
      </button>
      <button class="btn btn-sm btn-reject" :disabled="disabled" @click="emit('action', 'reject')">
        忽略
      </button>
    </div>

    <div v-else class="action-status">
      <span v-if="suggestion.action === 'accept'" class="accepted">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        已加入草稿
      </span>
      <span v-else-if="suggestion.action === 'submitted'" class="accepted">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
        已提交
      </span>
      <span v-else-if="suggestion.action === 'reject'" class="rejected">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="4 4 20 20" />
        </svg>
        已忽略
      </span>
      <span v-else-if="typeof suggestion.action === 'object'" class="accepted">
        已编辑并加入草稿
      </span>
    </div>
  </div>
</template>

<style scoped src="./AiSuggestionCard.css"></style>
