<script setup lang="ts">
import { computed, ref } from "vue";
import { useSelectDropdown } from "@/composables/useSelectDropdown";
import { useSelectDropdownPlacement } from "@/composables/useSelectDropdownPlacement";
import type { SelectOption } from "./selectOptions";
import { useI18n } from "@/i18n";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    id?: string;
    modelValue: string;
    options: SelectOption[];
    placeholder?: string;
    size?: "sm" | "md";
    ariaLabel?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
    hasMore?: boolean;
    loadingMore?: boolean;
    loadMoreText?: string;
    disabled?: boolean;
  }>(),
  {
    placeholder: undefined,
    size: "md",
    searchable: false,
    searchPlaceholder: undefined,
    hasMore: false,
    loadingMore: false,
    loadMoreText: undefined,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "load-more": [];
}>();

const selectedLabel = computed(() => {
  const match = props.options.find((o) => o.value === props.modelValue);
  return match ? match.label : "";
});
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
} = useSelectDropdown<SelectOption>({
  options: optionSource,
  searchText: (option) => `${option.label} ${option.value}`,
  isSelected: (option) => option.value === props.modelValue,
  onSelect: (option) => emit("update:modelValue", option.value),
  searchable: () => props.searchable,
  disabled: () => props.disabled,
  closeOnSelect: true,
  optionSelector: ".dropdown-option",
});

const dropdownRef = ref<HTMLElement | null>(null);
const { dropdownPlacement, dropdownCssClass } = useSelectDropdownPlacement({
  open,
  triggerRef,
  dropdownRef,
  cssPrefix: "app-select-dropdown",
  cssVarName: "--app-select-dropdown-max-height",
  recalcTrigger: filteredOptions,
});
</script>

<template>
  <div
    ref="wrapperRef"
    class="app-select-wrap"
    :class="[size === 'sm' ? 'app-select-wrap-sm' : '']"
  >
    <div
      ref="triggerRef"
      :id="id"
      class="app-select"
      :tabindex="disabled ? -1 : 0"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-label="ariaLabel"
      :aria-disabled="disabled"
      @click="toggleDropdown"
      @keydown="onTriggerKeydown"
    >
      <span class="app-select-value" :class="{ placeholder: !selectedLabel }">
        {{ selectedLabel || placeholder || t("common.select") }}
      </span>
      <svg
        class="app-select-chevron"
        :class="{ open }"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>

    <div
      v-if="open"
      ref="dropdownRef"
      class="dropdown-panel"
      :class="[dropdownCssClass.className, { 'dropdown-panel-up': dropdownPlacement === 'up' }]"
    >
      <input
        v-if="searchable"
        ref="searchInputRef"
        v-model="searchQuery"
        class="dropdown-search"
        type="search"
        :placeholder="searchPlaceholder || t('common.searchOptions')"
        :aria-label="searchPlaceholder || t('common.searchOptions')"
        @keydown="onSearchKeydown"
      />
      <div ref="listRef" class="dropdown-options" role="listbox">
        <button
          v-for="(opt, i) in filteredOptions"
          :key="opt.value"
          :data-value="opt.value"
          class="dropdown-option"
          :class="{ selected: opt.value === modelValue, highlighted: i === highlightIndex }"
          :disabled="opt.disabled"
          role="option"
          :aria-selected="opt.value === modelValue"
          @click.stop="selectOption(opt)"
          @mouseenter="!opt.disabled && (highlightIndex = i)"
          type="button"
        >
          {{ opt.label }}
        </button>
        <div v-if="filteredOptions.length === 0" class="dropdown-empty">
          {{ searchQuery ? t("common.noMatch") : t("common.noOptions") }}
        </div>
      </div>
      <button
        v-if="hasMore"
        class="dropdown-load-more"
        type="button"
        :disabled="loadingMore"
        @click.stop="emit('load-more')"
      >
        {{ loadingMore ? t("common.loadingMore") : loadMoreText || t("common.loadMore") }}
      </button>
    </div>
  </div>
</template>

<style scoped src="./AppSelect.css"></style>
