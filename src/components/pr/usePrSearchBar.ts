import { computed, reactive, ref, watch, type Ref } from "vue";
import type { PrListQuery, PrListSort, PrReviewFilter } from "@/types";

export function usePrSearchBar(
  query: Ref<PrListQuery>,
  onApply: (query: PrListQuery) => void,
  onClear: () => void,
) {
  const draft = reactive<PrListQuery>({ ...query.value });
  const titleDraft = ref(query.value.title);
  const activeFilterCount = computed(
    () =>
      [
        query.value.title,
        query.value.author,
        query.value.label,
        query.value.reviews,
        query.value.assignee,
        query.value.reviewer,
        query.value.sort !== "updated_desc",
      ].filter(Boolean).length,
  );
  const hasFilters = computed(() => activeFilterCount.value > 0);

  watch(query, (value) => Object.assign(draft, value), { deep: true });
  watch(
    () => query.value.title,
    (value) => {
      titleDraft.value = value;
    },
  );

  function apply() {
    titleDraft.value = titleDraft.value.trim();
    onApply({ ...draft, title: titleDraft.value });
  }

  function clear() {
    titleDraft.value = "";
    onClear();
  }

  function applyFilters() {
    onApply({ ...draft, title: query.value.title });
  }

  function setAuthor(value: string) {
    if (draft.author === value) return;
    draft.author = value;
    applyFilters();
  }

  function setLabel(value: string) {
    if (draft.label === value) return;
    draft.label = value;
    applyFilters();
  }

  function setAssignee(value: string) {
    if (draft.assignee === value) return;
    draft.assignee = value;
    applyFilters();
  }

  function setReviewer(value: string) {
    if (draft.reviewer === value) return;
    draft.reviewer = value;
    applyFilters();
  }

  function setReviews(value: string) {
    const reviews = (value || null) as PrReviewFilter | null;
    if (draft.reviews === reviews) return;
    draft.reviews = reviews;
    applyFilters();
  }

  function setSort(value: string) {
    const sort = value as PrListSort;
    if (draft.sort === sort) return;
    draft.sort = sort;
    applyFilters();
  }

  return {
    draft,
    titleDraft,
    hasFilters,
    activeFilterCount,
    apply,
    clear,
    setAuthor,
    setLabel,
    setAssignee,
    setReviewer,
    setReviews,
    setSort,
  };
}
