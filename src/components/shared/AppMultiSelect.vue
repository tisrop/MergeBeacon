<script setup lang="ts">
import { computed } from "vue";
import { useSelectDropdown } from "@/composables/useSelectDropdown";
import { labelColorClass } from "@/utils/labelColorClass";

export interface MultiSelectOption {
  value: string;
  label: string;
  color?: string | null;
  description?: string | null;
  avatarUrl?: string | null;
  disabled?: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    options: MultiSelectOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    emptySearchText?: string;
    ariaLabel?: string;
    disabled?: boolean;
  }>(),
  {
    placeholder: "请选择",
    searchPlaceholder: "搜索选项",
    emptyText: "暂无选项",
    emptySearchText: "没有匹配选项",
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
}>();

const selectedSet = computed(() => new Set(props.modelValue));
const selectedLabels = computed(() =>
  props.options
    .filter((option) => selectedSet.value.has(option.value))
    .map((option) => option.label),
);
const selectedText = computed(() => selectedLabels.value.join(", "));

function toggleOption(option: MultiSelectOption): void {
  if (option.disabled) return;
  const next = new Set(props.modelValue);
  if (next.has(option.value)) next.delete(option.value);
  else next.add(option.value);
  emit(
    "update:modelValue",
    props.options.filter((item) => next.has(item.value)).map((item) => item.value),
  );
}
const optionSource = computed(() => props.options);
const {
  open,
  searchQuery,
  highlightIndex,
  wrapperRef,
  triggerRef,
  searchInputRef,
  listRef,
  filteredOptions,
  toggleDropdown,
  selectOption,
  onTriggerKeydown,
  onSearchKeydown,
} = useSelectDropdown<MultiSelectOption>({
  options: optionSource,
  searchText: (option) => `${option.label} ${option.value} ${option.description ?? ""}`,
  isSelected: (option) => selectedSet.value.has(option.value),
  onSelect: toggleOption,
  disabled: () => props.disabled,
  closeOnSelect: false,
  optionSelector: ".multi-select-option",
});
</script>

<template>
  <div ref="wrapperRef" class="app-multi-select-wrap">
    <div
      ref="triggerRef"
      class="app-multi-select"
      :class="{ disabled: props.disabled }"
      role="combobox"
      tabindex="0"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      @click="toggleDropdown"
      @keydown="onTriggerKeydown"
    >
      <span class="app-multi-select-value" :class="{ placeholder: !selectedText }">
        {{ selectedText || placeholder }}
      </span>
      <span v-if="modelValue.length" class="app-multi-select-count">{{ modelValue.length }}</span>
      <span class="app-multi-select-chevron" :class="{ open }" aria-hidden="true">⌄</span>
    </div>

    <div v-if="open" class="multi-select-dropdown">
      <input
        ref="searchInputRef"
        v-model="searchQuery"
        class="multi-select-search"
        type="search"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
        @keydown="onSearchKeydown"
      />
      <div ref="listRef" class="multi-select-options" role="listbox" aria-multiselectable="true">
        <button
          v-for="(option, index) in filteredOptions"
          :key="option.value"
          type="button"
          class="multi-select-option"
          :class="{
            highlighted: index === highlightIndex,
            selected: selectedSet.has(option.value),
          }"
          :data-value="option.value"
          :disabled="option.disabled"
          role="option"
          :aria-selected="selectedSet.has(option.value)"
          @click.stop="selectOption(option)"
          @mouseenter="!option.disabled && (highlightIndex = index)"
        >
          <img v-if="option.avatarUrl" class="multi-select-avatar" :src="option.avatarUrl" alt="" />
          <span
            v-else-if="option.color"
            class="multi-select-swatch"
            :class="labelColorClass(option.color)"
            aria-hidden="true"
          />
          <span class="multi-select-check" aria-hidden="true" />
          <span class="multi-select-option-copy">
            <span>{{ option.label }}</span>
            <small v-if="option.description">{{ option.description }}</small>
          </span>
        </button>
        <div v-if="filteredOptions.length === 0" class="multi-select-empty">
          {{ searchQuery ? emptySearchText : emptyText }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./AppMultiSelect.css"></style>
