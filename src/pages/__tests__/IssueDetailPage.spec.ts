import { createPinia, setActivePinia } from "pinia";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IssueDetailPage from "@/pages/IssueDetailPage.vue";
import IssueListPage from "@/pages/IssueListPage.vue";
import { setAppLocale } from "@/i18n";
import {
  issueCommentAdd,
  issueCommentsList,
  issueDetail,
  issueList,
  issueMetadataUpdate,
  listRepositoryLabels,
} from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";
import { useIssueStore } from "@/stores/useIssueStore";
import { useRepoStore } from "@/stores/useRepoStore";
import type { Issue, IssueComment, IssueSummary } from "@/types";

vi.mock("@/api", () => ({
  issueCommentAdd: vi.fn(),
  issueCommentsList: vi.fn(),
  issueDetail: vi.fn(),
  issueList: vi.fn(),
  issueMetadataUpdate: vi.fn(),
  listRepositoryLabels: vi.fn(),
}));

enableAutoUnmount(afterEach);

afterEach(() => {
  document.body.innerHTML = "";
});

const issue: Issue = {
  number: 12,
  title: "详情页支持 Markdown",
  body: "## 复现步骤\n\n- 打开 Issue",
  author: { id: 1, login: "reporter", name: "Reporter", avatar_url: "" },
  state: "open",
  labels: ["bug", "frontend"],
  label_colors: { bug: "d73a4a", frontend: "fbca04" },
  created_at: "2026-07-25T10:00:00Z",
  updated_at: "2026-07-26T10:00:00Z",
  metadata_permissions: {
    can_edit_title_body: true,
    can_change_state: true,
    can_manage_labels: true,
  },
};
const comment: IssueComment = {
  id: 101,
  body: "我也遇到了这个问题。",
  author: { id: 2, login: "reviewer", name: "Reviewer", avatar_url: "" },
  created_at: "2026-07-26T11:00:00Z",
  updated_at: "2026-07-26T11:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function createRouterAt(path: string): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/issue", name: "issue-list", component: IssueListPage },
      {
        path: "/issue/:platform/:owner/:repo/:number",
        name: "issue-detail",
        component: IssueDetailPage,
      },
    ],
  });
  await router.push(path);
  await router.isReady();
  return router;
}

function mountWithRouter(component: typeof IssueDetailPage | typeof IssueListPage, router: Router) {
  return mount(component, {
    global: {
      plugins: [router],
      stubs: {
        AppLayout: {
          template: '<div><slot name="header"/><slot/></div>',
        },
        MarkdownRenderer: {
          props: ["content", "variant"],
          template: '<div class="markdown-stub" :data-variant="variant">{{ content }}</div>',
        },
      },
    },
  });
}

describe("IssueDetailPage", () => {
  beforeEach(() => {
    setAppLocale("zh-CN");
    vi.clearAllMocks();
    vi.mocked(issueCommentsList).mockResolvedValue([]);
    vi.mocked(listRepositoryLabels).mockResolvedValue([]);
  });

  it("按路由参数加载并展示 Issue 详情", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    const router = await createRouterAt("/issue/github/team/repo/12");

    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    expect(issueDetail).toHaveBeenCalledWith("github", "team", "repo", 12);
    expect(issueCommentsList).toHaveBeenCalledWith("github", "team", "repo", 12);
    expect(wrapper.text()).toContain("详情页支持 Markdown");
    expect(wrapper.text()).toContain("reporter");
    expect(wrapper.text()).toContain("bug");
    const tags = wrapper.findAll(".issue-detail-labels .label-tag");
    expect(tags).toHaveLength(2);
    expect(
      tags.every((tag) =>
        tag.classes().some((name) => name.startsWith("mb-static-label-tag-color-")),
      ),
    ).toBe(true);
    expect(wrapper.text()).toContain("## 复现步骤");
    expect(wrapper.get(".markdown-stub").attributes("data-variant")).toBe("document");
  });

  it("切换界面语言后更新详情操作但保留远端内容", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    setAppLocale("en-US");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Issue details");
    expect(wrapper.text()).toContain("Close issue");
    expect(wrapper.text()).toContain("详情页支持 Markdown");
    expect(wrapper.text()).not.toContain("返回 Issue 列表");
  });

  it("路由快速切换时忽略旧请求结果", async () => {
    const first = deferred<Issue>();
    const second = deferred<Issue>();
    vi.mocked(issueDetail).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);

    await router.push("/issue/github/team/repo/13");
    second.resolve({ ...issue, number: 13, title: "新的 Issue" });
    await flushPromises();
    first.resolve({ ...issue, title: "旧的 Issue" });
    await flushPromises();

    expect(wrapper.text()).toContain("新的 Issue");
    expect(wrapper.text()).not.toContain("旧的 Issue");
  });

  it("加载失败时展示可重试错误态", async () => {
    vi.mocked(issueDetail).mockRejectedValue(new Error("远端不可用"));
    const router = await createRouterAt("/issue/github/team/repo/12");

    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    expect(wrapper.text()).toContain("远端不可用");
    expect(wrapper.get("button").text()).toContain("重新加载");
  });

  it("编辑并保存 Issue 元数据时携带远端更新时间", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    vi.mocked(listRepositoryLabels).mockResolvedValue([
      { name: "bug", color: "d73a4a", description: "缺陷" },
      { name: "frontend", color: "1d76db", description: null },
    ]);
    vi.mocked(issueMetadataUpdate).mockResolvedValue({
      ...issue,
      title: "更新后的标题",
      body: "更新后的描述",
    });
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    await wrapper.get("button.btn-sm").trigger("click");
    await flushPromises();
    await wrapper.get(".issue-editor-title input").setValue("更新后的标题");
    await wrapper.get(".issue-editor-body").setValue("更新后的描述");
    await wrapper.get(".issue-metadata-editor").trigger("submit");
    await flushPromises();

    expect(issueMetadataUpdate).toHaveBeenCalledWith("github", "team", "repo", 12, {
      title: "更新后的标题",
      body: "更新后的描述",
      state: "open",
      labels: ["bug", "frontend"],
      expected_updated_at: "2026-07-26T10:00:00Z",
    });
    expect(wrapper.text()).toContain("更新后的标题");
    expect(wrapper.text()).toContain("Issue 元数据已更新");
  });

  it("确认后关闭 Issue，并携带当前元数据和远端更新时间", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    vi.mocked(issueMetadataUpdate).mockResolvedValue({
      ...issue,
      state: "closed",
      updated_at: "2026-07-26T12:00:00Z",
    });
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    await wrapper.get('[data-testid="open-close-issue"]').trigger("click");
    await flushPromises();
    const dialog = document.body.querySelector('[data-testid="close-confirm-dialog"]');
    expect(dialog?.textContent).toContain("team/repo");
    expect(dialog?.textContent).toContain("#12 详情页支持 Markdown");
    document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]')?.click();
    await flushPromises();

    expect(issueMetadataUpdate).toHaveBeenCalledWith("github", "team", "repo", 12, {
      title: "详情页支持 Markdown",
      body: "## 复现步骤\n\n- 打开 Issue",
      state: "closed",
      labels: ["bug", "frontend"],
      expected_updated_at: "2026-07-26T10:00:00Z",
    });
    expect(wrapper.text()).toContain("Issue 已关闭");
    expect(wrapper.get(".badge-closed").text()).toBe("已关闭");
    expect(wrapper.find('[data-testid="open-close-issue"]').exists()).toBe(false);
  });

  it("取消关闭时不提交 Issue 更新", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    await wrapper.get('[data-testid="open-close-issue"]').trigger("click");
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="cancel-close"]')?.click();
    await flushPromises();

    expect(issueMetadataUpdate).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="close-confirm-dialog"]')).toBeNull();
  });

  it("关闭失败时保留确认框并展示可操作错误", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    vi.mocked(issueMetadataUpdate).mockRejectedValue(new Error("远端拒绝关闭"));
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    await wrapper.get('[data-testid="open-close-issue"]').trigger("click");
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]')?.click();
    await flushPromises();

    expect(document.body.querySelector('[data-testid="close-confirm-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("远端拒绝关闭");
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]')?.disabled,
    ).toBe(false);
  });

  it("路由切换后忽略旧 Issue 的关闭结果", async () => {
    const closeRequest = deferred<Issue>();
    vi.mocked(issueDetail)
      .mockResolvedValueOnce(issue)
      .mockResolvedValue({ ...issue, number: 13, title: "新的 Issue" });
    vi.mocked(issueMetadataUpdate).mockReturnValue(closeRequest.promise);
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    await wrapper.get('[data-testid="open-close-issue"]').trigger("click");
    await flushPromises();
    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-close"]',
    );
    confirmButton?.click();
    confirmButton?.click();
    await flushPromises();

    expect(issueMetadataUpdate).toHaveBeenCalledOnce();
    expect(confirmButton?.disabled).toBe(true);
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="cancel-close"]')?.disabled,
    ).toBe(true);

    await router.push("/issue/github/team/repo/13");
    await flushPromises();
    closeRequest.resolve({ ...issue, state: "closed" });
    await flushPromises();

    expect(wrapper.text()).toContain("新的 Issue");
    expect(wrapper.text()).not.toContain("Issue 已关闭");
    expect(wrapper.get(".badge-open").text()).toBe("开启");
  });

  it("没有任何元数据权限时不展示编辑入口", async () => {
    vi.mocked(issueDetail).mockResolvedValue({
      ...issue,
      metadata_permissions: {
        can_edit_title_body: false,
        can_change_state: false,
        can_manage_labels: false,
      },
    });
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    expect(wrapper.findAll("button").some((button) => button.text() === "编辑")).toBe(false);
    expect(wrapper.find('[data-testid="open-close-issue"]').exists()).toBe(false);
  });

  it("元数据权限未知时不展示编辑入口", async () => {
    vi.mocked(issueDetail).mockResolvedValue({
      ...issue,
      metadata_permissions: {
        can_edit_title_body: null,
        can_change_state: null,
        can_manage_labels: null,
      },
    });
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    expect(wrapper.findAll("button").some((button) => button.text() === "编辑")).toBe(false);
    expect(wrapper.find('[data-testid="open-close-issue"]').exists()).toBe(false);
  });

  it("按字段权限禁用状态和标签编辑", async () => {
    vi.mocked(issueDetail).mockResolvedValue({
      ...issue,
      metadata_permissions: {
        can_edit_title_body: true,
        can_change_state: false,
        can_manage_labels: false,
      },
    });
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    const editButton = wrapper.findAll("button").find((button) => button.text() === "编辑");
    expect(editButton).toBeDefined();
    await editButton!.trigger("click");

    expect(wrapper.get<HTMLInputElement>(".issue-editor-title input").element.disabled).toBe(false);
    expect(wrapper.get('[aria-label="Issue 状态"]').attributes("aria-disabled")).toBe("true");
    expect(wrapper.get('[aria-label="选择 Issue 标签"]').attributes("aria-disabled")).toBe("true");
    expect(listRepositoryLabels).not.toHaveBeenCalled();
  });

  it("展示评论并支持发表评论", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    vi.mocked(issueCommentsList).mockResolvedValue([comment]);
    vi.mocked(issueCommentAdd).mockResolvedValue({
      ...comment,
      id: 102,
      body: "已补充复现日志。",
      author: { ...comment.author, login: "reporter" },
    });
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    expect(wrapper.text()).toContain("我也遇到了这个问题。");
    expect(
      wrapper
        .findAll(".markdown-stub")
        .every((node) => node.attributes("data-variant") === "document"),
    ).toBe(true);
    await wrapper.get("#issue-comment-body").setValue("已补充复现日志。");
    await wrapper.get(".issue-comment-composer").trigger("submit");
    await flushPromises();

    expect(issueCommentAdd).toHaveBeenCalledWith("github", "team", "repo", 12, "已补充复现日志。");
    expect(wrapper.text()).toContain("已补充复现日志。");
    expect(wrapper.get<HTMLTextAreaElement>("#issue-comment-body").element.value).toBe("");
  });

  it("评论加载失败不遮挡 Issue 详情", async () => {
    vi.mocked(issueDetail).mockResolvedValue(issue);
    vi.mocked(issueCommentsList).mockRejectedValue(new Error("评论接口不可用"));
    const router = await createRouterAt("/issue/github/team/repo/12");
    const wrapper = mountWithRouter(IssueDetailPage, router);
    await flushPromises();

    expect(wrapper.text()).toContain("详情页支持 Markdown");
    expect(wrapper.text()).toContain("评论接口不可用");
  });
});

describe("IssueListPage detail link", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("把 Issue 卡片链接到当前平台和仓库的详情页", async () => {
    const item: IssueSummary = {
      number: 12,
      title: "详情页支持 Markdown",
      author: { id: 1, login: "reporter", name: "Reporter", avatar_url: "" },
      state: "open",
      labels: ["priority", "documentation"],
      label_colors: { priority: "fbca04", documentation: "0075ca" },
      created_at: "2026-07-25T10:00:00Z",
    };
    vi.mocked(issueList).mockResolvedValue({
      items: [item],
      page: 1,
      total_pages: 1,
      total_count: 1,
      truncated: null,
    });
    const router = await createRouterAt("/issue");
    const auth = useAuthStore();
    auth.setActivePlatform("github");
    auth.platforms.github.isLoggedIn = true;
    const repo = useRepoStore();
    repo.activeRepos.github = { owner: "team", repo: "repo" };

    const wrapper = mountWithRouter(IssueListPage, router);
    await flushPromises();

    expect(wrapper.get(".issue-card-link").attributes("href")).toBe("/issue/github/team/repo/12");
    const tags = wrapper.findAll(".issue-card .label-tag");
    expect(tags).toHaveLength(2);
    expect(
      tags.every((tag) =>
        tag.classes().some((name) => name.startsWith("mb-static-label-tag-color-")),
      ),
    ).toBe(true);
    const stylesheet = document.querySelector("style[data-mergebeacon-dynamic-css]")?.textContent;
    expect(stylesheet).toContain(
      "--label-tag-background: #fbca04; --label-tag-foreground: #1f2328",
    );
    expect(stylesheet).toContain(
      "--label-tag-background: #0075ca; --label-tag-foreground: #ffffff",
    );
  });

  it("远端列表尚未刷新时仍展示刚创建的 Issue", async () => {
    vi.mocked(issueList).mockResolvedValue({
      items: [],
      page: 1,
      total_pages: 1,
      total_count: 0,
      truncated: null,
    });
    const router = await createRouterAt("/issue");
    const auth = useAuthStore();
    auth.setActivePlatform("github");
    auth.platforms.github.isLoggedIn = true;
    const repo = useRepoStore();
    repo.activeRepos.github = { owner: "team", repo: "repo" };
    const createdIssue: Issue = {
      ...issue,
      number: 13,
      title: "刚创建的 Issue",
    };
    const issueStore = useIssueStore();
    issueStore.rememberCreatedIssue("github", "team", "repo", createdIssue);

    const wrapper = mountWithRouter(IssueListPage, router);
    await flushPromises();

    expect(issueList).toHaveBeenCalledWith("github", "team", "repo");
    expect(wrapper.text()).toContain("刚创建的 Issue");
    expect(issueStore.pendingCreatedIssue?.issue.number).toBe(13);
  });
});
