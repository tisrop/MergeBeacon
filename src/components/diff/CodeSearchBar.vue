<script setup lang="ts">
import type { ComponentPublicInstance } from "vue";
import type { DiffSide } from "@/types";
import type { CodeSearchOption, CodeSearchState } from "./useDiffCodeSearch";
import { useI18n } from "@/i18n";

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
const { t } = useI18n();

function sideLabel(side: DiffSide): string {
  return t(side === "left" ? "diff.sideLeft" : "diff.sideRight");
}

function optionLabel(option: CodeSearchOption): string {
  if (option === "caseSensitive") return t("diff.findCaseSensitive");
  if (option === "wholeWord") return t("diff.findWholeWord");
  return t("diff.findRegex");
}

function setInputRef(side: DiffSide, element: Element | ComponentPublicInstance | null): void {
  registerInput(side, element instanceof HTMLInputElement ? element : null);
}

function updateQuery(side: DiffSide, event: Event): void {
  if (event.target instanceof HTMLInputElement) emit("updateQuery", side, event.target.value);
}
</script>

<template>
  <div class="diff-search-bar" role="search" :aria-label="t('diff.find')">
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
          :aria-label="t('diff.findInSide', { side: sideLabel(side) })"
          :aria-invalid="states[side].error ? 'true' : undefined"
          @input="updateQuery(side, $event)"
          @keydown="emit('keydown', $event, side)"
        />
        <button
          v-if="states[side].query"
          type="button"
          class="code-search-clear"
          :title="t('diff.findClear', { side: sideLabel(side) })"
          :aria-label="t('diff.findClear', { side: sideLabel(side) })"
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
        :aria-label="t('diff.findOptions', { side: sideLabel(side) })"
      >
        <button
          v-for="option in ['caseSensitive', 'wholeWord', 'regex'] as const"
          :key="option"
          type="button"
          class="code-search-option"
          :aria-pressed="states[side][option]"
          :title="optionLabel(option)"
          :aria-label="`${sideLabel(side)} ${optionLabel(option)}`"
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
                : t("diff.findNoResults")
              : ""
        }}
      </span>
      <button
        type="button"
        class="code-search-action"
        :disabled="states[side].matchCount === 0"
        :title="t('diff.findPrevious', { side: sideLabel(side) })"
        :aria-label="t('diff.findPrevious', { side: sideLabel(side) })"
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
        :title="t('diff.findNext', { side: sideLabel(side) })"
        :aria-label="t('diff.findNext', { side: sideLabel(side) })"
        @click="emit('navigate', side, 1)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
      <button
        type="button"
        class="code-search-action"
        :title="t('diff.findClose', { side: sideLabel(side) })"
        :aria-label="t('diff.findClose', { side: sideLabel(side) })"
        @click="emit('closeSide', side)"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 4 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped src="./CodeSearchBar.css"></style>
