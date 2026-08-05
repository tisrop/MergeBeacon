import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import PrSearchBar from "@/components/pr/PrSearchBar.vue";
import { setAppLocale } from "@/i18n";
import type { PrListQuery } from "@/types";

const query = (): PrListQuery => ({
  title: "",
  author: "",
  label: "",
  reviews: null,
  assignee: "",
  reviewer: "",
  sort: "updated_desc",
});

describe("PrSearchBar", () => {
  beforeEach(() => setAppLocale("zh-CN"));

  it.each([
    ["作者筛选", "所有作者"],
    ["标签筛选", "所有标签"],
    ["负责人筛选", "所有负责人"],
    ["评审状态筛选", "所有评审状态"],
    ["Pull Request 排序", "最近更新"],
  ])("点击 %s 可以展开下拉选项", async (accessibleName, selectedLabel) => {
    const wrapper = mount(PrSearchBar, { props: { query: query() } });
    const trigger = wrapper.get(`[aria-label="${accessibleName}"]`);

    expect(trigger.text()).toContain(selectedLabel);
    expect(trigger.attributes("aria-expanded")).toBe("false");

    await trigger.trigger("click");

    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".dropdown-panel").exists()).toBe(true);
  });

  it("自定义下拉框不嵌套在原生 label 中", () => {
    const wrapper = mount(PrSearchBar, { props: { query: query() } });

    expect(wrapper.find("label .app-select").exists()).toBe(false);
    expect(wrapper.findAll(".app-select")).toHaveLength(5);
    expect(wrapper.findAll('.search-filters input[type="text"]')).toHaveLength(0);
  });

  it.each(["github", "gitlab"] as const)("%s 使用评审状态和负责人筛选语义", (platform) => {
    const wrapper = mount(PrSearchBar, {
      props: { platform, query: query() },
    });

    expect(wrapper.get('[aria-label="负责人筛选"]').text()).toContain("所有负责人");
    expect(wrapper.get('[aria-label="评审状态筛选"]').text()).toContain("所有评审状态");
    expect(wrapper.text()).not.toContain("审查者");
    expect(wrapper.text()).not.toContain("测试者");
  });

  it("Gitee 使用审查者和测试者筛选文案并提供用户选择器", async () => {
    const wrapper = mount(PrSearchBar, {
      props: {
        platform: "gitee",
        query: query(),
        reviewerOptions: [{ value: "carol", label: "carol" }],
        assigneeOptions: [{ value: "maintainer", label: "maintainer" }],
      },
    });

    const testerFilter = wrapper.get('[aria-label="测试者筛选"]');
    expect(testerFilter.text()).toContain("所有测试者");
    await testerFilter.trigger("click");
    expect(wrapper.get('input[aria-label="搜索测试者"]').attributes("placeholder")).toBe(
      "搜索测试者",
    );

    const reviewerFilter = wrapper.get('[aria-label="审查者筛选"]');
    expect(reviewerFilter.text()).toContain("所有审查者");
    await reviewerFilter.trigger("click");
    expect(wrapper.get('input[aria-label="搜索审查者"]').attributes("placeholder")).toBe(
      "搜索审查者",
    );
    await wrapper.get('.dropdown-option[data-value="carol"]').trigger("click");

    const applied = wrapper.emitted<PrListQuery[]>("apply") ?? [];
    expect(applied.at(-1)?.[0]).toEqual({ ...query(), reviewer: "carol" });
  });

  it("Gitee 英文界面使用 Reviewers 和 Testers", () => {
    setAppLocale("en-US");
    const wrapper = mount(PrSearchBar, {
      props: { platform: "gitee", query: query() },
    });

    expect(wrapper.get('[aria-label="Tester filter"]').text()).toContain("All testers");
    expect(wrapper.get('[aria-label="Reviewer filter"]').text()).toContain("All reviewers");
  });

  it("下拉筛选改变时立即搜索，标题仍需提交表单后才生效", async () => {
    const wrapper = mount(PrSearchBar, {
      props: {
        query: query(),
        authorOptions: [{ value: "octocat", label: "octocat" }],
        labelOptions: [{ value: "bug", label: "bug" }],
        assigneeOptions: [{ value: "maintainer", label: "maintainer" }],
      },
    });
    const titleInput = wrapper.get<HTMLInputElement>("#pr-title-search");
    await titleInput.setValue("parser");

    for (const [accessibleName, value] of [
      ["作者筛选", "octocat"],
      ["标签筛选", "bug"],
      ["负责人筛选", "maintainer"],
      ["评审状态筛选", "approved"],
      ["Pull Request 排序", "comments_desc"],
    ]) {
      await wrapper.get(`[aria-label="${accessibleName}"]`).trigger("click");
      await wrapper.get(`.dropdown-option[data-value="${value}"]`).trigger("click");
    }

    const appliedQueries = wrapper.emitted<PrListQuery[]>("apply") ?? [];
    expect(appliedQueries).toHaveLength(5);
    expect(appliedQueries[0][0]).toEqual({ ...query(), author: "octocat" });
    expect(appliedQueries[4][0]).toEqual({
      ...query(),
      author: "octocat",
      label: "bug",
      assignee: "maintainer",
      reviews: "approved",
      sort: "comments_desc",
    });
    expect(titleInput.element.value).toBe("parser");

    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted<PrListQuery[]>("apply")?.at(-1)?.[0]).toEqual({
      ...query(),
      title: "parser",
      author: "octocat",
      label: "bug",
      assignee: "maintainer",
      reviews: "approved",
      sort: "comments_desc",
    });
  });
});
