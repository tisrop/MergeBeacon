import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DiffCommitSelector from "@/components/diff/DiffCommitSelector.vue";
import type { PrCommitSummary } from "@/types";
import type { CommitRangeSelection } from "@/utils/commitRange";

function commit(sha: string, title: string, parents: string[] = []): PrCommitSummary {
  return {
    sha,
    title,
    author_name: "Alice",
    authored_at: "2026-07-19T10:00:00Z",
    parent_shas: parents,
  };
}

const commits = [
  commit("c1aaaaaa", "修复空指针", ["base0"]),
  commit("c2bbbbbb", "重构解析器", ["c1aaaaaa"]),
  commit("c3cccccc", "补充边界测试"),
];

type SelectorProps = InstanceType<typeof DiffCommitSelector>["$props"];

function mountSelector(overrides: Partial<SelectorProps> = {}) {
  return mount(DiffCommitSelector, {
    props: {
      commits,
      truncatedEnd: null,
      commitsLoading: false,
      commitsError: null,
      selection: null,
      rangeLoading: false,
      rangeError: null,
      ...overrides,
    },
    attachTo: document.body,
  });
}

type Wrapper = ReturnType<typeof mountSelector>;

async function openMenu(wrapper: Wrapper) {
  await wrapper.get(".commit-scope-trigger").trigger("click");
}

/** 菜单项第一项是「所有提交」，提交项从下标 1 开始。 */
function commitOption(wrapper: Wrapper, index: number) {
  return wrapper.findAll(".commit-scope-option")[index + 1];
}

function lastSelection(wrapper: Wrapper): CommitRangeSelection | null {
  const events = wrapper.emitted("update:selection");
  if (!events) throw new Error("没有发出 update:selection");
  return events.at(-1)?.[0] as CommitRangeSelection | null;
}

describe("DiffCommitSelector", () => {
  it("默认折叠为一个按钮，展示所有提交的变更", () => {
    const wrapper = mountSelector();

    expect(wrapper.get(".commit-scope-trigger").text()).toContain("所有提交的变更（3）");
    expect(wrapper.find(".commit-scope-menu").exists()).toBe(false);
    // 已经是整体视图时不提供多余的「查看所有变更」。
    expect(wrapper.find(".commit-scope-reset").exists()).toBe(false);
  });

  it("点击触发按钮展开浮层，再次点击收起", async () => {
    const wrapper = mountSelector();

    await openMenu(wrapper);
    expect(wrapper.get(".commit-scope-menu").isVisible()).toBe(true);
    expect(wrapper.get(".commit-scope-trigger").attributes("aria-expanded")).toBe("true");

    await wrapper.get(".commit-scope-trigger").trigger("click");
    expect(wrapper.find(".commit-scope-menu").exists()).toBe(false);
  });

  it("单击提交选中单个提交并收起浮层", async () => {
    const wrapper = mountSelector();
    await openMenu(wrapper);

    await commitOption(wrapper, 1).trigger("click");

    expect(lastSelection(wrapper)).toEqual({ startIndex: 1, endIndex: 1 });
    expect(wrapper.find(".commit-scope-menu").exists()).toBe(false);
  });

  it("Shift + 单击扩选为区间并保持浮层展开", async () => {
    const wrapper = mountSelector({ selection: { startIndex: 0, endIndex: 0 } });
    await openMenu(wrapper);

    await commitOption(wrapper, 2).trigger("click", { shiftKey: true });

    expect(lastSelection(wrapper)).toEqual({ startIndex: 0, endIndex: 2 });
    // 扩选后保持展开，便于确认区间。
    expect(wrapper.get(".commit-scope-menu").isVisible()).toBe(true);
  });

  it("Shift + Enter 与 Shift + 单击等价，保证键盘可选区间", async () => {
    const wrapper = mountSelector({ selection: { startIndex: 0, endIndex: 0 } });
    await openMenu(wrapper);
    const search = wrapper.get(".commit-scope-search");
    // 展开时高亮落在已选中的第 1 个提交上，再按两次向下即到第 3 个提交。
    await search.trigger("keydown", { key: "ArrowDown" });
    await search.trigger("keydown", { key: "ArrowDown" });
    expect(commitOption(wrapper, 2).classes()).toContain("highlighted");

    await search.trigger("keydown", { key: "Enter", shiftKey: true });

    expect(lastSelection(wrapper)).toEqual({ startIndex: 0, endIndex: 2 });
  });

  it("选择被外部重置后，Shift 扩选不再沿用陈旧锚点", async () => {
    // AI 建议定位、评论定位等路径直接重置 store 里的选择，不经过本组件。
    // 此时界面上没有任何选中态，Shift 扩选必须退化为选中单个提交。
    const wrapper = mountSelector();
    // 先真正点一次，让锚点落在提交 0 上——只靠 prop 设置选择是不会产生锚点的。
    await openMenu(wrapper);
    await commitOption(wrapper, 0).trigger("click");
    await wrapper.setProps({ selection: { startIndex: 0, endIndex: 0 } });

    await wrapper.setProps({ selection: null });
    await openMenu(wrapper);
    await commitOption(wrapper, 2).trigger("click", { shiftKey: true });

    expect(lastSelection(wrapper)).toEqual({ startIndex: 2, endIndex: 2 });
  });

  it("浮层的 ARIA 结构与应用内其他下拉一致", async () => {
    const wrapper = mountSelector();
    const trigger = wrapper.get(".commit-scope-trigger");

    expect(trigger.attributes("role")).toBe("combobox");
    expect(trigger.attributes("aria-haspopup")).toBe("listbox");
    expect(trigger.attributes("aria-expanded")).toBe("false");

    await openMenu(wrapper);

    expect(trigger.attributes("aria-expanded")).toBe("true");
    // listbox 只允许 option 子元素：搜索框必须在列表容器之外。
    const list = wrapper.get('[role="listbox"]');
    expect(list.classes()).toContain("commit-scope-list");
    expect(list.find(".commit-scope-search").exists()).toBe(false);
    expect(wrapper.find(".commit-scope-search").exists()).toBe(true);
  });

  it("触发按钮展示当前区间，选中项在浮层中标记", async () => {
    const wrapper = mountSelector({ selection: { startIndex: 1, endIndex: 2 } });

    expect(wrapper.get(".commit-scope-trigger").text()).toContain("2 个提交 · c2bbbbbb → c3cccccc");
    await openMenu(wrapper);

    expect(commitOption(wrapper, 0).classes()).not.toContain("selected");
    expect(commitOption(wrapper, 1).classes()).toContain("selected");
    expect(commitOption(wrapper, 2).classes()).toContain("selected");
  });

  it("选中单个提交时触发按钮展示该提交", () => {
    const wrapper = mountSelector({ selection: { startIndex: 0, endIndex: 0 } });

    expect(wrapper.get(".commit-scope-trigger").text()).toContain("c1aaaaaa 修复空指针");
  });

  it("浮层内的「所有提交」项回到整体 Diff", async () => {
    const wrapper = mountSelector({ selection: { startIndex: 1, endIndex: 1 } });
    await openMenu(wrapper);

    await wrapper.findAll(".commit-scope-option")[0].trigger("click");

    expect(lastSelection(wrapper)).toBeNull();
    expect(wrapper.find(".commit-scope-menu").exists()).toBe(false);
  });

  it("条上的「查看所有变更」也能回到整体 Diff", async () => {
    const wrapper = mountSelector({ selection: { startIndex: 1, endIndex: 1 } });

    await wrapper.get(".commit-scope-reset").trigger("click");

    expect(lastSelection(wrapper)).toBeNull();
  });

  it("搜索按提交号、标题和作者过滤", async () => {
    const wrapper = mountSelector();
    await openMenu(wrapper);

    await wrapper.get(".commit-scope-search").setValue("解析器");

    // 「所有提交」项不匹配查询，因此只剩目标提交。
    const options = wrapper.findAll(".commit-scope-option");
    expect(options).toHaveLength(1);
    expect(options[0].text()).toContain("重构解析器");
  });

  it("缺少最早的提交时提示的是「更早」（GitLab 方向）", async () => {
    const wrapper = mountSelector({ truncatedEnd: "oldest" });
    await openMenu(wrapper);

    const warning = wrapper.get(".commit-scope-warning").text();
    expect(warning).toContain("缺少更早的提交");
    expect(warning).not.toContain("缺少更新的提交");
  });

  it("缺少最新的提交时提示的是「更新」（GitHub / Gitee 方向）", async () => {
    const wrapper = mountSelector({ truncatedEnd: "newest" });
    await openMenu(wrapper);

    const warning = wrapper.get(".commit-scope-warning").text();
    expect(warning).toContain("缺少更新的提交");
    expect(warning).not.toContain("缺少更早的提交");
  });

  it("列表完整时不显示截断提示", async () => {
    const wrapper = mountSelector();
    await openMenu(wrapper);

    expect(wrapper.find(".commit-scope-warning").exists()).toBe(false);
    expect(wrapper.find(".commit-scope-flag").exists()).toBe(false);
  });

  it("读取提交失败时展示错误并可重试", async () => {
    const wrapper = mountSelector({ commitsError: "读取提交失败" });

    expect(wrapper.get(".commit-scope-error").text()).toContain("读取提交失败");
    await wrapper.get(".commit-scope-error .commit-scope-reset").trigger("click");

    expect(wrapper.emitted("retry")).toHaveLength(1);
  });

  it("区间 Diff 报错时在范围条上展示原因", () => {
    const wrapper = mountSelector({
      selection: { startIndex: 0, endIndex: 0 },
      rangeError: "无法确定所选提交的对比基准，请改用整体 Diff。",
    });

    expect(wrapper.get(".commit-scope-error").text()).toContain("无法确定所选提交的对比基准");
  });

  it("区间 Diff 加载中时选择器仍可操作", async () => {
    const wrapper = mountSelector({
      selection: { startIndex: 0, endIndex: 0 },
      rangeLoading: true,
    });

    expect(wrapper.get(".commit-scope-status").text()).toContain("正在读取");
    // 加载中不能锁住控件，否则用户无法切回整体 Diff。
    expect(wrapper.get(".commit-scope-trigger").attributes("disabled")).toBeUndefined();
    await openMenu(wrapper);
    expect(wrapper.get(".commit-scope-menu").isVisible()).toBe(true);
  });
});
