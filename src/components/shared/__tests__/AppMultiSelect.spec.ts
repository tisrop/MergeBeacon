import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppMultiSelect from "@/components/shared/AppMultiSelect.vue";

const options = [
  { value: "bug", label: "bug", color: "#d73a4a", description: "需要修复的问题" },
  { value: "feature", label: "feature", color: "#a2eeef", description: "新功能" },
  { value: "frontend", label: "frontend" },
];

describe("AppMultiSelect", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("搜索后可以连续选择多个选项且保持下拉打开", async () => {
    const wrapper = mount(AppMultiSelect, {
      props: { modelValue: [], options, searchPlaceholder: "搜索标签" },
    });

    await wrapper.get('[role="combobox"]').trigger("click");
    const swatch = wrapper.get(".multi-select-swatch");
    expect(swatch.attributes("style")).toBeUndefined();
    expect(swatch.classes().some((name) => name.startsWith("mb-static-label-color-"))).toBe(true);
    expect(wrapper.text()).toContain("需要修复的问题");
    await wrapper.get('input[placeholder="搜索标签"]').setValue("front");
    await wrapper.get(".multi-select-option[data-value='frontend']").trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([[["frontend"]]]);
    expect(wrapper.find(".multi-select-dropdown").exists()).toBe(true);

    await wrapper.setProps({ modelValue: ["frontend"] });
    await wrapper.get('input[placeholder="搜索标签"]').setValue("");
    await wrapper.get(".multi-select-option[data-value='bug']").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([["bug", "frontend"]]);
  });

  it("使用固定尺寸 SVG 箭头并在展开时旋转", async () => {
    const wrapper = mount(AppMultiSelect, { props: { modelValue: [], options } });
    const chevron = wrapper.get("svg.app-multi-select-chevron");

    expect(chevron.attributes("width")).toBe("12");
    expect(chevron.attributes("height")).toBe("12");
    expect(chevron.classes()).not.toContain("open");

    await wrapper.get('[role="combobox"]').trigger("click");
    expect(chevron.classes()).toContain("open");
  });

  it("中文输入法组合态回车不会误选标签", async () => {
    const wrapper = mount(AppMultiSelect, { props: { modelValue: [], options } });

    await wrapper.get('[role="combobox"]').trigger("click");
    const search = wrapper.get('input[type="search"]');
    await search.setValue("feature");
    await search.trigger("keydown", { key: "Enter", keyCode: 229, isComposing: true });

    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(wrapper.find(".multi-select-dropdown").exists()).toBe(true);
  });

  it("没有选项时显示调用方配置的空状态", async () => {
    const wrapper = mount(AppMultiSelect, {
      props: { modelValue: [], options: [], emptyText: "仓库暂无成员" },
    });

    await wrapper.get('[role="combobox"]').trigger("click");
    expect(wrapper.get(".multi-select-empty").text()).toBe("仓库暂无成员");
  });

  it("禁用时不展开并退出键盘焦点顺序", async () => {
    const wrapper = mount(AppMultiSelect, {
      props: { modelValue: ["bug"], options, disabled: true },
    });
    const trigger = wrapper.get('[role="combobox"]');

    expect(trigger.attributes("aria-disabled")).toBe("true");
    expect(trigger.attributes("tabindex")).toBe("-1");
    await trigger.trigger("click");

    expect(wrapper.find(".multi-select-dropdown").exists()).toBe(false);
  });

  it("搜索无结果时显示调用方配置的空状态", async () => {
    const wrapper = mount(AppMultiSelect, { props: { modelValue: [], options: [] } });

    await wrapper.get('[role="combobox"]').trigger("click");
    await wrapper.get('input[type="search"]').setValue("missing");
    await wrapper.setProps({ emptySearchText: "没有匹配成员" });

    expect(wrapper.get(".multi-select-empty").text()).toBe("没有匹配成员");
  });

  it("点击组件外部后关闭下拉并清空搜索", async () => {
    const wrapper = mount(AppMultiSelect, {
      props: { modelValue: [], options },
      attachTo: document.body,
    });

    await wrapper.get('[role="combobox"]').trigger("click");
    await wrapper.get('input[type="search"]').setValue("feature");
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".multi-select-dropdown").exists()).toBe(false);
    await wrapper.get('[role="combobox"]').trigger("click");
    expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe("");
    wrapper.unmount();
  });

  it("触发器靠近视口底部时向上展开下拉框", async () => {
    vi.stubGlobal("innerHeight", 760);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("app-multi-select")) {
          return {
            x: 20,
            y: 700,
            top: 700,
            right: 420,
            bottom: 738,
            left: 20,
            width: 400,
            height: 38,
            toJSON: () => ({}),
          };
        }
        return {
          x: 0,
          y: 0,
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          width: 0,
          height: 0,
          toJSON: () => ({}),
        };
      },
    );
    const wrapper = mount(AppMultiSelect, { props: { modelValue: [], options } });

    await wrapper.get('[role="combobox"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.get(".multi-select-dropdown").classes()).toContain("multi-select-dropdown-up");
  });
});
