import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineAsyncComponent, defineComponent, reactive, type Component } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PrDetailPage from "@/pages/PrDetailPage.vue";
import { setAppLocale } from "@/i18n";
import type {
  DiffResult,
  PrCommitSummary,
  PrCommitTruncatedEnd,
  PrDetail,
  PrMergeReadiness,
  User,
} from "@/types";
import { APP_COMMAND_EVENT } from "@/types/commands";
import type { CommitRangeRevisions, CommitRangeSelection } from "@/utils/commitRange";
import {
  persistPrCreateWarnings,
  PR_CREATE_WARNING_QUERY,
  readPrCreateWarnings,
} from "@/utils/prCreateWarnings";

const mocks = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    replace: vi.fn().mockResolvedValue(undefined),
  },
  route: {
    params: { platform: "github", owner: "owner", repo: "repo", number: "42" },
    query: {} as Record<string, string | undefined>,
  },
  authStore: {
    platforms: {
      github: { user: null as User | null, isLoggedIn: true },
      gitlab: { user: null as User | null, isLoggedIn: false },
      gitee: { user: null as User | null, isLoggedIn: false },
    },
  },
  prStore: {
    currentPr: null as PrDetail | null,
    diff: null as DiffResult | null,
    commits: [] as PrCommitSummary[],
    commitsTruncatedEnd: null as PrCommitTruncatedEnd | null,
    commitsLoading: false,
    commitsError: null as string | null,
    commitRange: null as CommitRangeSelection | null,
    rangeDiff: null as DiffResult | null,
    rangeRevisions: null as CommitRangeRevisions | null,
    rangeDiffLoading: false,
    rangeDiffError: null as string | null,
    mergeReadiness: null as PrMergeReadiness | null,
    readinessLoading: false,
    readinessError: null as string | null,
    detailLoading: false,
    diffLoading: false,
    error: null as string | null,
    fetchPrDetail: vi.fn().mockResolvedValue(true),
    fetchPrDiff: vi.fn().mockResolvedValue(undefined),
    fetchPrCommits: vi.fn().mockResolvedValue(undefined),
    selectCommitRange: vi.fn().mockResolvedValue(undefined),
    resetCommitSelection: vi.fn(),
    fetchMergeReadiness: vi.fn().mockResolvedValue(undefined),
    mergePr: vi.fn(),
    closePr: vi.fn().mockResolvedValue(undefined),
    reopenPr: vi.fn(),
    updateMetadata: vi.fn(),
  },
  reviewInboxStore: {
    applyPrSummary: vi.fn(),
  },
  capabilityStore: {
    values: {
      github: {
        platform: "github",
        review_events: ["comment", "approve", "request_changes"],
        merge_strategies: ["merge", "squash", "rebase"],
        supports_fork_context: true,
        supports_issue_auto_close: true,
        supports_compare_diff: true,
        supports_review_thread_resolution: false,
        supports_remote_file_viewed_state: false,
        supports_pr_title_body_edit: true,
        supports_pr_draft_toggle: true,
        supports_pr_reviewer_management: true,
        supports_pr_assignee_management: true,
        supports_pr_label_management: true,
        supports_pr_milestone_management: true,
        merge_queue_kind: "merge_queue",
      },
    },
    errors: {},
    load: vi.fn().mockResolvedValue(undefined),
  },
  uiSettingsStore: {
    isPrDependenciesVisible: true,
    isMergeQueueVisible: true,
  },
  reviewCommentAdd: vi.fn(),
  issueDetail: vi.fn(),
  openExternalUrl: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock("vue-router", () => ({
  useRoute: () => mocks.route,
  useRouter: () => mocks.router,
}));
vi.mock("@/stores/useAuthStore", () => ({ useAuthStore: () => mocks.authStore }));
vi.mock("@/stores/usePrStore", () => ({ usePrStore: () => mocks.prStore }));
vi.mock("@/stores/useReviewInboxStore", () => ({
  useReviewInboxStore: () => mocks.reviewInboxStore,
}));
vi.mock("@/stores/useCapabilityStore", () => ({
  useCapabilityStore: () => mocks.capabilityStore,
}));
vi.mock("@/stores/useUiSettingsStore", () => ({
  useUiSettingsStore: () => mocks.uiSettingsStore,
}));
vi.mock("@/api", () => ({
  issueDetail: mocks.issueDetail,
  reviewCommentAdd: mocks.reviewCommentAdd,
  openExternalUrl: mocks.openExternalUrl,
}));

mocks.uiSettingsStore = reactive(mocks.uiSettingsStore);
mocks.prStore = reactive(mocks.prStore);

enableAutoUnmount(afterEach);

const author: User = {
  id: 7,
  login: "pr-author",
  name: "PR Author",
  avatar_url: "",
};

const detail: PrDetail = {
  summary: {
    number: 42,
    title: "权限测试",
    author,
    state: "open",
    created_at: "",
    updated_at: "",
    labels: [],
  },
  body: "",
  web_url: "https://github.com/owner/repo/pull/42",
  source_branch: "feature",
  target_branch: "main",
  mergeable: true,
  head_sha: "abc123",
  base_sha: "base-sha",
  draft: false,
  reviewers: [],
  assignees: [],
  milestone: null,
  metadata_permissions: {
    can_edit_title_body: true,
    can_toggle_draft: true,
    can_manage_reviewers: true,
    can_manage_assignees: true,
    can_manage_labels: true,
    can_manage_milestone: true,
  },
};

const readiness: PrMergeReadiness = {
  status: "blocked",
  head_sha: "abc123",
  mergeable: true,
  draft: false,
  has_conflicts: false,
  checks_status: "ready",
  approvals_status: "ready",
  approvals_required: null,
  approvals_received: null,
  has_merge_permission: false,
  branch_behind: false,
  blocking_reasons: [],
};

function mountPage(stubs: Record<string, unknown> = {}) {
  return mount(PrDetailPage, {
    global: {
      stubs: {
        AppLayout: {
          props: { isDiffFocusMode: Boolean },
          template: `<main data-testid="app-layout" :data-focus-mode="isDiffFocusMode ? 'true' : 'false'">
            <slot name="header" /><div class="content-body"><slot /></div>
          </main>`,
        },
        DiffViewer: true,
        ReviewForm: true,
        ReviewList: true,
        AiReviewPanel: true,
        PrDependenciesPanel: true,
        PrMergeQueuePanel: true,
        MergeReadinessPanel: true,
        ...stubs,
      },
    },
  });
}

async function selectTab(wrapper: VueWrapper, label: string): Promise<void> {
  const button = wrapper.findAll(".tabs button").find((item) => item.text() === label);
  expect(button).toBeDefined();
  await button!.trigger("click");
}

describe("PrDetailPage 关闭权限", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAppLocale("zh-CN");
    mocks.router.replace.mockResolvedValue(undefined);
    mocks.route.query = {};
    window.sessionStorage.clear();
    mocks.authStore.platforms.github.user = {
      id: 99,
      login: "reviewer",
      name: "Reviewer",
      avatar_url: "",
    };
    mocks.prStore.currentPr = detail;
    mocks.prStore.mergeReadiness = { ...readiness };
    mocks.prStore.readinessLoading = false;
    mocks.prStore.readinessError = null;
    mocks.prStore.detailLoading = false;
    mocks.prStore.diffLoading = false;
    mocks.prStore.error = null;
    mocks.prStore.diff = null;
    mocks.prStore.commits = [];
    mocks.prStore.commitsTruncatedEnd = null;
    mocks.prStore.commitsLoading = false;
    mocks.prStore.commitsError = null;
    mocks.prStore.commitRange = null;
    mocks.prStore.rangeDiff = null;
    mocks.prStore.rangeRevisions = null;
    mocks.prStore.rangeDiffLoading = false;
    mocks.prStore.rangeDiffError = null;
    mocks.capabilityStore.values.github.supports_remote_file_viewed_state = false;
    mocks.uiSettingsStore.isPrDependenciesVisible = true;
    mocks.uiSettingsStore.isMergeQueueVisible = true;
    mocks.reviewCommentAdd.mockResolvedValue(undefined);
    mocks.openExternalUrl.mockResolvedValue(undefined);
    mocks.prStore.updateMetadata.mockResolvedValue({
      detail,
      updated_fields: ["title_body"],
      failures: [],
    });
  });

  it("点击返回按钮稳定跳转到 PR 列表", async () => {
    const wrapper = mountPage();
    const button = wrapper.get('[data-testid="back-to-pr-list"]');

    expect(button.attributes("title")).toBe("返回 PR 列表");
    expect(button.attributes("aria-label")).toBe("返回 PR 列表");
    await button.trigger("click");

    expect(mocks.router.push).toHaveBeenCalledWith({ name: "pr-list" });
  });

  it("中文界面将 Open PR 状态显示为打开", () => {
    const wrapper = mountPage();

    expect(wrapper.get(".pr-state-badge").text()).toBe("打开");
  });

  it("已挂载时切换英文，并保留远端 PR 标题", async () => {
    const wrapper = mountPage();

    expect(wrapper.text()).toContain("评审意见");
    expect(wrapper.text()).toContain("权限测试");

    setAppLocale("en-US");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Review feedback");
    expect(wrapper.text()).toContain("Pull requests");
    expect(wrapper.text()).toContain("权限测试");
    expect(wrapper.text()).not.toContain("评审意见");
  });

  it("有 web_url 时点击标题在浏览器中打开 PR 页面", async () => {
    mocks.prStore.currentPr = { ...detail, web_url: "https://github.com/owner/repo/pull/42" };
    const wrapper = mountPage();
    const title = wrapper.get('[data-testid="pr-title-link"]');

    expect(title.text()).toBe("权限测试");
    expect(title.attributes("title")).toBe("在浏览器中打开");
    expect(title.attributes("aria-label")).toBe("在浏览器中打开：权限测试");
    await title.trigger("click");

    expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://github.com/owner/repo/pull/42");
    expect(wrapper.find('[data-testid="pr-title-link-error"]').exists()).toBe(false);
  });

  it("打开浏览器失败时就近展示错误提示", async () => {
    mocks.prStore.currentPr = { ...detail, web_url: "https://github.com/owner/repo/pull/42" };
    mocks.openExternalUrl.mockRejectedValueOnce("Not allowed to open path");
    const wrapper = mountPage();

    await wrapper.get('[data-testid="pr-title-link"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[data-testid="pr-title-link-error"]').text()).toBe(
      "Not allowed to open path",
    );

    mocks.openExternalUrl.mockResolvedValueOnce(undefined);
    await wrapper.get('[data-testid="pr-title-link"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="pr-title-link-error"]').exists()).toBe(false);
  });

  it("无 web_url 时标题以纯文本渲染", () => {
    mocks.prStore.currentPr = { ...detail, web_url: null };
    const wrapper = mountPage();

    expect(wrapper.find('[data-testid="pr-title-link"]').exists()).toBe(false);
    expect(wrapper.get("h2").text()).toBe("权限测试");
  });

  it("PR 元数据中的 Issue、PR 和外部链接使用对应跳转方式", async () => {
    const metadataStub = {
      emits: ["open-issue", "open-link", "open-external"],
      template: `<section>
        <button data-testid="metadata-issue-link" @click="$emit('open-issue', 12)">#12</button>
        <button
          data-testid="metadata-pr-link"
          @click="$emit('open-link', 'https://github.com/other/project/pull/7100')"
        >PR #7100</button>
        <button
          data-testid="metadata-external-link"
          @click="$emit('open-link', 'https://example.com/docs')"
        >文档</button>
        <button
          data-testid="metadata-reviewer-link"
          @click="$emit('open-external', 'https://github.com/reviewer')"
        >审核人员</button>
        <button
          data-testid="metadata-reference-link"
          @click="$emit('open-link', '/__mergebeacon__/reference/hash/7086')"
        >#7086</button>
        <button
          data-testid="metadata-redirect-issue-link"
          @click="$emit('open-link', 'https://redirect.github.com/pyasn1/pyasn1/issues/113')"
        >pyasn1#113</button>
      </section>`,
    };
    const wrapper = mountPage({ PrMetadataPanel: metadataStub });

    await wrapper.get('[data-testid="metadata-issue-link"]').trigger("click");
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: "issue-detail",
      params: { platform: "github", owner: "owner", repo: "repo", number: 12 },
    });

    await wrapper.get('[data-testid="metadata-pr-link"]').trigger("click");
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: "pr-detail",
      params: { platform: "github", owner: "other", repo: "project", number: 7100 },
    });

    await wrapper.get('[data-testid="metadata-external-link"]').trigger("click");
    expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");

    await wrapper.get('[data-testid="metadata-reviewer-link"]').trigger("click");
    expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://github.com/reviewer");

    await wrapper.get('[data-testid="metadata-redirect-issue-link"]').trigger("click");
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: "issue-detail",
      params: { platform: "github", owner: "pyasn1", repo: "pyasn1", number: 113 },
    });
    expect(mocks.openExternalUrl).not.toHaveBeenCalledWith(
      "https://redirect.github.com/pyasn1/pyasn1/issues/113",
    );

    mocks.issueDetail.mockResolvedValueOnce({ is_pull_request: true });
    await wrapper.get('[data-testid="metadata-reference-link"]').trigger("click");
    await flushPromises();
    expect(mocks.issueDetail).toHaveBeenCalledWith("github", "owner", "repo", 7086);
    expect(mocks.router.push).toHaveBeenCalledWith({
      name: "pr-detail",
      params: { platform: "github", owner: "owner", repo: "repo", number: 7086 },
    });
  });

  it("详情不存在时不再请求 Diff 和合并状态", async () => {
    mocks.prStore.currentPr = null;
    mocks.prStore.fetchPrDetail.mockResolvedValueOnce(false);

    mountPage();
    await flushPromises();

    expect(mocks.prStore.fetchPrDetail).toHaveBeenCalledWith("github", "owner", "repo", 42);
    expect(mocks.prStore.fetchPrDiff).not.toHaveBeenCalled();
    expect(mocks.prStore.fetchMergeReadiness).not.toHaveBeenCalled();
  });

  it("详情 Action 没有返回值但已写入当前详情时仍加载首屏后台数据", async () => {
    mocks.prStore.currentPr = detail;
    mocks.prStore.fetchPrDetail.mockResolvedValueOnce(undefined);

    mountPage();
    await flushPromises();

    expect(mocks.prStore.fetchPrDiff).toHaveBeenCalledWith("github", "owner", "repo", 42);
    expect(mocks.prStore.fetchMergeReadiness).toHaveBeenCalledWith("github", "owner", "repo", 42);
    expect(mocks.prStore.fetchPrCommits).not.toHaveBeenCalled();
  });

  it("首次打开 Diff 页签时才加载提交列表", async () => {
    const wrapper = mountPage();
    await flushPromises();

    expect(mocks.prStore.fetchPrCommits).not.toHaveBeenCalled();

    await selectTab(wrapper, "Diff");

    expect(mocks.prStore.fetchPrCommits).toHaveBeenCalledWith("github", "owner", "repo", 42);
  });

  it("详情已加载时不因后台 Diff 请求重新遮挡首屏", () => {
    mocks.prStore.detailLoading = false;
    mocks.prStore.diffLoading = true;

    const wrapper = mountPage();

    expect(wrapper.find(".loading-state").exists()).toBe(false);
    expect(wrapper.find(".tabs").exists()).toBe(true);
    expect(wrapper.text()).toContain(detail.summary.title);
  });

  describe("按 commit 维度查看", () => {
    const diffViewerStub = {
      props: [
        "diff",
        "readOnly",
        "canSyncViewedFiles",
        "baseSha",
        "headSha",
        "baseOwner",
        "baseRepo",
      ],
      // 变更范围控件通过 scope 插槽挂在 DiffViewer 顶部，stub 必须渲染它。
      template: `<section
        data-testid="diff-viewer"
        :data-read-only="readOnly ? 'true' : 'false'"
        :data-can-sync="canSyncViewedFiles ? 'true' : 'false'"
        :data-base-sha="baseSha"
        :data-head-sha="headSha"
        :data-base-repo="baseOwner + '/' + baseRepo"
      ><slot name="scope" />{{ diff?.diff }}</section>`,
    };

    it("整体视图使用 PR 的 base/head 且允许评审操作", async () => {
      mocks.prStore.diff = { diff: "整体 diff", files: [], patch_schema_version: 1, patches: [] };
      mocks.capabilityStore.values.github.supports_remote_file_viewed_state = true;

      const wrapper = mountPage({ DiffViewer: diffViewerStub });
      await selectTab(wrapper, "Diff");
      await flushPromises();

      const viewer = wrapper.get('[data-testid="diff-viewer"]');
      expect(viewer.text()).toContain("整体 diff");
      expect(viewer.attributes("data-read-only")).toBe("false");
      expect(viewer.attributes("data-can-sync")).toBe("true");
      expect(viewer.attributes("data-base-sha")).toBe(detail.base_sha);
      expect(viewer.attributes("data-head-sha")).toBe(detail.head_sha);
      expect(wrapper.find(".commit-range-note").exists()).toBe(false);
    });

    it("选中提交区间时展示区间 Diff，并停用行内评论与已查看同步", async () => {
      mocks.prStore.diff = { diff: "整体 diff", files: [], patch_schema_version: 1, patches: [] };
      mocks.prStore.commitRange = { startIndex: 1, endIndex: 2 };
      mocks.prStore.rangeDiff = {
        diff: "区间 diff",
        files: [],
        patch_schema_version: 1,
        patches: [],
      };
      mocks.prStore.rangeRevisions = { baseSha: "c1", headSha: "c3" };
      mocks.capabilityStore.values.github.supports_remote_file_viewed_state = true;

      const wrapper = mountPage({ DiffViewer: diffViewerStub });
      await selectTab(wrapper, "Diff");
      await flushPromises();

      const viewer = wrapper.get('[data-testid="diff-viewer"]');
      expect(viewer.text()).toContain("区间 diff");
      expect(viewer.attributes("data-read-only")).toBe("true");
      expect(viewer.attributes("data-can-sync")).toBe("false");
      expect(viewer.attributes("data-base-sha")).toBe("c1");
      expect(viewer.attributes("data-head-sha")).toBe("c3");
      expect(wrapper.get(".commit-range-note").text()).toContain("停用");
    });

    it("Fork PR 的区间对比在源仓库上执行", async () => {
      mocks.prStore.currentPr = {
        ...detail,
        base_repository_full_name: "owner/repo",
        head_repository_full_name: "contributor/repo",
      };

      const wrapper = mountPage({ DiffViewer: diffViewerStub });
      await selectTab(wrapper, "Diff");
      await flushPromises();
      wrapper
        .findComponent({ name: "DiffCommitSelector" })
        .vm.$emit("update:selection", { startIndex: 0, endIndex: 1 });
      await flushPromises();

      expect(mocks.prStore.selectCommitRange).toHaveBeenCalledWith(
        "github",
        "contributor",
        "repo",
        {
          startIndex: 0,
          endIndex: 1,
        },
      );
    });

    it("区间 Diff 读取失败时展示原因，且变更范围控件仍在", async () => {
      mocks.prStore.commits = [
        {
          sha: "c1aaaaaa",
          title: "修复空指针",
          author_name: "Alice",
          authored_at: "2026-07-19T10:00:00Z",
          parent_shas: [],
        },
      ];
      mocks.prStore.commitRange = { startIndex: 0, endIndex: 0 };
      mocks.prStore.rangeDiffError = "无法确定所选提交的对比基准，请改用整体 Diff。";

      const wrapper = mountPage({ DiffViewer: diffViewerStub });
      await selectTab(wrapper, "Diff");
      await flushPromises();

      expect(wrapper.text()).toContain("无法确定所选提交的对比基准");
      // 控件挂在 DiffViewer 的 scope 插槽上，出错时不能跟着 Diff 一起消失，
      // 否则用户没有入口切回整体 Diff。
      expect(wrapper.findComponent({ name: "DiffCommitSelector" }).exists()).toBe(true);
      expect(wrapper.get(".commit-scope-reset").text()).toContain("查看所有变更");
    });

    it("区间 Diff 加载中时变更范围控件仍可操作", async () => {
      mocks.prStore.commitRange = { startIndex: 0, endIndex: 0 };
      mocks.prStore.rangeDiffLoading = true;

      const wrapper = mountPage({ DiffViewer: diffViewerStub });
      await selectTab(wrapper, "Diff");
      await flushPromises();

      expect(wrapper.get(".commit-scope-status").text()).toContain("正在读取");
      expect(wrapper.get(".commit-scope-trigger").attributes("disabled")).toBeUndefined();
    });

    it("定位 AI 建议前先回到整体 Diff", async () => {
      mocks.prStore.commitRange = { startIndex: 0, endIndex: 0 };
      const wrapper = mountPage({
        AiReviewPanel: {
          emits: ["locateSuggestion"],
          template: `<button data-testid="locate" @click="$emit('locateSuggestion', {
            file: 'src/main.ts', line_start: 1, line_end: 1, severity: 'minor',
            category: '逻辑', description: '建议', suggestion: null
          })">定位</button>`,
        },
      });
      await flushPromises();
      const aiTab = wrapper.findAll(".tabs button").find((button) => button.text() === "AI 评审");
      await aiTab?.trigger("click");
      await wrapper.get('[data-testid="locate"]').trigger("click");

      expect(mocks.prStore.resetCommitSelection).toHaveBeenCalled();
    });
  });

  it("将 fork PR 的 base 和 head 仓库分别传给 DiffViewer", async () => {
    mocks.prStore.currentPr = {
      ...detail,
      base_repository_full_name: "t8y2/dbx",
      head_repository_full_name: "eryajf/dbx",
    };
    const wrapper = mountPage({
      DiffViewer: {
        props: ["baseOwner", "baseRepo", "headOwner", "headRepo"],
        template: `<span data-testid="diff-repositories">{{ baseOwner }}/{{ baseRepo }}|{{ headOwner }}/{{ headRepo }}</span>`,
      },
    });
    await selectTab(wrapper, "Diff");

    expect(wrapper.get('[data-testid="diff-repositories"]').text()).toBe("t8y2/dbx|eryajf/dbx");
  });

  it("源仓库不可解析时不将 DiffViewer 的 head 回退到目标仓库", async () => {
    mocks.prStore.currentPr = {
      ...detail,
      base_repository_full_name: "t8y2/dbx",
      head_repository_full_name: null,
    };
    const wrapper = mountPage({
      DiffViewer: {
        props: ["baseOwner", "baseRepo", "headOwner", "headRepo"],
        template: `<span data-testid="diff-repositories">{{ baseOwner }}/{{ baseRepo }}|{{ headOwner ?? "none" }}/{{ headRepo ?? "none" }}</span>`,
      },
    });
    await selectTab(wrapper, "Diff");

    expect(wrapper.get('[data-testid="diff-repositories"]').text()).toBe("t8y2/dbx|none/none");
  });

  it("源仓库路径格式非法时不将 DiffViewer 的 head 回退到目标仓库", async () => {
    mocks.prStore.currentPr = {
      ...detail,
      base_repository_full_name: "t8y2/dbx",
      head_repository_full_name: "invalid-repository",
    };
    const wrapper = mountPage({
      DiffViewer: {
        props: ["baseOwner", "baseRepo", "headOwner", "headRepo"],
        template: `<span data-testid="diff-repositories">{{ baseOwner }}/{{ baseRepo }}|{{ headOwner ?? "none" }}/{{ headRepo ?? "none" }}</span>`,
      },
    });
    await selectTab(wrapper, "Diff");

    expect(wrapper.get('[data-testid="diff-repositories"]').text()).toBe("t8y2/dbx|none/none");
  });

  it("非作者且没有仓库写入权限时禁用关闭按钮", async () => {
    const wrapper = mountPage();
    const button = wrapper.get('[data-testid="close-pr-button"]');

    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe("只有 PR 作者或具备仓库写入权限的成员才能关闭 PR");
    await button.trigger("click");
    expect(mocks.prStore.closePr).not.toHaveBeenCalled();
  });

  it("PR 作者没有合并权限时仍可关闭自己的 PR", () => {
    mocks.authStore.platforms.github.user = { ...author, login: "PR-AUTHOR" };
    const wrapper = mountPage();
    const button = wrapper.get('[data-testid="close-pr-button"]');

    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("关闭 PR 前展示目标安全提示，确认后才调用关闭接口", async () => {
    mocks.authStore.platforms.github.user = { ...author };
    const wrapper = mountPage();

    await wrapper.get('[data-testid="close-pr-button"]').trigger("click");
    await flushPromises();

    const dialog = document.body.querySelector('[data-testid="close-confirm-dialog"]');
    expect(dialog?.textContent).toContain("owner/repo");
    expect(dialog?.textContent).toContain("#42 权限测试");
    expect(mocks.prStore.closePr).not.toHaveBeenCalled();

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="confirm-close"]',
    );
    confirmButton?.click();
    confirmButton?.click();
    await flushPromises();

    expect(mocks.prStore.closePr).toHaveBeenCalledWith("github", "owner", "repo", 42);
    expect(mocks.prStore.closePr).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[data-testid="close-confirm-dialog"]')).toBeNull();
  });

  it("关闭失败时保留确认框并展示错误", async () => {
    mocks.authStore.platforms.github.user = { ...author };
    mocks.prStore.closePr.mockRejectedValueOnce("关闭请求被拒绝");
    const wrapper = mountPage();

    await wrapper.get('[data-testid="close-pr-button"]').trigger("click");
    await flushPromises();
    document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-close"]')?.click();
    await flushPromises();

    expect(document.body.querySelector('[data-testid="close-confirm-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe("关闭请求被拒绝");
  });

  it("具备仓库写入权限的非作者可以关闭 PR", () => {
    mocks.prStore.mergeReadiness = { ...readiness, has_merge_permission: true };
    const wrapper = mountPage();
    const button = wrapper.get('[data-testid="close-pr-button"]');

    expect(button.attributes("disabled")).toBeUndefined();
  });

  it("平台未返回权限时保守禁用关闭按钮", () => {
    mocks.prStore.mergeReadiness = { ...readiness, has_merge_permission: null };
    const wrapper = mountPage();
    const button = wrapper.get('[data-testid="close-pr-button"]');

    expect(button.attributes("disabled")).toBeDefined();
    expect(button.attributes("title")).toBe("平台未返回当前账号的关闭权限");
  });

  it("合并状态未知但没有明确阻断条件时允许尝试合并", async () => {
    mocks.prStore.mergeReadiness = {
      ...readiness,
      status: "unknown",
      checks_status: "unknown",
      has_merge_permission: null,
      blocking_reasons: [],
    };
    mocks.prStore.mergePr.mockResolvedValue({ merged: true, issue_close_failures: [] });
    const wrapper = mountPage();
    const button = wrapper.get(".merge-main");
    const commitMessage = wrapper.get(".merge-commit-message");

    expect(button.attributes("disabled")).toBeUndefined();
    expect(commitMessage.classes()).toEqual(
      expect.arrayContaining(["input", "merge-commit-message"]),
    );
    await button.trigger("click");
    expect(mocks.prStore.mergePr).toHaveBeenCalledOnce();
  });

  it("合并状态未知但存在已确认阻断条件时仍禁用合并", () => {
    mocks.prStore.mergeReadiness = {
      ...readiness,
      status: "unknown",
      checks_status: "unknown",
      has_merge_permission: null,
      blocking_reasons: [{ code: "platform_blocked", message: "平台规则阻止合并" }],
    };
    const wrapper = mountPage();

    expect(wrapper.get(".merge-main").attributes("disabled")).toBeDefined();
  });

  it("切换 Diff 后保留 AI 评审面板状态", async () => {
    const mounted = vi.fn();
    const wrapper = mountPage({
      AiReviewPanel: {
        data: () => ({ result: "" }),
        mounted,
        template: `<input data-testid="ai-review-result" v-model="result" />`,
      },
    });
    const tab = (label: string) =>
      wrapper.findAll(".tabs button").find((button) => button.text() === label)!;

    await tab("AI 评审").trigger("click");
    await wrapper.get<HTMLInputElement>('[data-testid="ai-review-result"]').setValue("已完成评审");
    await tab("Diff").trigger("click");
    await tab("AI 评审").trigger("click");

    expect(mounted).toHaveBeenCalledOnce();
    expect(wrapper.get<HTMLInputElement>('[data-testid="ai-review-result"]').element.value).toBe(
      "已完成评审",
    );
  });

  it("按评审意见、依赖关系、Diff 和 AI 评审排列页签", () => {
    const wrapper = mountPage();

    expect(wrapper.findAll(".tabs button").map((button) => button.text())).toEqual([
      "评审意见",
      "依赖关系",
      "Diff",
      "AI 评审",
    ]);
  });

  it("默认展示评审意见，并按元数据、意见列表的顺序排列", async () => {
    const wrapper = mountPage({
      PrMetadataPanel: { template: '<section data-testid="pr-metadata" />' },
      ReviewList: { template: '<section data-testid="review-list" />' },
    });
    const reviewsTab = wrapper
      .findAll(".tabs button")
      .find((button) => button.text() === "评审意见");
    const diffTab = wrapper.findAll(".tabs button").find((button) => button.text() === "Diff");

    const reviewContent = wrapper.get('[data-testid="pr-metadata"]').element.parentElement!;
    const reviewChildren = Array.from(reviewContent.children);
    expect(reviewsTab!.classes()).toContain("active");
    expect(reviewContent.getAttribute("style") ?? "").not.toContain("display: none");
    expect(reviewChildren.indexOf(wrapper.get('[data-testid="pr-metadata"]').element)).toBeLessThan(
      reviewChildren.indexOf(wrapper.get('[data-testid="review-list"]').element),
    );

    await diffTab!.trigger("click");

    expect(reviewContent.getAttribute("style")).toContain("display: none");
  });

  it("依赖关系页签按需挂载且切换后保留状态", async () => {
    const mounted = vi.fn();
    const wrapper = mountPage({
      PrDependenciesPanel: {
        data: () => ({ marker: "" }),
        mounted,
        template: `<input data-testid="dependency-marker" v-model="marker" />`,
      },
    });
    const tab = (label: string) =>
      wrapper.findAll(".tabs button").find((button) => button.text() === label)!;

    expect(wrapper.find('[data-testid="dependency-marker"]').exists()).toBe(false);
    await tab("依赖关系").trigger("click");
    await wrapper.get<HTMLInputElement>('[data-testid="dependency-marker"]').setValue("已加载");
    await tab("Diff").trigger("click");
    await tab("依赖关系").trigger("click");

    expect(mounted).toHaveBeenCalledOnce();
    expect(wrapper.get<HTMLInputElement>('[data-testid="dependency-marker"]').element.value).toBe(
      "已加载",
    );
  });

  it("依赖关系页签向合并队列面板传递平台能力和当前版本", async () => {
    const wrapper = mountPage({
      PrMergeQueuePanel: {
        props: ["platform", "prNumber", "revision", "queueKind"],
        template: `<span data-testid="queue-context">
          {{ platform }}:{{ prNumber }}:{{ revision }}:{{ queueKind }}
        </span>`,
      },
    });
    const dependenciesTab = wrapper
      .findAll(".tabs button")
      .find((button) => button.text() === "依赖关系");

    await dependenciesTab!.trigger("click");

    expect(wrapper.get('[data-testid="queue-context"]').text()).toContain("github:42::merge_queue");
  });

  it("关闭依赖关系时即使队列偏好开启也不展示合并上下文", () => {
    mocks.uiSettingsStore.isPrDependenciesVisible = false;
    const wrapper = mountPage({
      PrDependenciesPanel: { template: '<span data-testid="dependency-panel" />' },
      PrMergeQueuePanel: { template: '<span data-testid="merge-queue-panel" />' },
    });

    expect(wrapper.findAll(".tabs button").map((button) => button.text())).not.toContain(
      "依赖关系",
    );
    expect(wrapper.find('[data-testid="dependency-panel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="merge-queue-panel"]').exists()).toBe(false);
  });

  it("查看依赖关系时关闭该功能会回到评审意见", async () => {
    const wrapper = mountPage();

    await selectTab(wrapper, "依赖关系");
    mocks.uiSettingsStore.isPrDependenciesVisible = false;
    await flushPromises();

    const reviewsTab = wrapper
      .findAll(".tabs button")
      .find((button) => button.text() === "评审意见");
    expect(reviewsTab?.classes()).toContain("active");
    expect(wrapper.get('[data-testid="app-layout"]').attributes("data-focus-mode")).toBe("false");
  });

  it("可以仅展示分支依赖而不挂载 Merge Queue 面板", async () => {
    mocks.uiSettingsStore.isMergeQueueVisible = false;
    const wrapper = mountPage({
      PrDependenciesPanel: { template: '<span data-testid="dependency-panel" />' },
      PrMergeQueuePanel: { template: '<span data-testid="merge-queue-panel" />' },
    });
    const dependenciesTab = wrapper
      .findAll(".tabs button")
      .find((button) => button.text() === "依赖关系");

    await dependenciesTab!.trigger("click");

    expect(wrapper.find('[data-testid="dependency-panel"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="merge-queue-panel"]').exists()).toBe(false);
  });

  it("两个合并上下文开关都关闭时隐藏依赖关系页签", () => {
    mocks.uiSettingsStore.isPrDependenciesVisible = false;
    mocks.uiSettingsStore.isMergeQueueVisible = false;
    const wrapper = mountPage({
      PrDependenciesPanel: { template: '<span data-testid="dependency-panel" />' },
      PrMergeQueuePanel: { template: '<span data-testid="merge-queue-panel" />' },
    });

    expect(wrapper.findAll(".tabs button").map((button) => button.text())).toEqual([
      "评审意见",
      "Diff",
      "AI 评审",
    ]);
    expect(wrapper.find('[data-testid="dependency-panel"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="merge-queue-panel"]').exists()).toBe(false);
  });

  it("从 AI 建议切换到 Diff 并传递受控定位请求", async () => {
    const wrapper = mountPage({
      AiReviewPanel: {
        emits: ["locateSuggestion"],
        template: `<button data-testid="locate-ai-suggestion" @click="$emit('locateSuggestion', {
          file: 'src/main.ts',
          line_start: 18,
          line_end: 18,
          severity: 'major',
          category: '逻辑',
          description: '测试建议',
          suggestion: null
        })">定位建议</button>`,
      },
      DiffViewer: {
        props: ["locationRequest"],
        emits: ["locationResult"],
        template: `<section data-testid="diff-location-request">
          <span>{{ locationRequest?.path }}:{{ locationRequest?.line }}</span>
          <button
            data-testid="emit-stale-location-result"
            @click="$emit('locationResult', { id: 0, success: false, message: '旧请求错误' })"
          >旧结果</button>
          <button
            data-testid="emit-location-failure"
            @click="$emit('locationResult', { id: locationRequest.id, success: false, message: '目标行不存在' })"
          >失败</button>
        </section>`,
      },
    });
    const aiTab = wrapper.findAll(".tabs button").find((button) => button.text() === "AI 评审");
    expect(aiTab).toBeDefined();
    await aiTab!.trigger("click");
    const contentBody = wrapper.get<HTMLElement>(".content-body");
    const tabs = wrapper.get<HTMLElement>(".tabs");
    contentBody.element.scrollTop = 480;
    contentBody.element.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    tabs.element.getBoundingClientRect = () => ({ top: -480 }) as DOMRect;

    await wrapper.get('[data-testid="locate-ai-suggestion"]').trigger("click");

    const returnToAiButton = wrapper
      .findAll(".tabs button")
      .find((button) => button.text() === "返回 AI 评审");
    expect(returnToAiButton).toBeDefined();
    expect(contentBody.element.scrollTop).toBe(0);
    expect(wrapper.get('[data-testid="diff-location-request"]').text()).toContain("src/main.ts:18");
    expect(
      wrapper
        .findAll(".tabs button")
        .find((button) => button.text() === "Diff")
        ?.classes(),
    ).toContain("active");

    await wrapper.get('[data-testid="emit-stale-location-result"]').trigger("click");
    expect(wrapper.find(".diff-location-error").exists()).toBe(false);
    await wrapper.get('[data-testid="emit-location-failure"]').trigger("click");
    expect(wrapper.get(".diff-location-error").text()).toContain("目标行不存在");

    await returnToAiButton!.trigger("click");
    expect(contentBody.element.scrollTop).toBe(480);
    expect(wrapper.get('[data-testid="locate-ai-suggestion"]').isVisible()).toBe(true);
    expect(
      wrapper
        .findAll(".tabs button")
        .find((button) => button.text() === "AI 评审")
        ?.classes(),
    ).toContain("active");
  });

  it("无行号的评审评论跳转时传递文件级定位请求", async () => {
    const wrapper = mountPage({
      ReviewList: {
        emits: ["locateComment"],
        template: `<button data-testid="locate-review-file" @click="$emit('locateComment', 'src/old.ts', null, 'left')">定位文件</button>`,
      },
      DiffViewer: {
        props: ["locationRequest"],
        template: `<span data-testid="review-file-request">{{ locationRequest?.path }}|{{ locationRequest?.line ?? 'file' }}|{{ locationRequest?.side }}</span>`,
      },
    });

    await wrapper.get('[data-testid="locate-review-file"]').trigger("click");

    expect(wrapper.get('[data-testid="review-file-request"]').text()).toBe("src/old.ts|file|left");
    expect(
      wrapper
        .findAll(".tabs button")
        .find((button) => button.text() === "Diff")
        ?.classes(),
    ).toContain("active");
  });

  it("Diff 后台加载时显示加载态并在数据就绪后执行暂存定位", async () => {
    mocks.prStore.diff = null;
    mocks.prStore.diffLoading = true;
    const wrapper = mountPage({
      ReviewList: {
        emits: ["locateComment"],
        template: `<button data-testid="locate-loading-review" @click="$emit('locateComment', 'src/main.ts', 18, 'right')">定位评论</button>`,
      },
      DiffViewer: {
        props: ["locationRequest"],
        template: `<span data-testid="deferred-diff-location">{{ locationRequest?.path }}:{{ locationRequest?.line }}</span>`,
      },
    });

    await wrapper.get('[data-testid="locate-loading-review"]').trigger("click");

    expect(wrapper.get('[data-testid="diff-loading-state"]').text()).toContain("Diff");
    expect(wrapper.find('[data-testid="deferred-diff-location"]').exists()).toBe(false);
    expect(wrapper.find(".diff-location-error").exists()).toBe(false);

    mocks.prStore.diff = {
      diff: "diff --git a/src/main.ts b/src/main.ts",
      files: [],
      patch_schema_version: 1,
      patches: [],
    };
    mocks.prStore.diffLoading = false;
    await flushPromises();

    expect(wrapper.get('[data-testid="deferred-diff-location"]').text()).toBe("src/main.ts:18");
  });

  it("提交行级评论时按 left/right side 提取对应 hunk", async () => {
    const patch =
      "@@ -1,15 +1,0 @@\n-old1\n-old2\n-old3\n-old4\n-old5\n-old6\n-old7\n-old8\n-old9\n-old10\n-old11\n-old12\n-old13\n-old14\n-old15\n@@ -20,0 +10 @@\n+newcode";
    mocks.prStore.diff = {
      diff: patch,
      files: [
        {
          filename: "src/main.ts",
          status: "modified",
          patch,
          additions: 1,
          deletions: 15,
        },
      ],
      patch_schema_version: 1,
      patches: [
        {
          filename: "src/main.ts",
          old_path: "src/main.ts",
          new_path: "src/main.ts",
          status: "modified",
          additions: 1,
          deletions: 15,
          content_kind: "text",
          patch,
          hunks: [
            {
              header: "@@ -1,15 +1,0 @@",
              old_start: 1,
              old_count: 15,
              new_start: 1,
              new_count: 0,
              section_header: null,
              lines: Array.from({ length: 15 }, (_, index) => ({
                kind: "deletion",
                content: `old${index + 1}`,
                old_line: index + 1,
                new_line: null,
              })),
            },
            {
              header: "@@ -20,0 +10 @@",
              old_start: 20,
              old_count: 0,
              new_start: 10,
              new_count: 1,
              section_header: null,
              lines: [{ kind: "addition", content: "newcode", old_line: null, new_line: 10 }],
            },
          ],
          message: null,
        },
      ],
    };
    const wrapper = mountPage({
      DiffViewer: {
        emits: ["addComment"],
        template: `<div>
          <button data-testid="add-left-comment" @click="$emit('addComment', 'src/main.ts', 10, 10, 'left', 'left comment')">left</button>
          <button data-testid="add-right-comment" @click="$emit('addComment', 'src/main.ts', 10, 10, 'right', 'right comment')">right</button>
        </div>`,
      },
    });

    await selectTab(wrapper, "Diff");
    await wrapper.get('[data-testid="add-left-comment"]').trigger("click");
    await flushPromises();
    expect(mocks.reviewCommentAdd).toHaveBeenLastCalledWith(
      "github",
      "owner",
      "repo",
      42,
      "abc123",
      "src/main.ts",
      null,
      10,
      "left",
      "left comment",
      expect.stringContaining("-old10"),
    );

    await wrapper.get('[data-testid="add-right-comment"]').trigger("click");
    await flushPromises();
    expect(mocks.reviewCommentAdd).toHaveBeenLastCalledWith(
      "github",
      "owner",
      "repo",
      42,
      "abc123",
      "src/main.ts",
      null,
      10,
      "right",
      "right comment",
      expect.stringContaining("+newcode"),
    );
  });

  it("仅在 Diff 标签启用侧栏专注模式", async () => {
    const wrapper = mountPage();

    expect(wrapper.get('[data-testid="app-layout"]').attributes("data-focus-mode")).toBe("false");
    const diffTab = wrapper.findAll(".tabs button").find((button) => button.text() === "Diff");
    expect(diffTab).toBeDefined();
    await diffTab!.trigger("click");

    expect(wrapper.get('[data-testid="app-layout"]').attributes("data-focus-mode")).toBe("true");
  });
  it("保存元数据后同步详情列表和已加载收件箱摘要", async () => {
    const updatedDetail: PrDetail = {
      ...detail,
      summary: { ...detail.summary, title: "更新后的标题" },
    };
    mocks.prStore.updateMetadata.mockResolvedValue({
      detail: updatedDetail,
      updated_fields: ["title_body"],
      failures: [],
    });
    const wrapper = mountPage();

    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await wrapper.get('[data-testid="metadata-title"]').setValue("更新后的标题");
    await wrapper.get(".metadata-form").trigger("submit");
    await flushPromises();

    expect(mocks.prStore.updateMetadata).toHaveBeenCalledWith(
      "github",
      "owner",
      "repo",
      42,
      expect.objectContaining({
        title: "更新后的标题",
        expected_updated_at: detail.summary.updated_at,
      }),
    );
    expect(mocks.reviewInboxStore.applyPrSummary).toHaveBeenCalledWith(
      "github",
      "owner",
      "repo",
      updatedDetail.summary,
    );
    expect(wrapper.text()).toContain("元数据已更新");
  });

  it("忽略 store 判定为过期的元数据响应", async () => {
    mocks.prStore.updateMetadata.mockResolvedValue(null);
    const wrapper = mountPage();

    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await wrapper.get(".metadata-form").trigger("submit");
    await flushPromises();

    expect(mocks.reviewInboxStore.applyPrSummary).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("元数据已更新");
    expect(wrapper.text()).not.toContain("保存 PR / MR 元数据失败");
  });

  it("元数据部分成功时保留成功提示并展示失败项", async () => {
    mocks.prStore.updateMetadata.mockResolvedValue({
      detail,
      updated_fields: ["labels"],
      failures: [{ field: "reviewers", message: "部分评审者不存在" }],
    });
    const wrapper = mountPage();

    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await wrapper.get(".metadata-form").trigger("submit");
    await flushPromises();

    expect(wrapper.text()).toContain("部分元数据已更新，请检查失败项。");
    expect(wrapper.text()).toContain("部分评审者不存在");
  });

  it("从会话暂存恢复创建后的部分成功警告", async () => {
    persistPrCreateWarnings("github", "owner", "repo", 42, ["部分标签不存在"]);
    mocks.route.query = { [PR_CREATE_WARNING_QUERY]: "1" };

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("PR / MR 已创建，但部分后续操作失败。");
    expect(wrapper.text()).toContain("部分标签不存在");
    expect(mocks.router.replace).toHaveBeenCalledWith({ query: {} });
    expect(readPrCreateWarnings("github", "owner", "repo", 42)).toEqual([]);
  });

  it("会话暂存缺失时仍根据 query 展示部分成功警告", async () => {
    mocks.route.query = { [PR_CREATE_WARNING_QUERY]: "1" };

    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.text()).toContain("PR / MR 已创建，但部分后续操作失败。");
    expect(wrapper.text()).toContain("部分参与者或标签可能未能写入");
    expect(mocks.router.replace).toHaveBeenCalledWith({ query: {} });
  });

  it("响应命令面板的 AI 评审和提交评审入口", async () => {
    const wrapper = mountPage();
    await flushPromises();

    window.dispatchEvent(
      new CustomEvent(APP_COMMAND_EVENT, { detail: { type: "start_ai_review" } }),
    );
    await flushPromises();
    const aiTab = wrapper
      .findAll(".tabs button")
      .find((button) => button.text().includes("AI 评审"));
    expect(aiTab?.classes()).toContain("active");

    window.dispatchEvent(
      new CustomEvent(APP_COMMAND_EVENT, { detail: { type: "prepare_review" } }),
    );
    await flushPromises();
    const diffTab = wrapper
      .findAll(".tabs button")
      .find((button) => button.text().includes("Diff"));
    expect(diffTab?.classes()).toContain("active");
    wrapper.unmount();
  });

  it("等待异步 AI 面板加载完成后启动首次命令评审", async () => {
    const panelModule = deferred<Component>();
    const startReview = vi.fn();
    const wrapper = mountPage({
      AiReviewPanel: defineAsyncComponent(() => panelModule.promise),
    });
    await flushPromises();

    window.dispatchEvent(
      new CustomEvent(APP_COMMAND_EVENT, { detail: { type: "start_ai_review" } }),
    );
    await flushPromises();

    expect(startReview).not.toHaveBeenCalled();

    panelModule.resolve(
      defineComponent({
        setup(_props, { expose }) {
          expose({ startReview });
          return () => null;
        },
      }),
    );
    await flushPromises();

    expect(startReview).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});
