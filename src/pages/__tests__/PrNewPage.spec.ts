import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrNewPage from "@/pages/PrNewPage.vue";
import {
  aiPrDraft,
  aiPrDraftCancel,
  getPlatformCapabilities,
  prBranches,
  prCreate,
  prCreatePreview,
  prDescriptionImageUpload,
  listRepositoryLabels,
  prParticipantSuggestions,
  prTemplates,
  repoList,
} from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";
import { useRepoStore } from "@/stores/useRepoStore";
import { PR_CREATE_WARNING_QUERY, readPrCreateWarnings } from "@/utils/prCreateWarnings";
import type {
  Platform,
  PlatformCapabilities,
  PrCreatePreview,
  PrLabel,
  PrTemplate,
  RepoSummary,
  User,
} from "@/types";

vi.mock("@/api", () => ({
  aiPrDraft: vi.fn(),
  aiPrDraftCancel: vi.fn(),
  getPlatformCapabilities: vi.fn(),
  prBranches: vi.fn(),
  prCreate: vi.fn(),
  prCreatePreview: vi.fn(),
  prDescriptionImageUpload: vi.fn(),
  listRepositoryLabels: vi.fn(),
  prParticipantSuggestions: vi.fn(),
  prTemplates: vi.fn(),
  repoList: vi.fn(),
}));

const diffViewerStub = {
  props: {
    diff: { type: Object, required: true },
    platform: { type: String, default: "" },
    baseOwner: { type: String, default: "" },
    baseRepo: { type: String, default: "" },
    headOwner: { type: String, default: "" },
    headRepo: { type: String, default: "" },
    baseSha: { type: String, default: "" },
    headSha: { type: String, default: "" },
    readOnly: { type: Boolean, default: false },
  },
  template: '<div data-testid="diff-preview">{{ diff.files.length }} files</div>',
};

function createPreview(
  title: string,
  sha = "1234567890abcdef",
  filename = "src/a.ts",
  incomplete = false,
): PrCreatePreview {
  return {
    base_revision: null,
    incomplete,
    incomplete_reasons: incomplete ? ["platform_limit"] : [],
    commits: [
      {
        sha,
        title,
        author_name: "Alice",
        authored_at: "2026-07-19T10:00:00Z",
        parent_shas: [],
      },
    ],
    diff: {
      diff: "diff --git a/src/a.ts b/src/a.ts",
      files: [
        {
          filename,
          status: "modified",
          patch: "@@ -1 +1 @@\n-old\n+new",
          additions: 1,
          deletions: 1,
        },
      ],
      patch_schema_version: 1,
      patches: [],
    },
  };
}

function platformCapabilities(platform: Platform): PlatformCapabilities {
  return {
    platform,
    review_events: platform === "github" ? ["comment", "approve", "request_changes"] : ["comment"],
    merge_strategies: platform === "gitlab" ? ["merge", "squash"] : ["merge", "squash", "rebase"],
    supports_fork_context: true,
    supports_issue_auto_close: true,
    supports_compare_diff: true,
    supports_review_thread_resolution: platform !== "gitee",
    supports_remote_file_viewed_state: platform === "github",
    supports_pr_title_body_edit: true,
    supports_pr_draft_toggle: platform !== "gitee",
    supports_pr_reviewer_management: true,
    supports_pr_assignee_management: true,
    supports_pr_label_management: true,
    supports_pr_milestone_management: true,
    supports_pr_creation: true,
    supports_pr_description_image_upload: platform === "gitlab",
    merge_queue_kind:
      platform === "github" ? "merge_queue" : platform === "gitlab" ? "merge_train" : null,
  };
}

function repository(
  fullName: string,
  fork = false,
  parentFullName: string | null = null,
): RepoSummary {
  const [owner, ...repo] = fullName.split("/");
  return {
    id: fullName.length,
    name: repo.at(-1) ?? "",
    full_name: fullName,
    owner,
    owner_type: "user",
    owner_display_name: owner,
    description: "",
    private: false,
    fork,
    parent_full_name: parentFullName,
    parent_owner: parentFullName?.split("/")[0] ?? null,
  };
}

async function mountPage(
  platform: Platform = "github",
  cachedRepositories = [repository("team/repo")],
  activePlatform: Platform = platform,
  globalCreation = false,
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/pr/new/:platform", name: "pr-new", component: PrNewPage },
      { path: "/pr/:platform/:owner/:repo/:number", name: "pr-detail", component: {} },
    ],
  });
  const initialTarget = cachedRepositories[0]?.full_name ?? "team/repo";
  await router.push({
    name: "pr-new",
    params: { platform },
    query: globalCreation ? undefined : { target: initialTarget },
  });
  await router.isReady();
  const auth = useAuthStore();
  auth.setActivePlatform(activePlatform);
  auth.platforms[platform].isLoggedIn = true;
  const repos = useRepoStore();
  const activeRepository = cachedRepositories[0]?.full_name ?? "team/repo";
  const [owner, ...repoParts] = activeRepository.split("/");
  repos.activeRepos[platform] = { owner, repo: repoParts.join("/") };
  repos.reposCache[platform] = cachedRepositories;
  if (cachedRepositories.length > 0) {
    repos.pages[platform] = 1;
    repos.totalPagesByPlatform[platform] = 1;
  }
  const wrapper = mount(PrNewPage, {
    global: {
      plugins: [pinia, router],
      stubs: {
        AppLayout: {
          props: { compactSidebar: Boolean },
          template:
            '<div data-testid="app-layout" :data-compact-sidebar="compactSidebar"><slot name="header"/><slot/></div>',
        },
        DiffViewer: diffViewerStub,
      },
    },
  });
  await flushPromises();
  return { wrapper, router, repos };
}

describe("PrNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "draft-request") });
    vi.mocked(getPlatformCapabilities).mockImplementation(async (platform) =>
      platformCapabilities(platform),
    );
    vi.mocked(prBranches).mockResolvedValue({
      branches: ["main", "feature"],
      default_branch: "main",
    });
    vi.mocked(prCreate).mockResolvedValue({
      number: 51,
      detail: null,
      updated_fields: [],
      failures: [],
    });
    vi.mocked(prCreatePreview).mockResolvedValue(createPreview("Add feature"));
    vi.mocked(prDescriptionImageUpload).mockResolvedValue({
      markdown: "![clipboard.png](/uploads/hash/clipboard.png)",
      preview_markdown:
        "![clipboard.png](https://gitlab.example.com/team/repo/uploads/hash/clipboard.png)",
    });
    vi.mocked(prTemplates).mockResolvedValue([
      {
        name: "功能变更",
        title: "feat: ",
        body: "## 变更说明\n\n<!-- 请填写 -->",
        source_path: ".github/PULL_REQUEST_TEMPLATE/feature.md",
      },
    ]);
    vi.mocked(aiPrDraft).mockResolvedValue({
      title: "feat: add feature",
      body: "## 变更说明\n\n新增功能。",
    });
    vi.mocked(aiPrDraftCancel).mockResolvedValue(undefined);
    vi.mocked(listRepositoryLabels).mockResolvedValue([
      { name: "bug", color: "#d73a4a", description: "需要修复的问题" },
      { name: "feature", color: "b60205", description: "新功能" },
      { name: "frontend", color: null, description: null },
    ]);
    vi.mocked(prParticipantSuggestions).mockResolvedValue([
      { id: 1, login: "Alice", name: "Alice Zhang", avatar_url: "https://example.com/alice.png" },
      { id: 2, login: "Bob", name: "Bob", avatar_url: "" },
    ]);
    vi.mocked(repoList).mockResolvedValue({
      items: [repository("team/repo")],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
  });

  it("创建页使用紧凑侧栏布局", async () => {
    const { wrapper } = await mountPage();

    expect(wrapper.get('[data-testid="app-layout"]').attributes("data-compact-sidebar")).toBe(
      "true",
    );
  });

  it("标题和描述复用共享输入基础类", async () => {
    const { wrapper } = await mountPage();

    expect(wrapper.get("input[placeholder='简要说明这次变更']").classes()).toContain("input");
    expect(wrapper.get('textarea[aria-label="Markdown 描述"]').classes()).toContain("input");
  });

  it("标题最多允许 255 个 Unicode 字符", async () => {
    const { wrapper } = await mountPage();
    const titleInput = wrapper.get<HTMLInputElement>("input[placeholder='简要说明这次变更']");
    const submitButton = wrapper.get<HTMLButtonElement>("button[type='submit']");

    expect(titleInput.attributes("maxlength")).toBe("255");

    await titleInput.setValue("界".repeat(256));
    expect(submitButton.element.disabled).toBe(true);

    await titleInput.setValue("界".repeat(255));
    expect(submitButton.element.disabled).toBe(false);
  });

  it("使用语义标题组织创建流程而不显示装饰编号", async () => {
    const { wrapper } = await mountPage();

    const headings = wrapper.findAll(".section-heading h3").map((heading) => heading.text());
    const sections = wrapper.findAll(".form-section");
    expect(headings).toEqual(["选择变更来源", "变更预览", "说明变更内容", "参与者与分类"]);
    expect(sections).toHaveLength(4);
    expect(sections.every((section) => section.classes().includes("card"))).toBe(true);
    expect(wrapper.findAll(".section-heading > span")).toHaveLength(0);
  });

  it("创建同仓库 PR 后跳转现有详情页", async () => {
    const { wrapper, router } = await mountPage();
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Add feature");
    await wrapper.get('[aria-label="Reviewers"]').trigger("click");
    await wrapper.get(".multi-select-option[data-value='Alice']").trigger("click");
    await wrapper.get(".multi-select-option[data-value='Bob']").trigger("click");
    await wrapper.get('input[placeholder="搜索Reviewers"]').trigger("keydown", { key: "Escape" });
    await wrapper.get('[aria-label="Assignees"]').trigger("click");
    await wrapper.get(".multi-select-option[data-value='Alice']").trigger("click");
    await wrapper.get('input[placeholder="搜索Assignees"]').trigger("keydown", { key: "Escape" });
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(prBranches).toHaveBeenCalledTimes(1);
    expect(prCreate).toHaveBeenCalledWith(
      "github",
      "team",
      "repo",
      expect.objectContaining({
        source_owner: "team",
        source_repo: "repo",
        source_branch: "feature",
        target_branch: "main",
        title: "Add feature",
        reviewers: ["Alice", "Bob"],
        assignees: ["Alice"],
      }),
    );
    expect(router.currentRoute.value.name).toBe("pr-detail");
    expect(router.currentRoute.value.params.number).toBe("51");
  });

  it("创建成功切换目标仓库时清理旧 Fork 上下文", async () => {
    const { wrapper, repos } = await mountPage(
      "github",
      [repository("old/fork", true, "old/upstream"), repository("target/repo")],
      "github",
      true,
    );
    repos.setForkContext(
      {
        upstreamFullName: "old/upstream",
        upstreamOwner: "old",
        forkOwner: "old",
        forkRepo: "fork",
      },
      "github",
    );

    await wrapper.get('[aria-label="目标仓库"]').trigger("click");
    await wrapper.get(".dropdown-option[data-value='target/repo']").trigger("click");
    await flushPromises();
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Target change");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(repos.activeRepos.github).toEqual({ owner: "target", repo: "repo" });
    expect(repos.forkContexts.github).toBeNull();
  });

  it("创建部分成功时通过 query 和会话暂存向详情页传递警告", async () => {
    vi.mocked(prCreate).mockResolvedValue({
      number: 52,
      detail: null,
      updated_fields: [],
      failures: [{ field: "reviewers", message: "部分评审者不存在" }],
    });
    const { wrapper, router } = await mountPage();
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Partial success");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.name).toBe("pr-detail");
    expect(router.currentRoute.value.query[PR_CREATE_WARNING_QUERY]).toBe("1");
    expect(readPrCreateWarnings("github", "team", "repo", 52)).toEqual(["部分评审者不存在"]);
  });

  it("GitHub 分支下拉可以展开并切换源分支和目标分支", async () => {
    const { wrapper } = await mountPage();
    const sourceSelect = wrapper.get('[aria-label="源分支"]');

    await sourceSelect.trigger("click");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual([
      "main",
      "feature",
    ]);
    await wrapper.get(".dropdown-option[data-value='main']").trigger("click");
    expect(sourceSelect.text()).toContain("main");

    const targetSelect = wrapper.get('[aria-label="目标分支"]');
    await targetSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='feature']").trigger("click");
    expect(targetSelect.text()).toContain("feature");
  });

  it("从目标仓库加载标签并将多选结果提交给创建接口", async () => {
    const { wrapper } = await mountPage();

    expect(listRepositoryLabels).toHaveBeenCalledWith("github", "team", "repo");
    const labelsSelect = wrapper.get('[aria-label="标签"]');
    expect(labelsSelect.element.closest("label")?.querySelector("span")?.textContent).toBe("标签");
    await labelsSelect.trigger("click");
    await wrapper.get('input[placeholder="搜索标签"]').setValue("feature");
    await wrapper.get(".multi-select-option[data-value='feature']").trigger("click");
    await wrapper.get('input[placeholder="搜索标签"]').setValue("front");
    await wrapper.get(".multi-select-option[data-value='frontend']").trigger("click");
    await wrapper.get('input[placeholder="搜索标签"]').trigger("keydown", { key: "Escape" });

    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Labeled change");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(prCreate).toHaveBeenCalledWith(
      "github",
      "team",
      "repo",
      expect.objectContaining({ labels: ["feature", "frontend"] }),
    );
  });

  it("切换目标仓库后清空选择并忽略迟到的旧标签请求", async () => {
    let resolveOld!: (value: PrLabel[]) => void;
    vi.mocked(listRepositoryLabels).mockImplementation((_platform, owner) => {
      if (owner === "team") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve([
        { name: "other-only", color: "0e8a16", description: "其他仓库标签" },
      ]);
    });
    const { wrapper } = await mountPage(
      "github",
      [repository("team/repo"), repository("other/repo")],
      "github",
      true,
    );

    const targetSelect = wrapper.get('[aria-label="目标仓库"]');
    await targetSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='other/repo']").trigger("click");
    await flushPromises();

    expect(listRepositoryLabels).toHaveBeenLastCalledWith("github", "other", "repo");
    await wrapper.get('[aria-label="标签"]').trigger("click");
    expect(
      wrapper.findAll(".multi-select-option-copy > span").map((option) => option.text()),
    ).toEqual(["other-only"]);
    await wrapper.get(".multi-select-option[data-value='other-only']").trigger("click");
    await wrapper.get('input[placeholder="搜索标签"]').trigger("keydown", { key: "Escape" });

    resolveOld([{ name: "stale-label", color: null, description: null }]);
    await flushPromises();
    await wrapper.get('[aria-label="标签"]').trigger("click");
    expect(wrapper.find(".multi-select-option[data-value='stale-label']").exists()).toBe(false);
    expect(wrapper.get('[aria-label="标签"]').text()).toContain("other-only");
  });

  it("切换目标仓库后重新加载成员并忽略迟到的旧 Suggestions", async () => {
    let resolveOld!: (value: User[]) => void;
    vi.mocked(prParticipantSuggestions).mockImplementation((_platform, owner) => {
      if (owner === "team") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve([
        { id: 3, login: "carol", name: "Carol", avatar_url: "https://example.com/carol.png" },
      ]);
    });
    const { wrapper } = await mountPage(
      "github",
      [repository("team/repo"), repository("other/repo")],
      "github",
      true,
    );

    await wrapper.get('[aria-label="目标仓库"]').trigger("click");
    await wrapper.get(".dropdown-option[data-value='other/repo']").trigger("click");
    await flushPromises();

    expect(prParticipantSuggestions).toHaveBeenLastCalledWith("github", "other", "repo");
    await wrapper.get('[aria-label="Reviewers"]').trigger("click");
    await wrapper.get(".multi-select-option[data-value='carol']").trigger("click");
    await wrapper.get('input[placeholder="搜索Reviewers"]').trigger("keydown", { key: "Escape" });

    resolveOld([{ id: 1, login: "stale-user", name: "Stale", avatar_url: "" }]);
    await flushPromises();
    await wrapper.get('[aria-label="Reviewers"]').trigger("click");
    expect(wrapper.find(".multi-select-option[data-value='stale-user']").exists()).toBe(false);
    expect(wrapper.get('[aria-label="Reviewers"]').text()).toContain("carol");
  });

  it("标签读取失败时显示错误但不阻止创建", async () => {
    vi.mocked(listRepositoryLabels).mockRejectedValue(new Error("labels unavailable"));
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain("labels unavailable");
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("No labels");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(prCreate).toHaveBeenCalledWith(
      "github",
      "team",
      "repo",
      expect.objectContaining({ labels: [] }),
    );
  });

  it("仓库和分支下拉支持搜索", async () => {
    vi.mocked(prBranches).mockResolvedValue({
      branches: ["main", "feature", "release"],
      default_branch: "main",
    });
    const { wrapper } = await mountPage("github", [
      repository("team/repo"),
      repository("other/repo", true, "team/repo"),
    ]);

    const repositorySelect = wrapper.get('[aria-label="源仓库"]');
    await repositorySelect.trigger("click");
    await wrapper.get('input[placeholder="搜索仓库"]').setValue("other");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual([
      "other/repo",
    ]);
    await wrapper.get(".dropdown-option[data-value='other/repo']").trigger("click");
    await flushPromises();

    const sourceBranchSelect = wrapper.get('[aria-label="源分支"]');
    await sourceBranchSelect.trigger("click");
    await wrapper.get('input[placeholder="搜索源分支"]').setValue("rel");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual(["release"]);
    await wrapper.get(".dropdown-option[data-value='release']").trigger("click");

    const targetBranchSelect = wrapper.get('[aria-label="目标分支"]');
    await targetBranchSelect.trigger("click");
    await wrapper.get('input[placeholder="搜索目标分支"]').setValue("mai");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual(["main"]);
  });

  it("切换源仓库时重新请求并替换目标分支", async () => {
    let targetRequestCount = 0;
    vi.mocked(prBranches).mockImplementation(async (_platform, owner) => {
      if (owner === "team") {
        targetRequestCount += 1;
        return targetRequestCount === 1
          ? { branches: ["main", "feature"], default_branch: "main" }
          : { branches: ["develop"], default_branch: "develop" };
      }
      return { branches: ["topic"], default_branch: "topic" };
    });
    const { wrapper } = await mountPage("github", [
      repository("team/repo"),
      repository("other/repo", true, "team/repo"),
    ]);

    expect(wrapper.get('[aria-label="目标分支"]').text()).toContain("main");
    await wrapper.get('[aria-label="源仓库"]').trigger("click");
    await wrapper.get(".dropdown-option[data-value='other/repo']").trigger("click");
    await flushPromises();

    expect(targetRequestCount).toBe(2);
    expect(prBranches).toHaveBeenCalledWith("github", "other", "repo");
    expect(wrapper.get('[aria-label="目标分支"]').text()).toContain("develop");
  });

  it("切换源仓库时保留仍然有效的已选目标分支", async () => {
    vi.mocked(prBranches).mockImplementation(async (_platform, owner) =>
      owner === "team"
        ? { branches: ["main", "feature", "release/1.2"], default_branch: "main" }
        : { branches: ["fork-topic"], default_branch: "fork-topic" },
    );
    const { wrapper } = await mountPage("github", [
      repository("team/repo"),
      repository("other/repo", true, "team/repo"),
    ]);

    const targetBranchSelect = wrapper.get('[aria-label="目标分支"]');
    await targetBranchSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='release/1.2']").trigger("click");
    await flushPromises();

    await wrapper.get('[aria-label="源仓库"]').trigger("click");
    await wrapper.get(".dropdown-option[data-value='other/repo']").trigger("click");
    await flushPromises();

    expect(wrapper.get('[aria-label="目标分支"]').text()).toContain("release/1.2");
    expect(prCreatePreview).toHaveBeenLastCalledWith("github", "team", "repo", {
      source_owner: "other",
      source_repo: "repo",
      source_branch: "fork-topic",
      target_branch: "release/1.2",
    });
  });

  it("分支选择完成后展示提交列表和只读 Diff", async () => {
    const { wrapper } = await mountPage();

    expect(prCreatePreview).toHaveBeenCalledWith("github", "team", "repo", {
      source_owner: "team",
      source_repo: "repo",
      source_branch: "feature",
      target_branch: "main",
    });
    expect(wrapper.text()).toContain("Add feature");
    expect(wrapper.text()).toContain("12345678");
    expect(wrapper.get(".preview-summary").text()).toContain("1 个提交");
    expect(wrapper.get(".preview-summary").text()).toContain("1 个文件");
    expect(wrapper.find(".preview-tabs .tab-count").exists()).toBe(false);
    expect(wrapper.get(".preview-section").classes()).toEqual(
      expect.arrayContaining(["card", "form-section", "preview-section"]),
    );

    await wrapper.get('[role="tab"][aria-selected="false"]').trigger("click");
    expect(wrapper.get('[data-testid="diff-preview"]').text()).toBe("1 files");
    const diffViewer = wrapper.getComponent(diffViewerStub);
    expect(diffViewer.props()).toMatchObject({
      platform: "github",
      baseOwner: "team",
      baseRepo: "repo",
      headOwner: "team",
      headRepo: "repo",
      baseSha: "main",
      headSha: "feature",
      readOnly: true,
    });
  });

  it("预览被平台截断时显著警告但仍允许创建", async () => {
    const incompletePreview = createPreview(
      "Partial preview",
      "partial-sha",
      "src/partial.ts",
      true,
    );
    incompletePreview.commits = [];
    incompletePreview.diff.files = [];
    vi.mocked(prCreatePreview).mockResolvedValue(incompletePreview);
    const { wrapper } = await mountPage();

    expect(wrapper.get(".preview-warning").text()).toContain("预览不完整");
    expect(wrapper.get(".preview-warning").text()).toContain("不影响创建 PR");
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Large change");
    expect(wrapper.get<HTMLButtonElement>("button[type='submit']").element.disabled).toBe(false);

    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(prCreate).toHaveBeenCalledOnce();
  });

  it("Compare 补页失败时展示可排障的降级提示且仍允许创建", async () => {
    const incompletePreview = createPreview(
      "Partial preview",
      "partial-sha",
      "src/partial.ts",
      true,
    );
    incompletePreview.incomplete_reasons = ["pagination_failed"];
    vi.mocked(prCreatePreview).mockResolvedValue(incompletePreview);
    const { wrapper } = await mountPage();

    expect(wrapper.get(".preview-warning").text()).toContain("后续分页加载失败");
    expect(wrapper.get(".preview-warning").text()).toContain("不影响创建 PR");
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Large change");
    expect(wrapper.get<HTMLButtonElement>("button[type='submit']").element.disabled).toBe(false);
  });

  it("创建 PR 描述支持 Markdown 编辑和预览且提交原始文本", async () => {
    const { wrapper } = await mountPage();
    const markdown = "# 变更说明\n\n- 第一项\n- 第二项\n\n`code`";
    await wrapper.get('textarea[aria-label="Markdown 描述"]').setValue(markdown);

    const modeTabs = wrapper.get('[aria-label="Markdown 描述模式"]');
    await modeTabs.findAll("button")[1].trigger("click");

    expect(wrapper.get(".description-preview h1").text()).toBe("变更说明");
    expect(wrapper.findAll(".description-preview li")).toHaveLength(2);
    expect(wrapper.get(".description-preview code").text()).toBe("code");

    await modeTabs.findAll("button")[0].trigger("click");
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]').element.value,
    ).toBe(markdown);
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Markdown change");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(prCreate).toHaveBeenCalledWith(
      "github",
      "team",
      "repo",
      expect.objectContaining({ body: markdown }),
    );
  });

  it("GitLab 描述可粘贴图片并在原光标位置插入原生 Markdown", async () => {
    const { wrapper } = await mountPage("gitlab");
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]');
    await textarea.setValue("开头结尾");
    textarea.element.setSelectionRange(2, 2);
    const file = {
      name: "clipboard.png",
      type: "image/png",
      size: 8,
      arrayBuffer: vi.fn(async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer),
    } as unknown as File;

    await textarea.trigger("paste", {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });
    await flushPromises();

    expect(prDescriptionImageUpload).toHaveBeenCalledWith(
      "gitlab",
      "team",
      "repo",
      "clipboard.png",
      "image/png",
      "iVBORw0KGgo=",
    );
    expect(textarea.element.value).toBe("开头![clipboard.png](/uploads/hash/clipboard.png)结尾");
    const modeTabs = wrapper.get('[aria-label="Markdown 描述模式"]');
    await modeTabs.findAll("button")[1].trigger("click");
    expect(wrapper.get<HTMLImageElement>(".description-preview img").attributes("src")).toBe(
      "https://gitlab.example.com/team/repo/uploads/hash/clipboard.png",
    );
    await modeTabs.findAll("button")[0].trigger("click");
    expect(textarea.element.value).toBe("开头![clipboard.png](/uploads/hash/clipboard.png)结尾");
    expect(wrapper.find(".description-upload-status").exists()).toBe(false);
    expect(wrapper.find(".description-upload-help").text()).toContain("可直接粘贴");
  });

  it("GitLab 图片上传失败后清理占位并允许再次粘贴", async () => {
    vi.mocked(prDescriptionImageUpload)
      .mockRejectedValueOnce(new Error("upload unavailable"))
      .mockResolvedValueOnce({
        markdown: "![clipboard.png](/uploads/hash/clipboard.png)",
        preview_markdown:
          "![clipboard.png](https://gitlab.example.com/team/repo/uploads/hash/clipboard.png)",
      });
    const { wrapper } = await mountPage("gitlab");
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]');
    await textarea.setValue("说明");
    textarea.element.setSelectionRange(2, 2);
    const file = {
      name: "clipboard.png",
      type: "image/png",
      size: 8,
      arrayBuffer: vi.fn(async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer),
    } as unknown as File;
    const pasteImage = () =>
      textarea.trigger("paste", {
        clipboardData: {
          items: [
            {
              kind: "file",
              type: "image/png",
              getAsFile: () => file,
            },
          ],
        },
      });

    await pasteImage();
    await flushPromises();

    expect(textarea.element.value).toBe("说明");
    expect(textarea.element.value).not.toContain("mergebeacon-image-upload");
    expect(wrapper.get(".description-field .error-msg").text()).toContain("upload unavailable");
    expect(wrapper.find(".description-upload-status").exists()).toBe(false);

    textarea.element.setSelectionRange(
      textarea.element.value.length,
      textarea.element.value.length,
    );
    await pasteImage();
    await flushPromises();

    expect(prDescriptionImageUpload).toHaveBeenCalledTimes(2);
    expect(textarea.element.value).toBe("说明![clipboard.png](/uploads/hash/clipboard.png)");
    expect(textarea.element.value).not.toContain("mergebeacon-image-upload");
    expect(wrapper.find(".description-field .error-msg").exists()).toBe(false);
    expect(wrapper.find(".description-upload-status").exists()).toBe(false);
  });

  it("能力仍在加载时等待完成并继续本次 GitLab 图片粘贴", async () => {
    let resolveCapabilities!: (value: PlatformCapabilities) => void;
    vi.mocked(getPlatformCapabilities).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCapabilities = resolve;
        }),
    );
    const { wrapper } = await mountPage("gitlab");
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]');
    const file = {
      name: "clipboard.png",
      type: "image/png",
      size: 8,
      arrayBuffer: vi.fn(async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer),
    } as unknown as File;

    expect(wrapper.get(".description-upload-help").text()).toContain("正在加载");
    expect(wrapper.get(".description-upload-help").text()).not.toContain("不支持");
    await textarea.trigger("paste", {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });
    await flushPromises();

    expect(prDescriptionImageUpload).not.toHaveBeenCalled();
    expect(wrapper.get(".description-upload-status").text()).toContain("正在加载平台能力");
    expect(wrapper.find(".description-field .error-msg").exists()).toBe(false);

    resolveCapabilities(platformCapabilities("gitlab"));
    await flushPromises();

    expect(getPlatformCapabilities).toHaveBeenCalledTimes(1);
    expect(prDescriptionImageUpload).toHaveBeenCalledWith(
      "gitlab",
      "team",
      "repo",
      "clipboard.png",
      "image/png",
      "iVBORw0KGgo=",
    );
    expect(textarea.element.value).toBe("![clipboard.png](/uploads/hash/clipboard.png)");
    expect(wrapper.find(".description-upload-status").exists()).toBe(false);
  });

  it("图片粘贴等待能力加载失败时提示重试而不是误报不支持", async () => {
    let rejectCapabilities!: (reason: unknown) => void;
    vi.mocked(getPlatformCapabilities).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectCapabilities = reject;
        }),
    );
    const { wrapper } = await mountPage("gitlab");
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]');
    const file = {
      name: "clipboard.png",
      type: "image/png",
      size: 8,
      arrayBuffer: vi.fn(),
    } as unknown as File;

    await textarea.trigger("paste", {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });
    rejectCapabilities(new Error("network unavailable"));
    await flushPromises();

    expect(prDescriptionImageUpload).not.toHaveBeenCalled();
    expect(textarea.element.value).toBe("");
    expect(wrapper.get(".description-field .error-msg").text()).toContain("平台能力加载失败");
    expect(wrapper.get(".description-field .error-msg").text()).not.toContain("不支持");
    expect(wrapper.get(".description-upload-help").text()).toContain("平台能力加载失败");
  });

  it("切换目标仓库后清理上传占位并忽略迟到的图片响应", async () => {
    let resolveUpload!: (value: { markdown: string; preview_markdown: string }) => void;
    vi.mocked(prDescriptionImageUpload).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const { wrapper } = await mountPage(
      "gitlab",
      [repository("team/repo"), repository("other/repo")],
      "gitlab",
      true,
    );
    const textarea = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]');
    await textarea.setValue("说明");
    textarea.element.setSelectionRange(2, 2);
    const file = {
      name: "clipboard.png",
      type: "image/png",
      size: 8,
      arrayBuffer: vi.fn(async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]).buffer),
    } as unknown as File;

    await textarea.trigger("paste", {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });
    await flushPromises();
    expect(wrapper.get(".description-upload-status").text()).toContain("图片上传中");
    expect(textarea.element.value).toContain("mergebeacon-image-upload");

    await wrapper.get('[aria-label="目标仓库"]').trigger("click");
    await wrapper.get(".dropdown-option[data-value='other/repo']").trigger("click");
    await flushPromises();

    expect(textarea.element.value).toBe("说明");
    expect(wrapper.find(".description-upload-status").exists()).toBe(false);
    resolveUpload({
      markdown: "![stale.png](/uploads/stale.png)",
      preview_markdown: "![stale.png](https://gitlab.example.com/stale.png)",
    });
    await flushPromises();
    expect(textarea.element.value).toBe("说明");
  });

  it("GitHub 粘贴图片时明确提示公开 API 不支持上传", async () => {
    const { wrapper } = await mountPage("github");
    const file = {
      name: "clipboard.png",
      type: "image/png",
      size: 8,
      arrayBuffer: vi.fn(),
    } as unknown as File;

    await wrapper.get('textarea[aria-label="Markdown 描述"]').trigger("paste", {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(prDescriptionImageUpload).not.toHaveBeenCalled();
    expect(wrapper.get(".description-field .error-msg").text()).toContain("公开 API 不支持");
    expect(wrapper.get(".description-upload-help").text()).toContain("不支持从应用粘贴上传图片");
  });

  it("拒绝超过 5 MiB 的 GitLab 粘贴图片且不读取内容", async () => {
    const { wrapper } = await mountPage("gitlab");
    const file = {
      name: "large.png",
      type: "image/png",
      size: 5 * 1024 * 1024 + 1,
      arrayBuffer: vi.fn(),
    } as unknown as File;

    await wrapper.get('textarea[aria-label="Markdown 描述"]').trigger("paste", {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
      },
    });

    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(prDescriptionImageUpload).not.toHaveBeenCalled();
    expect(wrapper.get(".description-field .error-msg").text()).toContain("不能超过 5 MiB");
    expect(wrapper.get(".description-upload-help").text()).toContain("不超过 5 MiB");
  });

  it("普通文本粘贴不触发图片上传", async () => {
    const { wrapper } = await mountPage("gitlab");

    await wrapper.get('textarea[aria-label="Markdown 描述"]').trigger("paste", {
      clipboardData: { items: [{ kind: "string", type: "text/plain" }] },
    });

    expect(prDescriptionImageUpload).not.toHaveBeenCalled();
    expect(wrapper.find(".description-field .error-msg").exists()).toBe(false);
  });

  it("剪贴板同时包含文本和图片时优先保留原生文本粘贴", async () => {
    const { wrapper } = await mountPage("gitlab");
    const getAsFile = vi.fn(() => ({
      name: "clipboard.png",
      type: "image/png",
      size: 8,
      arrayBuffer: vi.fn(),
    })) as unknown as DataTransferItem["getAsFile"];

    await wrapper.get('textarea[aria-label="Markdown 描述"]').trigger("paste", {
      clipboardData: {
        items: [
          { kind: "string", type: "text/plain" },
          { kind: "file", type: "image/png", getAsFile },
        ],
      },
    });

    expect(getAsFile).not.toHaveBeenCalled();
    expect(prDescriptionImageUpload).not.toHaveBeenCalled();
    expect(wrapper.find(".description-upload-status").exists()).toBe(false);
    expect(wrapper.find(".description-field .error-msg").exists()).toBe(false);
  });

  it("Diff 可以按提交切换，并支持恢复全部提交视图", async () => {
    vi.mocked(prCreatePreview).mockImplementation(async (_platform, _owner, _repo, request) => {
      const result = request.commit_sha
        ? createPreview("Commit-only", request.commit_sha, "src/commit.ts", true)
        : createPreview("All commits", "branch-sha", "src/all.ts");
      if (request.commit_sha) result.base_revision = "parent-sha";
      return result;
    });
    const { wrapper } = await mountPage();

    await wrapper.get('[role="tab"][aria-selected="false"]').trigger("click");
    const scopeSelect = wrapper.get('[aria-label="Diff 范围"]');
    await scopeSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='branch-sha']").trigger("click");
    await flushPromises();

    expect(prCreatePreview).toHaveBeenLastCalledWith("github", "team", "repo", {
      source_owner: "team",
      source_repo: "repo",
      source_branch: "feature",
      target_branch: "main",
      commit_sha: "branch-sha",
    });
    expect(wrapper.getComponent(diffViewerStub).props("diff").files[0].filename).toBe(
      "src/commit.ts",
    );
    expect(wrapper.getComponent(diffViewerStub).props()).toMatchObject({
      baseOwner: "team",
      baseRepo: "repo",
      baseSha: "parent-sha",
      headSha: "branch-sha",
    });
    expect(wrapper.get(".preview-warning").text()).toContain("预览不完整");

    await scopeSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='']").trigger("click");
    await flushPromises();
    expect(wrapper.getComponent(diffViewerStub).props("diff").files[0].filename).toBe("src/all.ts");
  });

  it("根提交没有父 revision 时明确提示仅显示变更后图片", async () => {
    vi.mocked(prCreatePreview).mockImplementation(async (_platform, _owner, _repo, request) =>
      request.commit_sha
        ? createPreview("Root commit", request.commit_sha, "assets/root.svg")
        : createPreview("All commits", "root-sha", "assets/root.svg"),
    );
    const { wrapper } = await mountPage();

    await wrapper.get('[role="tab"][aria-selected="false"]').trigger("click");
    const scopeSelect = wrapper.get('[aria-label="Diff 范围"]');
    await scopeSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='root-sha']").trigger("click");
    await flushPromises();

    expect(wrapper.get(".preview-scope-note").text()).toContain("仅显示变更后图片");
    expect(wrapper.getComponent(diffViewerStub).props()).toMatchObject({
      baseSha: "",
      headSha: "root-sha",
    });
  });

  it("不完整提示只跟随当前选择的 Diff 范围", async () => {
    vi.mocked(prCreatePreview).mockImplementation(async (_platform, _owner, _repo, request) =>
      request.commit_sha
        ? createPreview("Complete commit", request.commit_sha, "src/commit.ts")
        : createPreview("Partial branch", "branch-sha", "src/all.ts", true),
    );
    const { wrapper } = await mountPage();

    expect(wrapper.find(".preview-warning").exists()).toBe(true);
    await wrapper.get('[role="tab"][aria-selected="false"]').trigger("click");
    const scopeSelect = wrapper.get('[aria-label="Diff 范围"]');
    await scopeSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='branch-sha']").trigger("click");
    await flushPromises();

    expect(wrapper.find(".preview-warning").exists()).toBe(false);
  });

  it("切换分支后忽略迟到的旧预览请求", async () => {
    let resolveOld!: (value: PrCreatePreview) => void;
    vi.mocked(prBranches).mockResolvedValue({
      branches: ["main", "feature", "next"],
      default_branch: "main",
    });
    vi.mocked(prCreatePreview).mockImplementation((_platform, _owner, _repo, request) => {
      if (request.source_branch === "feature") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve(createPreview("Newest preview", "next1234"));
    });
    const { wrapper } = await mountPage();

    const sourceSelect = wrapper.get('[aria-label="源分支"]');
    await sourceSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='next']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Newest preview");

    resolveOld(createPreview("Stale preview", "stale123"));
    await flushPromises();
    expect(wrapper.text()).toContain("Newest preview");
    expect(wrapper.text()).not.toContain("Stale preview");
  });

  it("查看上游仓库时默认使用 Fork 作为源仓库", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/pr/new/:platform", name: "pr-new", component: PrNewPage },
        { path: "/pr/:platform/:owner/:repo/:number", name: "pr-detail", component: {} },
      ],
    });
    await router.push({ name: "pr-new", params: { platform: "github" } });
    const auth = useAuthStore();
    auth.platforms.github.isLoggedIn = true;
    const repos = useRepoStore();
    repos.setActiveRepo("upstream", "repo");
    repos.reposCache.github = [repository("contributor/repo", true, "upstream/repo")];
    repos.setForkContext({
      upstreamFullName: "upstream/repo",
      upstreamOwner: "upstream",
      forkOwner: "contributor",
      forkRepo: "repo",
    });
    vi.mocked(prBranches).mockImplementation(async (_platform, owner) =>
      owner === "upstream"
        ? { branches: ["release"], default_branch: "develop" }
        : { branches: ["feature"], default_branch: "feature" },
    );

    const wrapper = mount(PrNewPage, {
      global: {
        plugins: [pinia, router],
        stubs: {
          AppLayout: {
            props: { compactSidebar: Boolean },
            template: '<div><slot name="header"/><slot/></div>',
          },
          DiffViewer: diffViewerStub,
        },
      },
    });
    await flushPromises();

    const targetSelect = wrapper.get('[aria-label="目标分支"]');
    await targetSelect.trigger("click");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual([
      "develop",
      "release",
    ]);
    await targetSelect.trigger("click");

    const sourceSelect = wrapper.get('[aria-label="源分支"]');
    await sourceSelect.trigger("click");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual(["feature"]);
    await sourceSelect.trigger("click");

    expect(prCreatePreview).toHaveBeenCalledWith("github", "upstream", "repo", {
      source_owner: "contributor",
      source_repo: "repo",
      source_branch: "feature",
      target_branch: "develop",
    });

    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("Fork change");
    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(prCreate).toHaveBeenCalledWith(
      "github",
      "upstream",
      "repo",
      expect.objectContaining({
        source_owner: "contributor",
        source_repo: "repo",
        source_branch: "feature",
        target_branch: "develop",
      }),
    );
  });

  it("Gitee 使用评审者和测试者文案且不显示 Draft 选项", async () => {
    const { wrapper } = await mountPage("gitee");

    expect(wrapper.get("h2").text()).toBe("创建 PR");
    expect(wrapper.text()).toContain("评审者");
    expect(wrapper.text()).toContain("测试者");
    expect(wrapper.get('[aria-label="标签"]').attributes("aria-label")).toBe("标签");
    expect(wrapper.text()).not.toContain("创建为 Draft");
  });

  it("GitLab 使用创建 MR 文案", async () => {
    const { wrapper } = await mountPage("gitlab");

    expect(wrapper.get("h2").text()).toBe("创建 MR");
    expect(wrapper.get("button[type='submit']").text()).toBe("创建 MR");
    expect(wrapper.get('[aria-label="标签"]').attributes("aria-label")).toBe("标签");
  });

  it("创建页按路由平台请求，避免使用过期的全局活动平台", async () => {
    const { wrapper } = await mountPage("gitee", [repository("t8y2/dbx")], "github");

    expect(wrapper.text()).toContain("目标仓库：t8y2/dbx");
    expect(wrapper.find('[aria-label="目标仓库"]').exists()).toBe(false);
    expect(getPlatformCapabilities).toHaveBeenCalledWith("gitee");
    expect(prBranches).toHaveBeenCalledWith("gitee", "t8y2", "dbx");
    expect(prCreatePreview).toHaveBeenCalledWith("gitee", "t8y2", "dbx", expect.any(Object));
    expect(
      vi.mocked(prBranches).mock.calls.every(([requestPlatform]) => requestPlatform === "gitee"),
    ).toBe(true);
  });

  it("源仓库搜索只展示目标仓库及其同平台 Fork", async () => {
    const { wrapper, repos } = await mountPage(
      "gitee",
      [
        repository("t8y2/dbx"),
        repository("gitee-only/dbx", true, "t8y2/dbx"),
        repository("unrelated/tools"),
      ],
      "github",
    );
    repos.reposCache.github = [repository("github-only/project")];
    await flushPromises();

    const repositorySelect = wrapper.get('[aria-label="源仓库"]');
    await repositorySelect.trigger("click");

    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual([
      "t8y2/dbx",
      "gitee-only/dbx",
    ]);
    await wrapper.get('input[placeholder="搜索仓库"]').setValue("unrelated");
    expect(wrapper.findAll(".dropdown-option")).toHaveLength(0);
    await wrapper.get('input[placeholder="搜索仓库"]').setValue("github-only");
    expect(wrapper.findAll(".dropdown-option")).toHaveLength(0);
  });

  it("全局创建页可以搜索并切换目标仓库", async () => {
    const { wrapper } = await mountPage(
      "github",
      [repository("team/repo"), repository("other/repo", true, "team/repo")],
      "github",
      true,
    );

    const targetSelect = wrapper.get('[aria-label="目标仓库"]');
    await targetSelect.trigger("click");
    await wrapper.get('input[placeholder="搜索目标仓库"]').setValue("other");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual([
      "other/repo",
    ]);
    await wrapper.get(".dropdown-option[data-value='other/repo']").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("目标仓库：other/repo");
    expect(prBranches).toHaveBeenCalledWith("github", "other", "repo");
    expect(prCreatePreview).toHaveBeenLastCalledWith("github", "other", "repo", {
      source_owner: "other",
      source_repo: "repo",
      source_branch: "feature",
      target_branch: "main",
    });
  });

  it("全局创建页只加载首屏并按需加载更多仓库", async () => {
    vi.mocked(repoList).mockImplementation(async (_platform, page = 1) => ({
      items: [repository(page === 1 ? "first/repo" : "second/repo")],
      page,
      total_pages: 3,
      total_count: 3,
    }));

    const { wrapper } = await mountPage("github", [], "github", true);

    expect(repoList).toHaveBeenCalledTimes(1);
    expect(repoList).toHaveBeenLastCalledWith("github", 1);
    const targetSelect = wrapper.get('[aria-label="目标仓库"]');
    await targetSelect.trigger("click");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toContain(
      "first/repo",
    );

    await wrapper.get(".dropdown-load-more").trigger("click");
    await flushPromises();

    expect(repoList).toHaveBeenCalledTimes(2);
    expect(repoList).toHaveBeenLastCalledWith("github", 2);
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toContain(
      "second/repo",
    );
  });

  it("全局创建页将 Fork 的上游仓库加入目标仓库候选", async () => {
    const { wrapper } = await mountPage(
      "github",
      [repository("contributor/project", true, "upstream/project")],
      "github",
      true,
    );

    const targetSelect = wrapper.get('[aria-label="目标仓库"]');
    await targetSelect.trigger("click");
    await wrapper.get('input[placeholder="搜索目标仓库"]').setValue("upstream");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual([
      "upstream/project",
    ]);
    await wrapper.get(".dropdown-option[data-value='upstream/project']").trigger("click");
    await flushPromises();

    const sourceSelect = wrapper.get('[aria-label="源仓库"]');
    await sourceSelect.trigger("click");
    expect(wrapper.findAll(".dropdown-option").map((option) => option.text())).toEqual([
      "upstream/project",
      "contributor/project",
    ]);
  });

  it("平台不支持创建 PR / MR 时显示明确提示", async () => {
    vi.mocked(getPlatformCapabilities).mockResolvedValue({
      ...platformCapabilities("github"),
      supports_pr_creation: false,
    });
    const { wrapper } = await mountPage();

    expect(wrapper.get('[role="status"]').text()).toBe("当前平台不支持创建 PR。");
    expect(wrapper.get<HTMLButtonElement>("button[type='submit']").element.disabled).toBe(true);
  });

  it("规范化模板选项时不修改 API 返回对象", async () => {
    const remoteTemplate: PrTemplate = {
      name: "  功能变更  ",
      title: "feat: ",
      body: "## 变更说明",
      source_path: "  .github/PULL_REQUEST_TEMPLATE/feature.md  ",
    };
    vi.mocked(prTemplates).mockResolvedValueOnce([remoteTemplate]);

    const { wrapper } = await mountPage();

    expect(remoteTemplate).toEqual({
      name: "  功能变更  ",
      title: "feat: ",
      body: "## 变更说明",
      source_path: "  .github/PULL_REQUEST_TEMPLATE/feature.md  ",
    });
    await wrapper.get('[aria-label="PR 模板"]').trigger("click");
    expect(
      wrapper.get(".dropdown-option[data-value='.github/PULL_REQUEST_TEMPLATE/feature.md']").text(),
    ).toContain("功能变更");
  });

  it("从目标仓库加载并显式应用 PR 模板", async () => {
    const { wrapper } = await mountPage();

    expect(prTemplates).toHaveBeenCalledWith("github", "team", "repo");
    const templateSelect = wrapper.get('[aria-label="PR 模板"]');
    await templateSelect.trigger("click");
    await wrapper
      .get(".dropdown-option[data-value='.github/PULL_REQUEST_TEMPLATE/feature.md']")
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "应用模板")!
      .trigger("click");

    expect(
      wrapper.get<HTMLInputElement>("input[placeholder='简要说明这次变更']").element.value,
    ).toBe("feat: ");
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]').element.value,
    ).toBe("## 变更说明\n\n<!-- 请填写 -->");
  });

  it("模板默认仅填充空字段并保留用户已有内容", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("用户已写标题");
    await wrapper.get('[aria-label="PR 模板"]').trigger("click");
    await wrapper
      .get(".dropdown-option[data-value='.github/PULL_REQUEST_TEMPLATE/feature.md']")
      .trigger("click");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "应用模板")!
      .trigger("click");

    expect(
      wrapper.get<HTMLInputElement>("input[placeholder='简要说明这次变更']").element.value,
    ).toBe("用户已写标题");
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]').element.value,
    ).toBe("## 变更说明\n\n<!-- 请填写 -->");
    expect(wrapper.get(".draft-assistant-notice").text()).toContain("模板未覆盖已有标题");
  });

  it("AI 使用当前预览和所选模板填充标题与描述", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('[aria-label="PR 模板"]').trigger("click");
    await wrapper
      .get(".dropdown-option[data-value='.github/PULL_REQUEST_TEMPLATE/feature.md']")
      .trigger("click");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "AI 填充")!
      .trigger("click");
    await flushPromises();

    expect(aiPrDraft).toHaveBeenCalledWith("draft-request", {
      source_branch: "feature",
      target_branch: "main",
      commits: createPreview("Add feature").commits,
      diff: "diff --git a/src/a.ts b/src/a.ts",
      template_body: "## 变更说明\n\n<!-- 请填写 -->",
    });
    expect(
      wrapper.get<HTMLInputElement>("input[placeholder='简要说明这次变更']").element.value,
    ).toBe("feat: add feature");
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]').element.value,
    ).toBe("## 变更说明\n\n新增功能。");
  });

  it("Diff 超过 64 KiB 时提示 AI 只基于前 64 KiB 生成", async () => {
    const preview = createPreview("Add feature");
    preview.diff.diff = "中".repeat(Math.floor((64 * 1024) / 3) + 1);
    vi.mocked(prCreatePreview).mockResolvedValue(preview);

    const { wrapper } = await mountPage();

    expect(wrapper.get(".draft-assistant-warning").text()).toBe(
      "Diff 较长，AI 仅基于前 64 KiB 生成草稿。",
    );
  });

  it("Diff 超过 1 MiB 时提示分层截断并按 UTF-8 字节限制请求", async () => {
    const preview = createPreview("Add feature");
    preview.diff.diff = "中".repeat(Math.floor(1_048_576 / 3) + 1);
    vi.mocked(prCreatePreview).mockResolvedValue(preview);

    const { wrapper } = await mountPage();

    expect(wrapper.get(".draft-assistant-warning").text()).toBe(
      "当前 Diff 超过 1 MiB，发送前会先截断；AI 最终仅基于前 64 KiB 生成草稿。",
    );

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "AI 填充")!
      .trigger("click");
    await flushPromises();

    const request = vi.mocked(aiPrDraft).mock.calls[0]?.[1];
    expect(request).toBeDefined();
    expect(new TextEncoder().encode(request!.diff).length).toBeLessThanOrEqual(1_048_576);
    expect(request!.diff).not.toContain("�");
  });

  it("AI 默认只生成空字段并保留用户长描述", async () => {
    const { wrapper } = await mountPage();
    await wrapper
      .get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]')
      .setValue("用户已经写好的长描述，不应被 AI 覆盖。".repeat(20));

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "AI 填充")!
      .trigger("click");
    await flushPromises();

    expect(
      wrapper.get<HTMLInputElement>("input[placeholder='简要说明这次变更']").element.value,
    ).toBe("feat: add feature");
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]').element.value,
    ).toBe("用户已经写好的长描述，不应被 AI 覆盖。".repeat(20));
    expect(wrapper.get(".draft-assistant-notice").text()).toContain("AI未覆盖已有描述");
  });

  it("标题和描述均有内容时不发起无效 AI 请求", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("用户标题");
    await wrapper
      .get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]')
      .setValue("用户描述");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "AI 填充")!
      .trigger("click");
    await flushPromises();

    expect(aiPrDraft).not.toHaveBeenCalled();
    expect(wrapper.get(".draft-assistant-notice").text()).toContain("AI未覆盖已有标题和描述");
  });

  it("显式选择覆盖全部后允许 AI 替换现有草稿", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get("input[placeholder='简要说明这次变更']").setValue("用户标题");
    await wrapper
      .get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]')
      .setValue("用户描述");
    await wrapper.get('[aria-label="草稿写入方式"]').trigger("click");
    await wrapper.get(".dropdown-option[data-value='overwrite']").trigger("click");

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "AI 填充")!
      .trigger("click");
    await flushPromises();

    expect(
      wrapper.get<HTMLInputElement>("input[placeholder='简要说明这次变更']").element.value,
    ).toBe("feat: add feature");
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]').element.value,
    ).toBe("## 变更说明\n\n新增功能。");
    expect(wrapper.find(".draft-assistant-notice").exists()).toBe(false);
  });

  it("分支变化时取消仍在运行的 AI 草稿请求", async () => {
    vi.mocked(aiPrDraft).mockImplementation(() => new Promise(() => {}));
    const { wrapper } = await mountPage();

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "AI 填充")!
      .trigger("click");
    expect(wrapper.findAll("button").some((button) => button.text() === "取消生成")).toBe(true);

    await wrapper.get('[aria-label="源分支"]').trigger("click");
    await wrapper.get(".dropdown-option[data-value='main']").trigger("click");
    await flushPromises();

    expect(aiPrDraftCancel).toHaveBeenCalledWith("draft-request");
    expect(wrapper.findAll("button").some((button) => button.text() === "取消生成")).toBe(false);
  });

  it("分支变化后忽略迟到的 AI 草稿", async () => {
    let resolveDraft!: (value: { title: string; body: string }) => void;
    vi.mocked(aiPrDraft).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDraft = resolve;
        }),
    );
    const { wrapper } = await mountPage();

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "AI 填充")!
      .trigger("click");
    const sourceSelect = wrapper.get('[aria-label="源分支"]');
    await sourceSelect.trigger("click");
    await wrapper.get(".dropdown-option[data-value='main']").trigger("click");
    await flushPromises();

    resolveDraft({ title: "stale title", body: "stale body" });
    await flushPromises();

    expect(
      wrapper.get<HTMLInputElement>("input[placeholder='简要说明这次变更']").element.value,
    ).toBe("");
    expect(
      wrapper.get<HTMLTextAreaElement>('textarea[aria-label="Markdown 描述"]').element.value,
    ).toBe("");
  });

  it("模板重载后清理已不存在的选择", async () => {
    const { wrapper } = await mountPage();
    const templateSelect = wrapper.get('[aria-label="PR 模板"]');
    await templateSelect.trigger("click");
    await wrapper
      .get(".dropdown-option[data-value='.github/PULL_REQUEST_TEMPLATE/feature.md']")
      .trigger("click");
    vi.mocked(prTemplates).mockResolvedValueOnce([] as PrTemplate[]);

    await wrapper
      .findAll("button")
      .find((button) => button.text() === "重新加载")!
      .trigger("click");
    await flushPromises();

    expect(templateSelect.text()).toContain("仓库暂无模板");
    expect(
      wrapper
        .findAll("button")
        .find((button) => button.text() === "应用模板")!
        .attributes("disabled"),
    ).toBeDefined();
  });
});
