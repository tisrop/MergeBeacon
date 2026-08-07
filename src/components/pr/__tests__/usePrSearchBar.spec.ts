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
  reviewer: "",
  sort: "updated_desc",
});

describe("usePrSearchBar", () => {
  it("点击搜索时提交标题和当前下拉筛选", () => {
    const onApply = vi.fn();
    const search = usePrSearchBar(ref(emptyQuery()), onApply, vi.fn());
    search.titleDraft.value = " parser ";
    search.draft.author = "octocat";
    search.draft.reviews = "approved";
    search.draft.sort = "comments_desc";

    search.apply();

    expect(onApply).toHaveBeenCalledWith({
      ...emptyQuery(),
      title: "parser",
      author: "octocat",
      reviews: "approved",
      sort: "comments_desc",
    });
  });

  it("下拉筛选改变时立即提交，但不提交尚未搜索的标题", () => {
    const onApply = vi.fn();
    const committed = emptyQuery();
    committed.title = "committed";
    const search = usePrSearchBar(ref(committed), onApply, vi.fn());
    search.titleDraft.value = "pending";

    search.setAuthor("octocat");
    search.setLabel("bug");
    search.setAssignee("maintainer");
    search.setReviews("approved");
    search.setReviewer("reviewer");
    search.setSort("comments_desc");

    expect(onApply).toHaveBeenCalledTimes(6);
    expect(onApply).toHaveBeenNthCalledWith(1, {
      ...committed,
      author: "octocat",
    });
    expect(onApply).toHaveBeenLastCalledWith({
      ...committed,
      author: "octocat",
      label: "bug",
      assignee: "maintainer",
      reviews: "approved",
      reviewer: "reviewer",
      sort: "comments_desc",
    });
    expect(search.titleDraft.value).toBe("pending");
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
