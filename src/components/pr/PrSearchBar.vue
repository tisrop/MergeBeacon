<script setup lang="ts">
import { computed, toRef } from "vue";
import type { Platform, PrListQuery } from "@/types";
import AppSelect from "@/components/shared/AppSelect.vue";
import type { SelectOption } from "@/components/shared/selectOptions";
import { usePrSearchBar } from "./usePrSearchBar";
import { useI18n } from "@/i18n";

const props = withDefaults(
  defineProps<{
    query: PrListQuery;
    platform?: Platform;
    loading?: boolean;
    optionsLoading?: boolean;
    optionsError?: string | null;
    authorOptions?: SelectOption[];
    labelOptions?: SelectOption[];
    assigneeOptions?: SelectOption[];
  }>(),
  {
    platform: "github",
    optionsError: null,
    authorOptions: () => [],
    labelOptions: () => [],
    assigneeOptions: () => [],
  },
);
const emit = defineEmits<{ apply: [query: PrListQuery]; clear: []; retryOptions: [] }>();
const { t } = useI18n();
const assigneeLabels = computed(() =>
  props.platform === "gitee"
    ? {
        field: t("pr.giteeTesters"),
        all: t("pr.allGiteeTesters"),
        aria: t("pr.giteeTesterFilterAria"),
        search: t("pr.searchGiteeTesters"),
      }
    : {
        field: t("pr.assignee"),
        all: t("pr.allAssignees"),
        aria: t("pr.assigneeFilterAria"),
        search: t("pr.searchAssignee"),
      },
);
const reviewLabels = computed(() =>
  props.platform === "gitee"
    ? {
        field: t("pr.giteeReviewers"),
        all: t("pr.allGiteeReviewStates"),
        aria: t("pr.giteeReviewerFilterAria"),
      }
    : {
        field: t("pr.reviews"),
        all: t("pr.allReviewStates"),
        aria: t("pr.reviewsFilterAria"),
      },
);
const reviewOptions = computed<SelectOption[]>(() => [
  { value: "", label: reviewLabels.value.all },
  { value: "none", label: t("pr.noReview") },
  { value: "required", label: t("pr.reviewRequired") },
  { value: "approved", label: t("pr.reviewApproved") },
  {
    value: "changes_requested",
    label:
      props.platform === "gitee" ? t("pr.changesRequestedUnsupported") : t("pr.changesRequested"),
    disabled: props.platform === "gitee",
  },
]);
const sortOptions = computed<SelectOption[]>(() => [
  { value: "best_match", label: t("pr.bestMatch") },
  { value: "updated_desc", label: t("pr.updatedDesc") },
  { value: "updated_asc", label: t("pr.updatedAsc") },
  { value: "created_desc", label: t("pr.createdDesc") },
  { value: "created_asc", label: t("pr.createdAsc") },
  { value: "comments_desc", label: t("pr.commentsDesc") },
  { value: "comments_asc", label: t("pr.commentsAsc") },
]);
const withAllOption = (label: string, options: SelectOption[]) => [
  { value: "", label },
  ...options,
];
const { draft, hasFilters, activeFilterCount, apply, clear, setReviews, setSort } = usePrSearchBar(
  toRef(props, "query"),
  (query) => emit("apply", query),
  () => emit("clear"),
);
</script>

<template>
  <form class="pr-search" role="search" :aria-label="t('pr.filterAria')" @submit.prevent="apply">
    <div class="search-primary">
      <span class="search-icon" aria-hidden="true">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <label class="sr-only" for="pr-title-search">{{ t("pr.titleSearch") }}</label>
      <input
        id="pr-title-search"
        v-model="draft.title"
        class="search-title-input"
        type="search"
        autocomplete="off"
        :placeholder="t('pr.searchTitle')"
      />
      <button class="btn btn-sm btn-primary search-submit" type="submit" :disabled="loading">
        {{ t("common.search") }}
      </button>
    </div>

    <div class="search-filters" :aria-label="t('pr.filterAdvanced')">
      <div class="filter-field select-field">
        <span>{{ t("pr.author") }}</span>
        <AppSelect
          :aria-label="t('pr.authorFilterAria')"
          searchable
          :search-placeholder="t('pr.searchAuthor')"
          :disabled="optionsLoading"
          :model-value="draft.author"
          :options="withAllOption(t('pr.allAuthors'), authorOptions)"
          @update:model-value="draft.author = $event"
        />
      </div>
      <div class="filter-field select-field">
        <span>{{ t("pr.label") }}</span>
        <AppSelect
          :aria-label="t('pr.labelFilterAria')"
          searchable
          :search-placeholder="t('pr.searchLabel')"
          :disabled="optionsLoading"
          :model-value="draft.label"
          :options="withAllOption(t('pr.allLabels'), labelOptions)"
          @update:model-value="draft.label = $event"
        />
      </div>
      <div class="filter-field select-field">
        <span>{{ assigneeLabels.field }}</span>
        <AppSelect
          :aria-label="assigneeLabels.aria"
          searchable
          :search-placeholder="assigneeLabels.search"
          :disabled="optionsLoading"
          :model-value="draft.assignee"
          :options="withAllOption(assigneeLabels.all, assigneeOptions)"
          @update:model-value="draft.assignee = $event"
        />
      </div>
      <div class="filter-field select-field">
        <span>{{ reviewLabels.field }}</span>
        <AppSelect
          :aria-label="reviewLabels.aria"
          :model-value="draft.reviews ?? ''"
          :options="reviewOptions"
          @update:model-value="setReviews"
        />
      </div>
      <div class="filter-field select-field sort-field">
        <span>{{ t("pr.sort") }}</span>
        <AppSelect
          :aria-label="t('pr.sortAria')"
          :model-value="draft.sort"
          :options="sortOptions"
          @update:model-value="setSort"
        />
      </div>
      <button v-if="hasFilters" class="clear-filters" type="button" @click="clear">
        {{ t("pr.filterClear")
        }}<span v-if="activeFilterCount">{{
          t("pr.filterCount", { count: activeFilterCount })
        }}</span>
      </button>
    </div>
    <p v-if="optionsError" class="filter-options-error" role="alert">
      {{ optionsError }}
      <button type="button" @click="emit('retryOptions')">{{ t("common.reload") }}</button>
    </p>
  </form>
</template>

<style scoped src="./PrSearchBar.css"></style>
