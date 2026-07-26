import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import IssueForm from "../IssueForm.vue";
import type { IssueTemplate, PrLabel } from "@/types";

const availableLabels: PrLabel[] = [
  { name: "bug", color: "d73a4a", description: "缺陷" },
  { name: "frontend", color: null, description: null },
];
const templates: IssueTemplate[] = [
  {
    name: "Bug 报告",
    description: "提交可复现的缺陷",
    title: "[Bug] ",
    body: "## 复现步骤",
    labels: ["bug"],
    source_path: ".github/ISSUE_TEMPLATE/bug.md",
  },
];

function mountForm(overrides: Partial<InstanceType<typeof IssueForm>["$props"]> = {}) {
  return mount(IssueForm, {
    props: {
      title: "",
      body: "",
      labels: [],
      availableLabels,
      labelsLoading: false,
      labelsError: "",
      templates,
      selectedTemplatePath: "",
      templatesLoading: false,
      templatesError: "",
      error: "",
      submitting: false,
      ...overrides,
    },
    global: {
      stubs: {
        RouterLink: {
          props: ["to"],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  });
}

describe("IssueForm", () => {
  it("标题为空时禁用创建按钮，填写标题后可提交表单", async () => {
    const wrapper = mountForm();
    const submitButton = wrapper.get<HTMLButtonElement>('button[type="submit"]');

    expect(submitButton.element.disabled).toBe(true);

    await wrapper.setProps({ title: "修复 Issue 创建页布局" });
    expect(submitButton.element.disabled).toBe(false);

    await wrapper.get("form").trigger("submit");
    expect(wrapper.emitted("submit")).toHaveLength(1);
  });

  it("从目标仓库标签中选择多个标签", async () => {
    const wrapper = mountForm();

    await wrapper.get('[aria-label="选择 Issue 标签"]').trigger("click");
    await wrapper.get('.multi-select-option[data-value="bug"]').trigger("click");

    expect(wrapper.emitted("update:labels")).toEqual([[["bug"]]]);
    expect(wrapper.text()).toContain("缺陷");
  });

  it("明确标签仅可从目标仓库已有标签中选择", () => {
    const wrapper = mountForm();

    expect(wrapper.text()).toContain(
      "仅可选择目标仓库已有标签；如需新标签，请先在代码托管平台创建。",
    );
    expect(wrapper.find('input[placeholder="输入标签后回车"]').exists()).toBe(false);
  });

  it("标签加载时禁用选择器，失败时提供重试", async () => {
    const wrapper = mountForm({ labelsLoading: true, labelsError: "标签加载失败" });

    expect(wrapper.get('[aria-label="选择 Issue 标签"]').classes()).toContain("disabled");
    expect(wrapper.text()).toContain("标签加载失败");
    await wrapper.findAll(".field-retry").at(-1)!.trigger("click");
    expect(wrapper.emitted("reload-labels")).toHaveLength(1);
  });

  it("选择模板后显式触发应用，不会在选择时直接覆盖内容", async () => {
    const wrapper = mountForm();

    await wrapper.get('[aria-label="选择 Issue 创建模板"]').trigger("click");
    await wrapper
      .get('.dropdown-option[data-value=".github/ISSUE_TEMPLATE/bug.md"]')
      .trigger("click");

    expect(wrapper.emitted("update:selectedTemplatePath")).toEqual([
      [".github/ISSUE_TEMPLATE/bug.md"],
    ]);
    expect(wrapper.emitted("apply-template")).toBeUndefined();

    await wrapper.setProps({ selectedTemplatePath: ".github/ISSUE_TEMPLATE/bug.md" });
    expect(wrapper.text()).toContain("提交可复现的缺陷");
    await wrapper.get(".template-controls .btn").trigger("click");
    expect(wrapper.emitted("apply-template")).toHaveLength(1);
  });

  it("模板加载失败时允许重试并提示仍可手动填写", async () => {
    const wrapper = mountForm({ templates: [], templatesError: "模板加载失败" });

    expect(wrapper.text()).toContain("仍可手动填写 Issue");
    await wrapper.findAll(".field-retry")[0].trigger("click");
    expect(wrapper.emitted("reload-templates")).toHaveLength(1);
  });
});
