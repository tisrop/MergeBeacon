<script setup lang="ts">
import { toRef } from "vue";
import type { PrListQuery } from "@/types";
import AppSelect from "@/components/shared/AppSelect.vue";
import { usePrSearchBar } from "./usePrSearchBar";

type FilterOption = { value: string; label: string };

const props = withDefaults(
  defineProps<{
    query: PrListQuery;
    loading?: boolean;
    optionsLoading?: boolean;
    optionsError?: string | null;
    authorOptions?: FilterOption[];
    labelOptions?: FilterOption[];
    assigneeOptions?: FilterOption[];
  }>(),
  {
    optionsError: null,
    authorOptions: () => [],
    labelOptions: () => [],
    assigneeOptions: () => [],
  },
);
const emit = defineEmits<{ apply: [query: PrListQuery]; clear: []; retryOptions: [] }>();
const reviewOptions = [
  { value: "", label: "所有评审状态" },
  { value: "none", label: "无评审" },
  { value: "required", label: "需要评审" },
  { value: "approved", label: "已批准" },
  { value: "changes_requested", label: "要求更改" },
];
const sortOptions = [
  { value: "best_match", label: "最佳匹配" },
  { value: "updated_desc", label: "最近更新" },
  { value: "updated_asc", label: "最早更新" },
  { value: "created_desc", label: "最新创建" },
  { value: "created_asc", label: "最早创建" },
  { value: "comments_desc", label: "评论最多" },
  { value: "comments_asc", label: "评论最少" },
];
const withAllOption = (label: string, options: FilterOption[]) => [
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
  <form class="pr-search" role="search" aria-label="筛选 Pull Request" @submit.prevent="apply">
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
      <label class="sr-only" for="pr-title-search">按标题搜索</label>
      <input
        id="pr-title-search"
        v-model="draft.title"
        class="search-title-input"
        type="search"
        autocomplete="off"
        placeholder="搜索标题"
      />
      <button class="btn btn-sm btn-primary search-submit" type="submit" :disabled="loading">
        搜索
      </button>
    </div>

    <div class="search-filters" aria-label="高级筛选">
      <div class="filter-field select-field">
        <span>作者</span>
        <AppSelect
          aria-label="作者筛选"
          searchable
          search-placeholder="搜索作者"
          :disabled="optionsLoading"
          :model-value="draft.author"
          :options="withAllOption('所有作者', authorOptions)"
          @update:model-value="draft.author = $event"
        />
      </div>
      <div class="filter-field select-field">
        <span>标签</span>
        <AppSelect
          aria-label="标签筛选"
          searchable
          search-placeholder="搜索标签"
          :disabled="optionsLoading"
          :model-value="draft.label"
          :options="withAllOption('所有标签', labelOptions)"
          @update:model-value="draft.label = $event"
        />
      </div>
      <div class="filter-field select-field">
        <span>Assignee</span>
        <AppSelect
          aria-label="Assignee 筛选"
          searchable
          search-placeholder="搜索 Assignee"
          :disabled="optionsLoading"
          :model-value="draft.assignee"
          :options="withAllOption('所有 Assignee', assigneeOptions)"
          @update:model-value="draft.assignee = $event"
        />
      </div>
      <div class="filter-field select-field">
        <span>Reviews</span>
        <AppSelect
          aria-label="评审状态筛选"
          :model-value="draft.reviews ?? ''"
          :options="reviewOptions"
          @update:model-value="setReviews"
        />
      </div>
      <div class="filter-field select-field sort-field">
        <span>排序</span>
        <AppSelect
          aria-label="Pull Request 排序"
          :model-value="draft.sort"
          :options="sortOptions"
          @update:model-value="setSort"
        />
      </div>
      <button v-if="hasFilters" class="clear-filters" type="button" @click="clear">
        清除筛选<span v-if="activeFilterCount">（{{ activeFilterCount }}）</span>
      </button>
    </div>
    <p v-if="optionsError" class="filter-options-error" role="alert">
      {{ optionsError }}
      <button type="button" @click="emit('retryOptions')">重新加载</button>
    </p>
  </form>
</template>

<style scoped src="./PrSearchBar.css"></style>
