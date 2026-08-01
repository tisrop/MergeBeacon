import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrMetadataPanel from "../PrMetadataPanel.vue";
import { clipboardWriteText, listRepositoryLabels, prParticipantSuggestions } from "@/api";
import { setAppLocale } from "@/i18n";
import type {
  Platform,
  PlatformCapabilities,
  PrDetail,
  PrLabel,
  PrMetadataUpdate,
  User,
} from "@/types";

vi.mock("@/api", () => ({
  clipboardWriteText: vi.fn(),
  listRepositoryLabels: vi.fn(),
  prParticipantSuggestions: vi.fn(),
}));

const author: User = { id: 1, login: "author", name: "Author", avatar_url: "" };
const reviewer: User = { id: 2, login: "reviewer", name: "Reviewer", avatar_url: "" };
const assignee: User = { id: 3, login: "assignee", name: "Assignee", avatar_url: "" };

const detail: PrDetail = {
  summary: {
    number: 42,
    title: "原始标题",
    author,
    state: "open",
    created_at: "2026-07-18T00:00:00Z",
    updated_at: "2026-07-18T01:00:00Z",
    labels: ["bug", "review"],
  },
  body: "原始描述",
  source_branch: "feature",
  target_branch: "main",
  mergeable: true,
  head_sha: "head-sha",
  base_sha: "base-sha",
  draft: false,
  reviewers: [reviewer],
  assignees: [assignee],
  milestone: { id: 7, number: 7, title: "0.6.0" },
  metadata_permissions: {
    can_edit_title_body: true,
    can_toggle_draft: true,
    can_manage_reviewers: true,
    can_manage_assignees: true,
    can_manage_labels: true,
    can_manage_milestone: true,
  },
};

function capabilities(overrides: Partial<PlatformCapabilities> = {}): PlatformCapabilities {
  return {
    platform: "github",
    review_events: ["comment", "approve", "request_changes"],
    merge_strategies: ["merge", "squash", "rebase"],
    supports_fork_context: true,
    supports_issue_auto_close: true,
    supports_compare_diff: true,
    supports_review_thread_resolution: true,
    supports_remote_file_viewed_state: true,
    supports_pr_title_body_edit: true,
    supports_pr_draft_toggle: true,
    supports_pr_reviewer_management: true,
    supports_pr_assignee_management: true,
    supports_pr_label_management: true,
    supports_pr_milestone_management: true,
    supports_pr_creation: true,
    supports_pr_description_image_upload: false,
    merge_queue_kind: "merge_queue",
    ...overrides,
  };
}

function mountPanel(
  props: Partial<{
    detail: PrDetail;
    platform: Platform;
    owner: string;
    repo: string;
    capabilities: PlatformCapabilities | null;
    saving: boolean;
    statusMessage: string;
    errorMessage: string;
  }> = {},
) {
  return mount(PrMetadataPanel, {
    props: {
      detail,
      platform: "github",
      owner: "owner",
      repo: "repo",
      capabilities: capabilities(),
      saving: false,
      ...props,
    },
  });
}

describe("PrMetadataPanel", () => {
  it("详情摘要使用 GitHub 标签背景色和可读文字色", () => {
    const wrapper = mountPanel({
      detail: {
        ...detail,
        summary: {
          ...detail.summary,
          labels: ["priority", "documentation"],
          label_colors: { priority: "fbca04", documentation: "0075ca" },
        },
      },
    });

    const tags = wrapper.findAll(".metadata-tag");
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

  beforeEach(() => {
    vi.clearAllMocks();
    setAppLocale("zh-CN");
    vi.mocked(clipboardWriteText).mockResolvedValue();
    vi.mocked(prParticipantSuggestions).mockResolvedValue([
      reviewer,
      assignee,
      { id: 4, login: "alice", name: "Alice", avatar_url: "" },
      { id: 5, login: "Bob", name: "Bob", avatar_url: "" },
      { id: 6, login: "carol", name: "Carol", avatar_url: "" },
    ]);
    vi.mocked(listRepositoryLabels).mockResolvedValue([
      { name: "bug", color: "d73a4a", description: "需要修复的问题" },
      { name: "feature", color: "a2eeef", description: "新功能" },
      { name: "documentation", color: null, description: null },
    ]);
  });

  it("展示元数据并按当前详情初始化编辑表单", async () => {
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain("评审者");
    expect(wrapper.text()).toContain("负责人");
    expect(wrapper.text()).toContain("reviewer");
    expect(wrapper.text()).toContain("assignee");
    expect(wrapper.text()).toContain("标签");
    expect(wrapper.text()).toContain("里程碑");
    expect(wrapper.text()).toContain("0.6.0");

    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-testid="metadata-title"]').element.value).toBe(
      "原始标题",
    );
    expect(wrapper.get<HTMLTextAreaElement>('[data-testid="metadata-body"]').element.value).toBe(
      "原始描述",
    );
    expect(
      wrapper.get<HTMLInputElement>('[data-testid="metadata-milestone"]').attributes("placeholder"),
    ).toBe("留空表示移除里程碑");
    expect(wrapper.get('[data-testid="metadata-reviewers"] .app-multi-select-value').text()).toBe(
      "reviewer",
    );
  });

  it("展示审核人员检视状态并请求在浏览器打开检视页面", async () => {
    const reviewUrl = "https://github.com/owner/repo/pull/42#pullrequestreview-7";
    const wrapper = mountPanel({
      detail: {
        ...detail,
        reviewer_statuses: [
          { user: reviewer, status: "approved", web_url: reviewUrl },
          {
            user: { id: 4, login: "changes", name: "Changes", avatar_url: "" },
            status: "changes_requested",
            web_url: null,
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("已批准");
    expect(wrapper.text()).toContain("请求修改");
    const link = wrapper.get<HTMLAnchorElement>('[data-testid="metadata-reviewer-link"]');
    expect(link.attributes("href")).toBe(reviewUrl);
    expect(link.attributes("target")).toBe("_blank");
    await link.trigger("click");
    expect(wrapper.emitted("open-external")).toEqual([[reviewUrl]]);
  });

  it("已挂载时切换英文，并保留远端中文内容", async () => {
    const wrapper = mountPanel();

    expect(wrapper.text()).toContain("参与者与分类");
    expect(wrapper.text()).toContain("原始描述");

    setAppLocale("en-US");
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("Participants and classification");
    expect(wrapper.get('[data-testid="edit-pr-metadata"]').text()).toContain("Edit metadata");
    expect(wrapper.text()).toContain("原始描述");
    expect(wrapper.text()).not.toContain("参与者与分类");
  });

  it("PR 正文代码块支持复制", async () => {
    const wrapper = mountPanel({
      detail: {
        ...detail,
        body: "```sh\nnpm run build\n```",
      },
    });

    const copyButton = wrapper.get<HTMLButtonElement>("[data-code-copy]");
    expect(copyButton.attributes("aria-label")).toBe("复制代码");
    await copyButton.trigger("click");
    await flushPromises();

    expect(clipboardWriteText).toHaveBeenCalledWith("npm run build\n");
    expect(copyButton.attributes("data-copy-state")).toBe("copied");
  });

  it("展示关联 Issue，并将同仓库 Issue 链接转为内部跳转事件", async () => {
    const wrapper = mountPanel({
      detail: {
        ...detail,
        body:
          "Closes #12, fixes #12\n\n" +
          "[同仓库 Issue](https://github.com/owner/repo/issues/13)\n\n" +
          "[外部文档](https://example.com/docs)",
        web_url: "https://github.com/owner/repo/pull/42",
      },
    });

    const issues = wrapper.findAll(".metadata-linked-issue");
    expect(issues.map((issue) => issue.text())).toEqual(["#12", "#13"]);

    await issues[0].trigger("click");
    expect(wrapper.emitted("open-issue")?.[0]).toEqual([12]);

    await wrapper.get("a[href='https://github.com/owner/repo/issues/13']").trigger("click");
    expect(wrapper.emitted("open-link")?.[0]).toEqual(["https://github.com/owner/repo/issues/13"]);

    await wrapper.get("a[href='https://example.com/docs']").trigger("click");
    expect(wrapper.emitted("open-link")?.[1]).toEqual(["https://example.com/docs"]);
  });

  it("完整渲染 PR 链接标题，并将 PR 链接转为应用内跳转事件", async () => {
    const title = "chore(saas): remove unused Flyway migration system #7100";
    const href = "https://github.com/Stirling-Tools/Stirling-PDF/pull/7100";
    const wrapper = mountPanel({
      detail: {
        ...detail,
        body: `since [**${title}**](${href})`,
        web_url: "https://github.com/owner/repo/pull/42",
      },
    });

    const link = wrapper.get(`a[href='${href}']`);
    expect(link.text()).toBe(title);
    expect(link.get("strong").text()).toBe(title);
    expect(wrapper.findAll(".metadata-linked-issue")).toHaveLength(0);

    await link.get("strong").trigger("click");
    expect(wrapper.emitted("open-link")?.[0]).toEqual([href]);
  });

  it("保留 GitHub 跳转域 Issue 链接并交给详情页处理", async () => {
    const prHref = "https://github.com/Stirling-Tools/Stirling-PDF/pull/7190";
    const issueHref = "https://redirect.github.com/pyasn1/pyasn1/issues/113";
    const wrapper = mountPanel({
      detail: {
        ...detail,
        body:
          `[Stirling-Tools/Stirling-PDF#7190](${prHref}) ` +
          `Pin PyPI publish action to immutable commit ([#113](${issueHref}))`,
        web_url: "https://github.com/Stirling-Tools/Stirling-PDF/pull/7191",
      },
    });

    expect(wrapper.get(`a[href='${prHref}']`).text()).toBe("Stirling-Tools/Stirling-PDF#7190");
    const issueLink = wrapper.get(`a[href='${issueHref}']`);
    expect(issueLink.text()).toBe("#113");
    await issueLink.trigger("click");
    expect(wrapper.emitted("open-link")?.[0]).toEqual([issueHref]);
  });

  it("将 PR 描述中的裸仓库编号渲染为可点击引用", async () => {
    const wrapper = mountPanel({
      detail: {
        ...detail,
        body: "The a11y scan (#7086) measures contrast",
        web_url: "https://github.com/owner/repo/pull/42",
      },
    });

    const reference = wrapper.get("a[href='/__mergebeacon__/reference/hash/7086']");
    expect(reference.text()).toBe("#7086");
    await reference.trigger("click");
    expect(wrapper.emitted("open-link")?.[0]).toEqual(["/__mergebeacon__/reference/hash/7086"]);
  });

  it.each([
    {
      name: "GitLab 自托管 nested subgroup MR",
      platform: "gitlab" as const,
      owner: "group/current",
      repo: "repo",
      currentUrl: "https://git.example.com/gitlab/group/current/repo/-/merge_requests/42",
      targetUrl: "https://git.example.com/gitlab/team/subgroup/project/-/merge_requests/77",
      target: { owner: "team/subgroup", repo: "project", number: 77 },
    },
    {
      name: "Gitee PR",
      platform: "gitee" as const,
      owner: "owner",
      repo: "repo",
      currentUrl: "https://gitee.com/owner/repo/pulls/42",
      targetUrl: "https://gitee.com/team/project/pulls/88",
      target: { owner: "team", repo: "project", number: 88 },
    },
  ])("识别$name并触发应用内跳转", async (example) => {
    const wrapper = mountPanel({
      platform: example.platform,
      owner: example.owner,
      repo: example.repo,
      detail: {
        ...detail,
        body: `[关联 PR](${example.targetUrl})`,
        web_url: example.currentUrl,
      },
    });

    await wrapper.get(`a[href='${example.targetUrl}']`).trigger("click");
    expect(wrapper.emitted("open-link")?.[0]).toEqual([example.targetUrl]);
  });

  it("编辑描述时支持 Markdown 预览并保存原始文本", async () => {
    const wrapper = mountPanel();
    const markdown = "# 变更说明\n\n- 第一项\n- 第二项\n\n`code`";

    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await wrapper.get('[data-testid="metadata-body"]').setValue(markdown);
    await wrapper
      .get('[role="tab"][aria-controls="metadata-description-preview"]')
      .trigger("click");

    expect(wrapper.get(".metadata-description-preview h1").text()).toBe("变更说明");
    expect(wrapper.findAll(".metadata-description-preview li")).toHaveLength(2);
    expect(wrapper.get(".metadata-description-preview code").text()).toBe("code");
    expect(wrapper.find('[data-testid="metadata-body"]').exists()).toBe(false);

    await wrapper.get('[role="tab"][aria-controls="metadata-description-editor"]').trigger("click");
    expect(wrapper.get<HTMLTextAreaElement>('[data-testid="metadata-body"]').element.value).toBe(
      markdown,
    );

    await wrapper.get("form").trigger("submit");
    const update = wrapper.emitted("save")?.[0]?.[0] as PrMetadataUpdate;
    expect(update.body).toBe(markdown);
  });

  it("编辑时可以分别搜索 Reviewers、Assignees 和 Labels", async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();

    for (const [testId, query, expected] of [
      ["metadata-reviewers", "alice", "alice"],
      ["metadata-assignees", "car", "carol"],
      ["metadata-labels", "feat", "feature"],
    ] as const) {
      await wrapper.get(`[data-testid="${testId}"] [role="combobox"]`).trigger("click");
      await wrapper.get(`[data-testid="${testId}"] input[type="search"]`).setValue(query);
      expect(
        wrapper.get(`[data-testid="${testId}"] .multi-select-option[data-value="${expected}"]`),
      ).toBeTruthy();
      await wrapper.get(`[data-testid="${testId}"] [role="combobox"]`).trigger("click");
    }
  });

  it("已挂载标签会使用仓库标签的颜色和描述", async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="metadata-labels"] [role="combobox"]').trigger("click");

    const bugOption = wrapper.get(
      '[data-testid="metadata-labels"] .multi-select-option[data-value="bug"]',
    );
    const swatch = bugOption.find(".multi-select-swatch");
    expect(swatch.attributes("style")).toBeUndefined();
    expect(swatch.classes().some((name) => name.startsWith("mb-static-label-color-"))).toBe(true);
    expect(bugOption.text()).toContain("需要修复的问题");
  });

  it("候选项加载失败后可以在编辑态就地重试", async () => {
    vi.mocked(prParticipantSuggestions)
      .mockRejectedValueOnce(new Error("成员加载失败"))
      .mockResolvedValueOnce([
        { id: 10, login: "retry-member", name: "Retry Member", avatar_url: "" },
      ]);

    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();

    expect(wrapper.get(".options-error").text()).toContain("成员加载失败");
    await wrapper.get('[data-testid="metadata-options-retry"]').trigger("click");
    await flushPromises();

    expect(wrapper.find(".options-error").exists()).toBe(false);
    expect(prParticipantSuggestions).toHaveBeenCalledTimes(2);
    await wrapper.get('[data-testid="metadata-reviewers"] [role="combobox"]').trigger("click");
    expect(wrapper.text()).toContain("retry-member");
  });

  it("仓库上下文变化后忽略旧候选项的迟到响应", async () => {
    let resolveOldParticipants: (value: User[]) => void = () => undefined;
    let resolveOldLabels: (value: PrLabel[]) => void = () => undefined;
    vi.mocked(prParticipantSuggestions)
      .mockReturnValueOnce(
        new Promise<User[]>((resolve) => {
          resolveOldParticipants = resolve;
        }),
      )
      .mockResolvedValueOnce([{ id: 8, login: "new-member", name: "New Member", avatar_url: "" }]);
    vi.mocked(listRepositoryLabels)
      .mockReturnValueOnce(
        new Promise<PrLabel[]>((resolve) => {
          resolveOldLabels = resolve;
        }),
      )
      .mockResolvedValueOnce([{ name: "new-label", color: null, description: null }]);

    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await wrapper.setProps({
      detail: {
        ...detail,
        summary: { ...detail.summary, number: 43, labels: [] },
        reviewers: [],
        assignees: [],
      },
      owner: "other",
    });
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();

    resolveOldParticipants([{ id: 9, login: "old-member", name: "Old Member", avatar_url: "" }]);
    resolveOldLabels([{ name: "old-label", color: null, description: null }]);
    await flushPromises();

    await wrapper.get('[data-testid="metadata-reviewers"] [role="combobox"]').trigger("click");
    expect(wrapper.text()).toContain("new-member");
    expect(wrapper.text()).not.toContain("old-member");
    await wrapper.get('[data-testid="metadata-labels"] [role="combobox"]').trigger("click");
    expect(wrapper.text()).toContain("new-label");
    expect(wrapper.text()).not.toContain("old-label");
  });

  it("解析并去重列表，同时携带 expected_updated_at", async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="metadata-title"]').setValue("  新标题  ");
    await wrapper.get('[data-testid="metadata-body"]').setValue("新描述");
    await wrapper.get('[data-testid="metadata-draft"]').setValue(true);
    await wrapper.get('[data-testid="metadata-reviewers"] [role="combobox"]').trigger("click");
    await wrapper
      .get('[data-testid="metadata-reviewers"] .multi-select-option[data-value="reviewer"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="metadata-reviewers"] .multi-select-option[data-value="alice"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="metadata-reviewers"] .multi-select-option[data-value="Bob"]')
      .trigger("click");
    await wrapper.get('[data-testid="metadata-assignees"] [role="combobox"]').trigger("click");
    await wrapper
      .get('[data-testid="metadata-assignees"] .multi-select-option[data-value="assignee"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="metadata-assignees"] .multi-select-option[data-value="carol"]')
      .trigger("click");
    await wrapper.get('[data-testid="metadata-labels"] [role="combobox"]').trigger("click");
    await wrapper
      .get('[data-testid="metadata-labels"] .multi-select-option[data-value="review"]')
      .trigger("click");
    await wrapper
      .get('[data-testid="metadata-labels"] .multi-select-option[data-value="feature"]')
      .trigger("click");
    await wrapper.get('[data-testid="metadata-milestone"]').setValue("  0.7.0  ");
    await wrapper.get("form").trigger("submit");

    const update = wrapper.emitted("save")?.[0]?.[0] as PrMetadataUpdate;
    expect(update).toEqual({
      title: "新标题",
      body: "新描述",
      draft: true,
      reviewers: ["alice", "Bob"],
      assignees: ["carol"],
      labels: ["bug", "feature"],
      milestone: "0.7.0",
      expected_updated_at: "2026-07-18T01:00:00Z",
    });
  });

  it("标题为空时阻止提交并展示校验错误", async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-testid="metadata-title"]').setValue("   ");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toContain("PR 标题不能为空");
  });

  it("标题最多允许 255 个 Unicode 字符", async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();
    const titleInput = wrapper.get<HTMLInputElement>('[data-testid="metadata-title"]');

    expect(titleInput.attributes("maxlength")).toBe("255");

    await titleInput.setValue("界".repeat(256));
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("save")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toContain("PR 标题不能超过 255 个字符");
  });

  it("按平台使用参与者名称：Gitee 显示审查者和测试者", async () => {
    const wrapper = mountPanel({
      capabilities: capabilities({
        platform: "gitee",
        supports_pr_draft_toggle: false,
        supports_pr_assignee_management: true,
      }),
    });
    expect(wrapper.text()).toContain("审查者");
    expect(wrapper.text()).toContain("测试者");
    expect(wrapper.text()).not.toContain("Reviewers");
    expect(wrapper.text()).not.toContain("Assignees");
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-testid="metadata-draft"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="metadata-assignees"]').exists()).toBe(true);
  });

  it("权限为 false 时禁用对应字段，保存状态禁用整个表单", async () => {
    const restricted = {
      ...detail,
      metadata_permissions: {
        ...detail.metadata_permissions,
        can_manage_labels: false,
      },
    };
    const wrapper = mountPanel({ detail: restricted });
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await wrapper.setProps({ saving: true });
    expect(wrapper.get('[data-testid="metadata-labels"] .app-multi-select').classes()).toContain(
      "disabled",
    );
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
  });

  it("权限未知时允许尝试编辑并提示由平台 API 最终校验", async () => {
    const unknownPermissions = {
      ...detail,
      metadata_permissions: {
        can_edit_title_body: null,
        can_toggle_draft: null,
        can_manage_reviewers: null,
        can_manage_assignees: null,
        can_manage_labels: null,
        can_manage_milestone: null,
      },
    };
    const wrapper = mountPanel({ detail: unknownPermissions });

    expect(wrapper.get('[data-testid="edit-pr-metadata"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    expect(wrapper.get(".permission-note").text()).toContain("平台 API");
    expect(wrapper.get('[data-testid="metadata-title"]').attributes("disabled")).toBeUndefined();
  });

  it("取消编辑恢复原始值", async () => {
    const wrapper = mountPanel();
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    await wrapper.get('[data-testid="metadata-title"]').setValue("临时标题");
    await wrapper.get('.metadata-form-actions button[type="button"]').trigger("click");
    await wrapper.get('[data-testid="edit-pr-metadata"]').trigger("click");
    expect(wrapper.get<HTMLInputElement>('[data-testid="metadata-title"]').element.value).toBe(
      "原始标题",
    );
  });
});
