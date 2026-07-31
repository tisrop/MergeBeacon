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

  it("Gitee 使用审查者和测试者筛选文案并禁用不支持的要求更改", async () => {
    const wrapper = mount(PrSearchBar, {
      props: { platform: "gitee", query: query() },
    });

    const testerFilter = wrapper.get('[aria-label="测试者筛选"]');
    expect(testerFilter.text()).toContain("所有测试者");
    await testerFilter.trigger("click");
    expect(wrapper.get('input[aria-label="搜索测试者"]').attributes("placeholder")).toBe(
      "搜索测试者",
    );

    const reviewerFilter = wrapper.get('[aria-label="审查者状态筛选"]');
    expect(reviewerFilter.text()).toContain("所有审查状态");
    await reviewerFilter.trigger("click");

    const option = wrapper.get<HTMLButtonElement>(
      '.dropdown-option[data-value="changes_requested"]',
    );
    expect(option.text()).toBe("要求更改（Gitee 不支持）");
    expect(option.element.disabled).toBe(true);
  });

  it("Gitee 英文界面使用 Reviewers 和 Testers", () => {
    setAppLocale("en-US");
    const wrapper = mount(PrSearchBar, {
      props: { platform: "gitee", query: query() },
    });

    expect(wrapper.get('[aria-label="Tester filter"]').text()).toContain("All testers");
    expect(wrapper.get('[aria-label="Reviewer status filter"]').text()).toContain(
      "All review states",
    );
  });
});
