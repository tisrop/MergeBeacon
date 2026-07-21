import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prMergeQueueStatus } from "@/api";
import type { PrMergeQueueStatus } from "@/types";
import PrMergeQueuePanel from "../PrMergeQueuePanel.vue";

vi.mock("@/api", () => ({
  prMergeQueueStatus: vi.fn(),
}));

const queuedStatus: PrMergeQueueStatus = {
  kind: "merge_queue",
  available: true,
  state: "waiting",
  position: 2,
  total: 5,
  target_branch: "main",
  enqueued_at: "2026-07-21T01:00:00Z",
  updated_at: null,
  estimated_time_seconds: 420,
  head_sha: "queue-sha-1234567890",
  pipeline_status: null,
  failure_reason: null,
};

function mountPanel(overrides: Record<string, unknown> = {}) {
  return mount(PrMergeQueuePanel, {
    props: {
      platform: "github",
      owner: "team",
      repo: "repo",
      prNumber: 42,
      revision: "updated-1",
      queueKind: "merge_queue",
      ...overrides,
    },
  });
}

describe("PrMergeQueuePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prMergeQueueStatus).mockResolvedValue(queuedStatus);
  });

  it("展示 Merge Queue 状态、位置和提交", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    expect(prMergeQueueStatus).toHaveBeenCalledWith("github", "team", "repo", 42);
    expect(wrapper.text()).toContain("等待检查");
    expect(wrapper.text()).toContain("第 2 位 / 共 5 项");
    expect(wrapper.text()).toContain("main");
    expect(wrapper.text()).toContain("queue-sha-12");
    expect(wrapper.text()).toContain("约 7 分钟");
  });

  it("Gitee 明确展示不支持且不请求 API", async () => {
    const wrapper = mountPanel({ platform: "gitee", queueKind: null });
    await flushPromises();

    expect(wrapper.text()).toContain("Gitee API 不提供 Merge Queue 或 Merge Train");
    expect(prMergeQueueStatus).not.toHaveBeenCalled();
  });

  it("平台能力尚未加载时保持加载态且不误报不支持", async () => {
    const wrapper = mountPanel({ queueKind: undefined });
    await flushPromises();

    expect(wrapper.find(".queue-loading").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Gitee API 不提供");
    expect(prMergeQueueStatus).not.toHaveBeenCalled();
  });

  it("展示目标分支未启用队列的状态", async () => {
    vi.mocked(prMergeQueueStatus).mockResolvedValueOnce({
      ...queuedStatus,
      available: false,
      state: "unknown",
      failure_reason: "目标分支未启用 GitHub Merge Queue",
    });
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.text()).toContain("目标分支未启用 GitHub Merge Queue");
    expect(wrapper.find(".queue-status").exists()).toBe(false);
  });

  it("失败后允许重试", async () => {
    vi.mocked(prMergeQueueStatus)
      .mockRejectedValueOnce(new Error("队列请求失败"))
      .mockResolvedValueOnce(queuedStatus);
    const wrapper = mountPanel();
    await flushPromises();

    expect(wrapper.get(".queue-error").text()).toContain("队列请求失败");
    await wrapper.get(".queue-error button").trigger("click");
    await flushPromises();

    expect(prMergeQueueStatus).toHaveBeenCalledTimes(2);
    expect(wrapper.find(".queue-error").exists()).toBe(false);
  });

  it("切换 PR 后忽略迟到的队列请求", async () => {
    let resolveOld!: (value: PrMergeQueueStatus) => void;
    vi.mocked(prMergeQueueStatus)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...queuedStatus, position: 1 });
    const wrapper = mountPanel();
    await wrapper.setProps({ prNumber: 43, revision: "updated-2" });
    await flushPromises();
    resolveOld(queuedStatus);
    await flushPromises();

    expect(wrapper.text()).toContain("第 1 位 / 共 5 项");
    expect(wrapper.text()).not.toContain("第 2 位 / 共 5 项");
  });
});
