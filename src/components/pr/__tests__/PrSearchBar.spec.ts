import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PrSearchBar from "@/components/pr/PrSearchBar.vue";
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
  it.each([
    ["作者筛选", "所有作者"],
    ["标签筛选", "所有标签"],
    ["Assignee 筛选", "所有 Assignee"],
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
});
