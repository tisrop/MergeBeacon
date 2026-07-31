import { computed, reactive, watch, type Ref } from "vue";
import type { PrListQuery, PrListSort, PrReviewFilter } from "@/types";

export function usePrSearchBar(
  query: Ref<PrListQuery>,
  onApply: (query: PrListQuery) => void,
  onClear: () => void,
) {
  const draft = reactive<PrListQuery>({ ...query.value });
  const activeFilterCount = computed(
    () =>
      [
        query.value.title,
        query.value.author,
        query.value.label,
        query.value.reviews,
        query.value.assignee,
        query.value.sort !== "updated_desc",
      ].filter(Boolean).length,
  );
  const hasFilters = computed(() => activeFilterCount.value > 0);

  watch(query, (value) => Object.assign(draft, value), { deep: true });

  function apply() {
    onApply({ ...draft });
  }

  function clear() {
    onClear();
  }

  function setReviews(value: string) {
    draft.reviews = (value || null) as PrReviewFilter | null;
  }

  function setSort(value: string) {
    draft.sort = value as PrListSort;
  }

  return { draft, hasFilters, activeFilterCount, apply, clear, setReviews, setSort };
}
