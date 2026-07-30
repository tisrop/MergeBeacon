import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { PrListQuery } from "@/types";
import { usePrSearchBar } from "@/components/pr/usePrSearchBar";

const emptyQuery = (): PrListQuery => ({
  title: "",
  author: "",
  label: "",
  reviews: null,
  assignee: "",
  sort: "updated_desc",
});

describe("usePrSearchBar", () => {
  it("将输入和排序作为同一份查询提交", () => {
    const onApply = vi.fn();
    const search = usePrSearchBar(ref(emptyQuery()), onApply, vi.fn());
    search.draft.title = "parser";
    search.draft.author = "octocat";
    search.setReviews("approved");
    search.setSort("comments_desc");

    search.apply();

    expect(onApply).toHaveBeenCalledWith({
      ...emptyQuery(),
      title: "parser",
      author: "octocat",
      reviews: "approved",
      sort: "comments_desc",
    });
  });

  it("默认的最近更新不计为活跃筛选，其他排序会显示清除入口", () => {
    const query = ref(emptyQuery());
    const search = usePrSearchBar(query, vi.fn(), vi.fn());
    expect(search.hasFilters.value).toBe(false);
    expect(search.activeFilterCount.value).toBe(0);

    query.value.sort = "created_desc";
    expect(search.hasFilters.value).toBe(true);
    expect(search.activeFilterCount.value).toBe(1);
  });
});
