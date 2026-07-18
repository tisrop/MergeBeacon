import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReviewList from "@/components/review/ReviewList.vue";
import type { PrComment, Review } from "@/types";

const mocks = vi.hoisted(() => ({
  reviewList: vi.fn(),
  reviewCommentsList: vi.fn(),
  reviewThreadSetResolved: vi.fn(),
}));

vi.mock("@/api", () => mocks);

const author = {
  id: 1,
  login: "reviewer",
  name: "Reviewer",
  avatar_url: "",
};

function comment(overrides: Partial<PrComment>): PrComment {
  return {
    id: 100,
    body: "请补充边界测试",
    path: "src/main.ts",
    line: 12,
    start_line: null,
    author,
    created_at: "2026-07-16T10:00:00Z",
    commit_id: "head-1",
    original_commit_id: "head-1",
    original_line: 12,
    original_start_line: null,
    diff_hunk: "@@ -12 +12 @@\n-old\n+new",
    thread_id: "thread-1",
    reply_to_id: null,
    resolved: false,
    resolvable: true,
    ...overrides,
  };
}

const reviews: Review[] = [
  {
    id: 1,
    body: "整体需要修改",
    state: "CHANGES_REQUESTED",
    author,
    submitted_at: "2026-07-16T09:00:00Z",
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function mountList(extraProps: Record<string, unknown> = {}) {
  const wrapper = mount(ReviewList, {
    props: {
      platform: "gitlab",
      owner: "group",
      repo: "repo",
      prNumber: 9,
      headSha: "head-2",
      canResolveThreads: true,
      ...extraProps,
    },
  });
  await flushPromises();
  return wrapper;
}

describe("ReviewList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reviewList.mockResolvedValue(reviews);
    mocks.reviewCommentsList.mockResolvedValue([
      comment({}),
      comment({
        id: 101,
        body: "已经补上",
        created_at: "2026-07-16T11:00:00Z",
        reply_to_id: "100",
      }),
      comment({
        id: 200,
        body: "已处理线程",
        path: "src/other.ts",
        thread_id: "thread-2",
        resolved: true,
      }),
    ]);
    mocks.reviewThreadSetResolved.mockResolvedValue(undefined);
  });

  it("按 Discussion 组织行级评论并保留回复关系和过期状态", async () => {
    const wrapper = await mountList();

    expect(wrapper.findAll(".review-thread")).toHaveLength(2);
    expect(wrapper.findAll(".review-thread")[0].findAll(".thread-comments li")).toHaveLength(2);
    expect(wrapper.findAll(".review-thread")[0].find(".thread-comments li.reply").exists()).toBe(
      true,
    );
    expect(wrapper.findAll(".review-thread")[0].classes()).toContain("outdated");
    expect(wrapper.text()).toContain("代码已过期");
    expect(wrapper.emitted("threadSummary")?.at(-1)).toEqual([
      {
        comments: 3,
        threads: 2,
        unresolved: 1,
        by_file: {
          "src/main.ts": { comments: 2, unresolved: 1 },
          "src/other.ts": { comments: 1, unresolved: 0 },
        },
      },
    ]);
  });

  it("支持按解决状态筛选并通过平台 API 解决线程", async () => {
    const wrapper = await mountList();
    const unresolvedFilter = wrapper
      .findAll(".thread-filters button")
      .find((button) => button.text().startsWith("未解决"));
    expect(unresolvedFilter).toBeDefined();

    await unresolvedFilter?.trigger("click");
    expect(wrapper.findAll(".review-thread")).toHaveLength(1);

    await wrapper.get(".thread-status-actions .btn").trigger("click");
    await flushPromises();

    expect(mocks.reviewThreadSetResolved).toHaveBeenCalledWith(
      "gitlab",
      "group",
      "repo",
      9,
      "thread-1",
      true,
    );
    expect(wrapper.findAll(".review-thread")).toHaveLength(0);
  });

  it("平台不支持时只读展示解决状态，不渲染模拟操作", async () => {
    const wrapper = await mountList({ platform: "gitee", canResolveThreads: false });

    expect(wrapper.find(".thread-status-actions .btn").exists()).toBe(false);
    expect(wrapper.text()).toContain("未解决");
  });

  it("点击文件位置请求跳转到当前 Diff", async () => {
    const wrapper = await mountList();

    await wrapper.findAll(".path-button")[0].trigger("click");

    expect(wrapper.emitted("locateComment")?.[0]).toEqual(["src/main.ts", 12]);
  });

  it("切换 PR 后忽略旧列表请求的迟到响应", async () => {
    const oldReviews = deferred<Review[]>();
    const oldComments = deferred<PrComment[]>();
    mocks.reviewList.mockReset();
    mocks.reviewCommentsList.mockReset();
    mocks.reviewList.mockReturnValueOnce(oldReviews.promise).mockResolvedValueOnce([]);
    mocks.reviewCommentsList
      .mockReturnValueOnce(oldComments.promise)
      .mockResolvedValueOnce([
        comment({ body: "新 PR 的线程", path: "src/new.ts", thread_id: "new-thread" }),
      ]);

    const wrapper = await mountList();
    await wrapper.setProps({ repo: "repo-2", prNumber: 10 });
    await flushPromises();

    expect(wrapper.text()).toContain("新 PR 的线程");
    oldReviews.resolve(reviews);
    oldComments.resolve([comment({ body: "旧 PR 的迟到线程" })]);
    await flushPromises();

    expect(wrapper.text()).toContain("新 PR 的线程");
    expect(wrapper.text()).not.toContain("旧 PR 的迟到线程");
  });

  it("切换 PR 后忽略旧线程解决请求的迟到响应", async () => {
    const oldResolution = deferred<void>();
    mocks.reviewThreadSetResolved.mockReturnValueOnce(oldResolution.promise);
    const wrapper = await mountList();

    await wrapper.get(".thread-status-actions .btn").trigger("click");
    mocks.reviewList.mockResolvedValueOnce([]);
    mocks.reviewCommentsList.mockResolvedValueOnce([
      comment({ body: "新 PR 未解决线程", path: "src/new.ts", thread_id: "thread-1" }),
    ]);
    await wrapper.setProps({ repo: "repo-2", prNumber: 10 });
    await flushPromises();

    oldResolution.resolve(undefined);
    await flushPromises();

    expect(wrapper.text()).toContain("新 PR 未解决线程");
    expect(wrapper.get(".review-thread .resolution-badge").text()).toBe("未解决");
  });
});
