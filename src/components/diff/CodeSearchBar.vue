<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { DiffSide } from "@/types";
import type { CodeSearchOption, CodeSearchState } from "./useDiffCodeSearch";

const { registerInput } = defineProps<{
  visibleSides: DiffSide[];
  states: Record<DiffSide, CodeSearchState>;
  registerInput: (side: DiffSide, input: HTMLInputElement | null) => void;
}>();

const emit = defineEmits<{
  keydown: [event: KeyboardEvent, side: DiffSide];
  clearQuery: [side: DiffSide];
  navigate: [side: DiffSide, direction: -1 | 1];
  closeSide: [side: DiffSide];
  toggleOption: [side: DiffSide, option: CodeSearchOption];
  updateQuery: [side: DiffSide, query: string];
}>();

function setInputRef(side: DiffSide, element: Element | ComponentPublicInstance | null): void {
  registerInput(side, element instanceof HTMLInputElement ? element : null);
}

function updateQuery(side: DiffSide, event: Event): void {
  if (event.target instanceof HTMLInputElement) emit("updateQuery", side, event.target.value);
}
</script>

<template>
  <div class="diff-search-bar" role="search" aria-label="代码查找">
    <div v-for="side in visibleSides" :key="side" class="code-search-pane" :data-side="side">
      <div class="diff-search-field">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="6.75" cy="6.75" r="4.25" stroke="currentColor" stroke-width="1.4" />
          <path d="m10 10 3.5 3.5" stroke="currentColor" stroke-width="1.4" />
        </svg>
        <input
          :ref="(element) => setInputRef(side, element)"
          :value="states[side].query"
          class="input code-search-input"
          type="search"
          autocomplete="off"
          spellcheck="false"
          :data-search-side="side"
          :aria-label="side === 'left' ? '在左侧代码中查找' : '在右侧代码中查找'"
          :aria-invalid="states[side].error ? 'true' : undefined"
          @input="updateQuery(side, $event)"
          @keydown="emit('keydown', $event, side)"
        />
        <button
          v-if="states[side].query"
          type="button"
          class="code-search-clear"
          :title="side === 'left' ? '清空左侧查找' : '清空右侧查找'"
          :aria-label="side === 'left' ? '清空左侧查找' : '清空右侧查找'"
          @pointerdown.prevent
          @click="emit('clearQuery', side)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="m3 3 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.25" />
          </svg>
        </button>
      </div>
      <div
        class="code-search-options"
        role="group"
        :aria-label="side === 'left' ? '左侧查找选项' : '右侧查找选项'"
      >
        <button
          v-for="option in ['caseSensitive', 'wholeWord', 'regex'] as const"
          :key="option"
          type="button"
          class="code-search-option"
          :aria-pressed="states[side][option]"
          :title="
            option === 'caseSensitive'
              ? '区分大小写'
              : option === 'wholeWord'
                ? '全词匹配'
                : '使用正则表达式'
          "
          :aria-label="
            side === 'left'
              ? `左侧${option === 'caseSensitive' ? '区分大小写' : option === 'wholeWord' ? '全词匹配' : '使用正则表达式'}`
              : `右侧${option === 'caseSensitive' ? '区分大小写' : option === 'wholeWord' ? '全词匹配' : '使用正则表达式'}`
          "
          @click="emit('toggleOption', side, option)"
        >
          {{ option === "caseSensitive" ? "Aa" : option === "wholeWord" ? "ab" : ".*" }}
        </button>
      </div>
      <span
        class="code-search-result"
        :class="{ error: states[side].error }"
        :role="states[side].error ? 'alert' : 'status'"
        :title="states[side].error || undefined"
        aria-live="polite"
      >
        {{
          states[side].error
            ? states[side].error
            : states[side].query
              ? states[side].matchCount
                ? `${states[side].activeMatchIndex + 1}/${states[side].matchCount}`
                : "无结果"
              : ""
        }}
      </span>
      <button
        type="button"
        class="code-search-action"
        :disabled="states[side].matchCount === 0"
        title="上一个匹配项"
        :aria-label="side === 'left' ? '左侧上一个匹配项' : '右侧上一个匹配项'"
        @click="emit('navigate', side, -1)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 10 4-4 4 4" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
      <button
        type="button"
        class="code-search-action"
        :disabled="states[side].matchCount === 0"
        title="下一个匹配项"
        :aria-label="side === 'left' ? '左侧下一个匹配项' : '右侧下一个匹配项'"
        @click="emit('navigate', side, 1)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
      <button
        type="button"
        class="code-search-action"
        :title="side === 'left' ? '关闭左侧查找' : '关闭右侧查找'"
        :aria-label="side === 'left' ? '关闭左侧查找' : '关闭右侧查找'"
        @click="emit('closeSide', side)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.diff-search-bar {
  display: grid;
  min-height: 32px;
  flex: none;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}

.code-search-pane {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 2px;
  padding: 2px var(--space-2);
}

.code-search-pane + .code-search-pane {
  border-left: 1px solid var(--color-border-light);
}

.code-search-pane[data-side="right"] {
  grid-column: 2;
  border-left: 1px solid var(--color-border-light);
}

.diff-search-field {
  position: relative;
  display: flex;
  min-width: 80px;
  max-width: 180px;
  flex: 1;
  align-items: center;
}

.diff-search-field > svg {
  position: absolute;
  z-index: 1;
  left: 9px;
  color: var(--color-text-tertiary);
  pointer-events: none;
}

.code-search-input {
  width: 100%;
  height: 26px;
  min-height: 26px;
  padding: 0 26px 0 28px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 24px;
}

.code-search-input::-webkit-search-cancel-button,
.code-search-input::-webkit-search-decoration {
  appearance: none;
}

.code-search-clear {
  position: absolute;
  top: 50%;
  right: 4px;
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-tertiary);
  transform: translateY(-50%);
}

.code-search-clear:hover {
  background: var(--color-surface-hover);
  color: var(--color-text-primary);
}

.code-search-options {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding-right: var(--space-1);
  border-right: 1px solid var(--color-border-light);
}

.code-search-option,
.code-search-action {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
}

.code-search-option {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0;
}

.code-search-option:hover,
.code-search-option[aria-pressed="true"] {
  border-color: var(--color-border);
  background: var(--color-primary-light);
  color: var(--color-primary);
}

.code-search-result {
  min-width: 40px;
  max-width: 120px;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-search-result.error {
  color: var(--color-danger);
}

.code-search-action:hover:not(:disabled) {
  border-color: var(--color-border);
  background: var(--color-surface-hover);
  color: var(--color-primary);
}

.code-search-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
</style>
