import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSuggestion } from "@/types";
import AiReviewPanel from "../AiReviewPanel.vue";
import AiSuggestionCard from "../AiSuggestionCard.vue";
import {
  aiReviewCancel,
  aiReviewStream,
  prCompareDiff,
  reviewCommentAdd,
  reviewSubmit,
} from "@/api";

type EventCallback = (event: { payload: unknown }) => void;
const listeners = new Map<string, EventCallback[]>();
const unlisteners: ReturnType<typeof vi.fn>[] = [];
const storedReviews = new Map<string, string>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, callback: EventCallback) => {
    listeners.set(event, [...(listeners.get(event) ?? []), callback]);
    const unlisten = vi.fn();
    unlisteners.push(unlisten);
    return unlisten;
  }),
}));

vi.mock("@/api", () => ({
  aiReview: vi.fn(),
  aiReviewStream: vi.fn().mockResolvedValue(undefined),
  prCompareDiff: vi.fn(),
  aiReviewCancel: vi.fn().mockResolvedValue(undefined),
  reviewCommentAdd: vi.fn().mockResolvedValue(undefined),
  reviewSubmit: vi.fn().mockResolvedValue(undefined),
}));

function latestListener(event: string) {
  return listeners.get(event)?.at(-1);
}

function finishReview(
  suggestions: AiSuggestion[] = [
    {
      file: "src/main.ts",
      line_start: 10,
      line_end: 12,
      severity: "major",
      category: "逻辑",
      description: "这里可能产生竞态",
      suggestion: "增加请求序列校验",
    },
  ],
) {
  latestListener("ai-review-done")?.({
    payload: {
      request_id: "request-1",
      payload: { summary: "评审完成", suggestions },
    },
  });
}

type AiReviewPanelProps = InstanceType<typeof AiReviewPanel>["$props"];

function mountPanel(overrides: Partial<AiReviewPanelProps> = {}) {
  return mount(AiReviewPanel, {
    props: {
      platform: "github",
      owner: "octocat",
      repo: "hello-world",
      prNumber: 42,
      diff: "+changed",
      context: null,
      headSha: "head-sha-1",
      supportsCompareDiff: true,
      ...overrides,
    },
  });
}

describe("AiReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    unlisteners.length = 0;
    storedReviews.clear();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storedReviews.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storedReviews.set(key, value)),
      removeItem: vi.fn((key: string) => storedReviews.delete(key)),
      clear: vi.fn(() => storedReviews.clear()),
    });
    vi.mocked(aiReviewStream).mockResolvedValue(undefined);
    vi.mocked(aiReviewCancel).mockResolvedValue(undefined);
    vi.mocked(reviewCommentAdd).mockResolvedValue(
      {} as Awaited<ReturnType<typeof reviewCommentAdd>>,
    );
    vi.mocked(reviewSubmit).mockResolvedValue({} as Awaited<ReturnType<typeof reviewSubmit>>);
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockReturnValueOnce("request-1").mockReturnValueOnce("request-2"),
    });
  });

  it("完整评审成功后保存当前提交版本", async () => {
    const wrapper = mountPanel();

    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview([]);
    await wrapper.vm.$nextTick();

    expect(localStorage.getItem("mergebeacon:ai-review-head:github:octocat:hello-world:42")).toBe(
      "head-sha-1",
    );
    expect(wrapper.text()).toContain("评审版本：head-sha-1");
  });

  it("点击建议位置时向页面发出定位请求，并禁用旧版本建议", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview();
    await wrapper.vm.$nextTick();

    const locationButton = wrapper.get(".file-loc");
    await locationButton.trigger("click");
    expect(wrapper.emitted("locateSuggestion")?.at(-1)).toEqual([
      expect.objectContaining({ file: "src/main.ts", line_start: 10 }),
    ]);

    await wrapper.setProps({ headSha: "head-sha-2" });
    expect(wrapper.get(".file-loc").attributes("disabled")).toBeDefined();
  });

  it("流式评审只展示进度，不暴露原始 JSON", async () => {
    const wrapper = mountPanel();

    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    latestListener("ai-review-chunk")?.({
      payload: {
        request_id: "request-1",
        payload: '{"summary":"内部结构化结果"}',
      },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".stream-content").exists()).toBe(false);
    expect(wrapper.text()).not.toContain('"summary"');
    expect(wrapper.text()).toContain("正在整理评审摘要和代码建议");
  });

  it("使用上次成功版本与当前版本生成增量 Diff", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview([]);
    await wrapper.vm.$nextTick();

    await wrapper.setProps({ headSha: "head-sha-2", diff: "+complete-change" });
    vi.mocked(prCompareDiff).mockResolvedValueOnce({
      diff: "+incremental-change",
      files: [],
      patch_schema_version: 1,
      patches: [],
    });
    await wrapper.get("#ai-review-mode").trigger("click");
    await wrapper.get(".dropdown-option[data-value='incremental']").trigger("click");
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();

    expect(prCompareDiff).toHaveBeenCalledWith(
      "github",
      "octocat",
      "hello-world",
      "head-sha-1",
      "head-sha-2",
    );
    expect(aiReviewStream).toHaveBeenLastCalledWith(
      "request-2",
      expect.objectContaining({ diff: "+incremental-change" }),
    );
    expect(aiReviewStream).not.toHaveBeenLastCalledWith(
      "request-2",
      expect.objectContaining({ diff: "+complete-change" }),
    );
  });

  it("增量 Diff 获取失败时不启动 AI 且不回退完整评审", async () => {
    localStorage.setItem(
      "mergebeacon:ai-review-head:github:octocat:hello-world:42",
      "head-sha-old",
    );
    vi.mocked(prCompareDiff).mockRejectedValueOnce(new Error("compare unavailable"));
    const wrapper = mountPanel();

    await wrapper.get("#ai-review-mode").trigger("click");
    await wrapper.get(".dropdown-option[data-value='incremental']").trigger("click");
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.get(".error-box").text()).toContain("compare unavailable");
    expect(aiReviewStream).not.toHaveBeenCalled();
    expect(prCompareDiff).toHaveBeenCalledTimes(1);
  });

  it("增量 Diff 没有可评审文本时不启动 AI", async () => {
    localStorage.setItem(
      "mergebeacon:ai-review-head:github:octocat:hello-world:42",
      "head-sha-old",
    );
    vi.mocked(prCompareDiff).mockResolvedValueOnce({
      diff: "   ",
      files: [],
      patch_schema_version: 1,
      patches: [],
    });
    const wrapper = mountPanel();

    await wrapper.get("#ai-review-mode").trigger("click");
    await wrapper.get(".dropdown-option[data-value='incremental']").trigger("click");
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.get(".error-box").text()).toContain("未自动改用完整评审");
    expect(aiReviewStream).not.toHaveBeenCalled();
  });

  it("增量 Diff 请求未完成时卸载组件不会继续启动 AI", async () => {
    localStorage.setItem(
      "mergebeacon:ai-review-head:github:octocat:hello-world:42",
      "head-sha-old",
    );
    let resolveCompare!: (value: Awaited<ReturnType<typeof prCompareDiff>>) => void;
    vi.mocked(prCompareDiff).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCompare = resolve;
        }),
    );
    const wrapper = mountPanel();

    await wrapper.get("#ai-review-mode").trigger("click");
    await wrapper.get(".dropdown-option[data-value='incremental']").trigger("click");
    await wrapper.get("button.btn-primary").trigger("click");
    await wrapper.vm.$nextTick();
    expect(prCompareDiff).toHaveBeenCalledTimes(1);

    wrapper.unmount();
    resolveCompare({ diff: "+late-change", files: [], patch_schema_version: 1, patches: [] });
    await flushPromises();

    expect(aiReviewStream).not.toHaveBeenCalled();
  });

  it("缺少历史版本或平台不支持 compare 时禁用增量评审", async () => {
    const withoutHistory = mountPanel();
    await withoutHistory.get("#ai-review-mode").trigger("click");
    expect(
      withoutHistory.get(".dropdown-option[data-value='incremental']").attributes("disabled"),
    ).toBeDefined();
    expect(withoutHistory.text()).toContain("完成一次成功的完整评审后可用");
    withoutHistory.unmount();

    localStorage.setItem(
      "mergebeacon:ai-review-head:github:octocat:hello-world:42",
      "head-sha-old",
    );
    const unsupported = mountPanel({ supportsCompareDiff: false });
    await unsupported.get("#ai-review-mode").trigger("click");
    expect(
      unsupported.get(".dropdown-option[data-value='incremental']").attributes("disabled"),
    ).toBeDefined();
    expect(unsupported.text()).toContain("当前平台不提供可靠的提交比较接口");
  });

  it("只消费当前请求事件，并在重新评审和卸载时取消请求", async () => {
    const wrapper = mountPanel();
    const button = wrapper.get("button.btn-primary");

    await button.trigger("click");
    await flushPromises();
    expect(aiReviewStream).toHaveBeenCalledWith(
      "request-1",
      expect.objectContaining({ diff: "+changed" }),
    );

    latestListener("ai-review-chunk")?.({
      payload: { request_id: "another-request", payload: "不应显示" },
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).not.toContain("不应显示");

    latestListener("ai-review-chunk")?.({
      payload: { request_id: "request-1", payload: "当前响应" },
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("正在整理评审摘要和代码建议");

    await button.trigger("click");
    await flushPromises();
    expect(aiReviewCancel).toHaveBeenCalledWith("request-1");
    expect(aiReviewStream).toHaveBeenLastCalledWith(
      "request-2",
      expect.objectContaining({ diff: "+changed" }),
    );

    wrapper.unmount();
    await flushPromises();
    expect(aiReviewCancel).toHaveBeenCalledWith("request-2");
  });

  it("重新评审后忽略旧监听器交错到达的 chunk、done 和 error", async () => {
    const wrapper = mountPanel();
    const button = wrapper.get("button.btn-primary");

    await button.trigger("click");
    await flushPromises();
    const oldChunk = latestListener("ai-review-chunk");
    const oldDone = latestListener("ai-review-done");
    const oldError = latestListener("ai-review-error");

    await button.trigger("click");
    await flushPromises();
    oldChunk?.({ payload: { request_id: "request-1", payload: "旧响应" } });
    oldDone?.({
      payload: {
        request_id: "request-1",
        payload: { summary: "旧结果", suggestions: [] },
      },
    });
    oldError?.({ payload: { request_id: "request-1", payload: "旧错误" } });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).not.toContain("旧响应");
    expect(wrapper.text()).not.toContain("旧结果");
    expect(wrapper.text()).not.toContain("旧错误");
    expect(wrapper.text()).toContain("重新评审");
  });

  it("卸载时取消当前请求并解除全部事件监听", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    expect(unlisteners).toHaveLength(3);

    wrapper.unmount();
    await flushPromises();

    expect(aiReviewCancel).toHaveBeenCalledWith("request-1");
    expect(unlisteners.every((unlisten) => unlisten.mock.calls.length === 1)).toBe(true);
  });

  it("取消请求失败时不向用户显示错误", async () => {
    vi.mocked(aiReviewCancel).mockRejectedValueOnce(new Error("cancel failed"));
    const wrapper = mountPanel();
    const button = wrapper.get("button.btn-primary");

    await button.trigger("click");
    await flushPromises();
    await button.trigger("click");
    await flushPromises();

    expect(aiReviewStream).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".error-box").exists()).toBe(false);
  });

  it("PR 提交版本变化后标记 AI 结果过期", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();

    latestListener("ai-review-done")?.({
      payload: {
        request_id: "request-1",
        payload: { summary: "当前结果", suggestions: [] },
      },
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("评审版本：head-sha-1");
    expect(wrapper.find(".outdated-warning").exists()).toBe(false);

    await wrapper.setProps({ headSha: "head-sha-2" });

    expect(wrapper.find(".outdated-warning").text()).toContain("基于旧版本");
  });

  it("将 AI 行级建议加入可编辑草稿，确认前不写入远端", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview();
    await wrapper.vm.$nextTick();

    wrapper.findComponent(AiSuggestionCard).vm.$emit("action", "accept");
    await wrapper.vm.$nextTick();

    expect(reviewCommentAdd).not.toHaveBeenCalled();
    expect(reviewSubmit).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("提交前不会写入远端");

    const textarea = wrapper.get<HTMLTextAreaElement>("textarea[aria-label='评审草稿内容']");
    await textarea.setValue("编辑后的评审意见");
    await wrapper.get(".draft-panel button.btn-primary").trigger("click");
    await flushPromises();

    expect(reviewCommentAdd).toHaveBeenCalledWith(
      "github",
      "octocat",
      "hello-world",
      42,
      "head-sha-1",
      "src/main.ts",
      10,
      12,
      "right",
      "编辑后的评审意见",
    );
    expect(wrapper.text()).toContain("已提交 1 条评审意见");
    expect(wrapper.text()).toContain("已提交");
  });

  it("无有效行号的建议作为整体评论提交", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview([
      {
        file: "",
        line_start: null,
        line_end: null,
        severity: "info",
        category: "其他",
        description: "补充整体说明",
        suggestion: null,
      },
    ]);
    await wrapper.vm.$nextTick();
    wrapper.findComponent(AiSuggestionCard).vm.$emit("action", { edit: "" });
    await wrapper.vm.$nextTick();
    await wrapper.get(".draft-panel button.btn-primary").trigger("click");
    await flushPromises();

    expect(reviewSubmit).toHaveBeenCalledWith(
      "github",
      "octocat",
      "hello-world",
      42,
      "补充整体说明",
      "comment",
      [],
    );
    expect(reviewCommentAdd).not.toHaveBeenCalled();
  });

  it("PR 更新后禁止提交旧草稿，并保留用户内容", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview();
    await wrapper.vm.$nextTick();
    wrapper.findComponent(AiSuggestionCard).vm.$emit("action", "accept");
    await wrapper.vm.$nextTick();
    await wrapper.setProps({ headSha: "head-sha-2" });

    expect(wrapper.get(".draft-panel button.btn-primary").attributes("disabled")).toBeDefined();
    expect(wrapper.get("textarea").element.value).toContain("这里可能产生竞态");
    expect(reviewCommentAdd).not.toHaveBeenCalled();
  });

  it("部分成功时只保留失败草稿", async () => {
    vi.mocked(reviewCommentAdd)
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof reviewCommentAdd>>)
      .mockRejectedValueOnce("远端拒绝评论");
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview([
      {
        file: "src/a.ts",
        line_start: 1,
        line_end: 1,
        severity: "major",
        category: "逻辑",
        description: "第一条",
        suggestion: null,
      },
      {
        file: "src/b.ts",
        line_start: 2,
        line_end: 2,
        severity: "minor",
        category: "风格",
        description: "第二条",
        suggestion: null,
      },
    ]);
    await wrapper.vm.$nextTick();
    for (const card of wrapper.findAllComponents(AiSuggestionCard)) {
      card.vm.$emit("action", "accept");
    }
    await wrapper.vm.$nextTick();
    await wrapper.get(".draft-panel button.btn-primary").trigger("click");
    await flushPromises();

    expect(wrapper.findAll(".draft-item")).toHaveLength(1);
    expect(wrapper.get("textarea").element.value).toBe("第二条");
    expect(wrapper.text()).toContain("已提交 1 条，1 条失败：远端拒绝评论");
  });

  it("有未提交草稿时禁止重新评审且不丢弃内容", async () => {
    const wrapper = mountPanel();
    const reviewButton = wrapper.get(".ai-toolbar button.btn-primary");
    await reviewButton.trigger("click");
    await flushPromises();
    finishReview();
    await wrapper.vm.$nextTick();
    wrapper.findComponent(AiSuggestionCard).vm.$emit("action", "accept");
    await wrapper.vm.$nextTick();

    await reviewButton.trigger("click");
    await flushPromises();

    expect(aiReviewStream).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("已有未提交的评审草稿");
    expect(wrapper.findAll(".draft-item")).toHaveLength(1);
  });

  it("拒绝提交空白草稿", async () => {
    const wrapper = mountPanel();
    await wrapper.get("button.btn-primary").trigger("click");
    await flushPromises();
    finishReview();
    await wrapper.vm.$nextTick();
    wrapper.findComponent(AiSuggestionCard).vm.$emit("action", "accept");
    await wrapper.vm.$nextTick();
    await wrapper.get("textarea").setValue("   ");
    await wrapper.get(".draft-panel button.btn-primary").trigger("click");

    expect(wrapper.text()).toContain("评审草稿内容不能为空");
    expect(reviewCommentAdd).not.toHaveBeenCalled();
  });
});
