import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IssueForm from "@/components/issue/IssueForm.vue";
import IssueNewPage from "@/pages/IssueNewPage.vue";
import { issueCreate, issueTemplates, listRepositoryLabels } from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";
import { useIssueStore } from "@/stores/useIssueStore";
import { useRepoStore } from "@/stores/useRepoStore";
import type { IssueTemplate, Platform, PrLabel } from "@/types";

vi.mock("@/api", () => ({
  issueCreate: vi.fn(),
  issueTemplates: vi.fn(),
  listRepositoryLabels: vi.fn(),
}));

const bugTemplate: IssueTemplate = {
  name: "Bug 报告",
  description: "提交可复现的缺陷",
  title: "[Bug] ",
  body: "## 复现步骤",
  labels: ["BUG", "missing"],
  source_path: ".github/ISSUE_TEMPLATE/bug.md",
};

async function mountPage(platform: Platform = "github") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/issue/new", name: "issue-new", component: IssueNewPage },
      {
        path: "/issue",
        name: "issue-list",
        component: { template: "<div>Issue 列表</div>" },
      },
    ],
  });
  await router.push("/issue/new");
  await router.isReady();

  const auth = useAuthStore();
  auth.setActivePlatform(platform);
  auth.platforms[platform].isLoggedIn = true;
  const repos = useRepoStore();
  repos.activeRepos[platform] = { owner: "team", repo: "repo" };

  const wrapper = mount(IssueNewPage, {
    global: {
      plugins: [pinia, router],
      stubs: {
        AppLayout: {
          template: '<div><slot name="header"/><slot/></div>',
        },
      },
    },
  });
  await flushPromises();
  return { wrapper, repos, router };
}

describe("IssueNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRepositoryLabels).mockResolvedValue([
      { name: "bug", color: "d73a4a", description: "缺陷" },
      { name: "frontend", color: null, description: null },
    ]);
    vi.mocked(issueTemplates).mockResolvedValue([bugTemplate]);
    vi.mocked(issueCreate).mockResolvedValue({
      number: 1,
      title: "",
      body: "",
      author: { id: 1, login: "dev", name: "Dev", avatar_url: "" },
      state: "open",
      labels: [],
      created_at: "2026-07-25T00:00:00Z",
      updated_at: "2026-07-25T00:00:00Z",
      metadata_permissions: {
        can_edit_title_body: null,
        can_change_state: null,
        can_manage_labels: null,
      },
    });
  });

  it("按当前平台和仓库并行拉取标签与模板", async () => {
    await mountPage();

    expect(listRepositoryLabels).toHaveBeenCalledWith("github", "team", "repo");
    expect(issueTemplates).toHaveBeenCalledWith("github", "team", "repo");
  });

  it("显式应用模板后填充标题、正文并匹配仓库中存在的标签", async () => {
    const { wrapper } = await mountPage();

    await wrapper.get('[aria-label="选择 Issue 创建模板"]').trigger("click");
    await wrapper
      .get('.dropdown-option[data-value=".github/ISSUE_TEMPLATE/bug.md"]')
      .trigger("click");
    await wrapper.get(".template-controls .btn").trigger("click");

    expect(wrapper.get<HTMLInputElement>("#issue-title").element.value).toBe("[Bug] ");
    expect(wrapper.get<HTMLTextAreaElement>("#issue-body").element.value).toBe("## 复现步骤");
    expect(wrapper.get('[aria-label="选择 Issue 标签"]').text()).toContain("bug");
    expect(wrapper.get('[aria-label="选择 Issue 标签"]').text()).not.toContain("missing");
  });

  it("模板未预设标题时保留用户已有标题", async () => {
    const bodyOnlyTemplate: IssueTemplate = {
      ...bugTemplate,
      name: "仅正文",
      title: "",
      body: "## 变更说明",
      source_path: ".github/ISSUE_TEMPLATE/body-only.md",
    };
    vi.mocked(issueTemplates).mockResolvedValue([bodyOnlyTemplate]);
    const { wrapper } = await mountPage();
    await wrapper.get("#issue-title").setValue("用户已有标题");
    await wrapper.get("#issue-body").setValue("用户已有正文");

    await wrapper.get('[aria-label="选择 Issue 创建模板"]').trigger("click");
    await wrapper
      .get('.dropdown-option[data-value=".github/ISSUE_TEMPLATE/body-only.md"]')
      .trigger("click");
    await wrapper.get(".template-controls .btn").trigger("click");

    expect(wrapper.get<HTMLInputElement>("#issue-title").element.value).toBe("用户已有标题");
    expect(wrapper.get<HTMLTextAreaElement>("#issue-body").element.value).toBe("## 变更说明");
  });

  it("标签晚于模板返回时在标签加载完成后应用模板预置标签", async () => {
    let resolveLabels!: (labels: PrLabel[]) => void;
    vi.mocked(listRepositoryLabels).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLabels = resolve;
        }),
    );
    const { wrapper } = await mountPage();

    await wrapper.get('[aria-label="选择 Issue 创建模板"]').trigger("click");
    await wrapper
      .get('.dropdown-option[data-value=".github/ISSUE_TEMPLATE/bug.md"]')
      .trigger("click");
    await wrapper.get(".template-controls .btn").trigger("click");

    expect(wrapper.get<HTMLInputElement>("#issue-title").element.value).toBe("[Bug] ");
    resolveLabels([
      { name: "bug", color: "d73a4a", description: "缺陷" },
      { name: "frontend", color: null, description: null },
    ]);
    await flushPromises();

    expect(wrapper.get('[aria-label="选择 Issue 标签"]').text()).toContain("bug");
    expect(wrapper.get('[aria-label="选择 Issue 标签"]').text()).not.toContain("missing");
  });

  it("重新加载标签期间保留已选标签的展示", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('[aria-label="选择 Issue 创建模板"]').trigger("click");
    await wrapper
      .get('.dropdown-option[data-value=".github/ISSUE_TEMPLATE/bug.md"]')
      .trigger("click");
    await wrapper.get(".template-controls .btn").trigger("click");

    let resolveLabels!: (labels: PrLabel[]) => void;
    vi.mocked(listRepositoryLabels).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLabels = resolve;
        }),
    );
    wrapper.getComponent(IssueForm).vm.$emit("reload-labels");
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[aria-label="选择 Issue 标签"]').text()).toContain("bug");
    resolveLabels([{ name: "bug", color: "d73a4a", description: "缺陷" }]);
    await flushPromises();
  });

  it("重新加载模板期间保留当前模板的名称和描述", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('[aria-label="选择 Issue 创建模板"]').trigger("click");
    await wrapper
      .get('.dropdown-option[data-value=".github/ISSUE_TEMPLATE/bug.md"]')
      .trigger("click");

    let resolveTemplates!: (templates: IssueTemplate[]) => void;
    vi.mocked(issueTemplates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTemplates = resolve;
        }),
    );
    wrapper.getComponent(IssueForm).vm.$emit("reload-templates");
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[aria-label="选择 Issue 创建模板"]').text()).toContain("Bug 报告");
    expect(wrapper.text()).toContain("提交可复现的缺陷");
    resolveTemplates([bugTemplate]);
    await flushPromises();
  });

  it("模板重载后清空已不存在的模板选择", async () => {
    const { wrapper } = await mountPage();
    await wrapper.get('[aria-label="选择 Issue 创建模板"]').trigger("click");
    await wrapper
      .get('.dropdown-option[data-value=".github/ISSUE_TEMPLATE/bug.md"]')
      .trigger("click");

    vi.mocked(issueTemplates).mockResolvedValueOnce([]);
    wrapper.getComponent(IssueForm).vm.$emit("reload-templates");
    await flushPromises();

    expect(wrapper.getComponent(IssueForm).props("selectedTemplatePath")).toBe("");
    expect(wrapper.get<HTMLButtonElement>(".template-controls .btn").element.disabled).toBe(true);
  });

  it("切换仓库后忽略旧仓库迟到的标签响应", async () => {
    let resolveOld!: (labels: PrLabel[]) => void;
    vi.mocked(listRepositoryLabels).mockImplementation((_platform, owner) => {
      if (owner === "old") {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve([{ name: "new-label", color: null, description: null }]);
    });

    const { wrapper, repos } = await mountPage();
    repos.activeRepos.github = { owner: "old", repo: "repo" };
    await flushPromises();
    repos.activeRepos.github = { owner: "new", repo: "repo" };
    await flushPromises();
    resolveOld([{ name: "old-label", color: null, description: null }]);
    await flushPromises();

    await wrapper.get('[aria-label="选择 Issue 标签"]').trigger("click");
    expect(wrapper.find('.multi-select-option[data-value="new-label"]').exists()).toBe(true);
    expect(wrapper.find('.multi-select-option[data-value="old-label"]').exists()).toBe(false);
  });

  it("模板加载失败不阻止手动创建 Issue", async () => {
    vi.mocked(issueTemplates).mockRejectedValue(new Error("network"));
    const { wrapper } = await mountPage();

    expect(wrapper.text()).toContain("仍可手动填写 Issue");
    await wrapper.get("#issue-title").setValue("手动填写标题");
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(false);
  });

  it("创建成功后暂存新 Issue 并返回列表", async () => {
    const { wrapper, router } = await mountPage();
    await wrapper.get("#issue-title").setValue("刚创建的 Issue");

    await wrapper.get("form").trigger("submit");
    await flushPromises();

    expect(router.currentRoute.value.path).toBe("/issue");
    expect(useIssueStore().pendingCreatedIssue?.issue.number).toBe(1);
  });
});
