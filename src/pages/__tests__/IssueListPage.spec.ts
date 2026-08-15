import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import IssueListPage from "@/pages/IssueListPage.vue";
import { setAppLocale } from "@/i18n";

const mocks = vi.hoisted(() => ({
  issueList: vi.fn(),
  issueStore: {
    mergePendingCreatedIssue: vi.fn(
      (_platform: string, _owner: string, _repo: string, issues: unknown[]) => issues,
    ),
  },
  repoStore: {
    activeRepo: { owner: "team", repo: "repo" },
    activeFullName: "team/repo",
  },
  authStore: {
    activePlatform: "github",
  },
}));

vi.mock("@/api", () => ({ issueList: mocks.issueList }));
vi.mock("@/stores/useAuthStore", () => ({ useAuthStore: () => mocks.authStore }));
vi.mock("@/stores/useIssueStore", () => ({ useIssueStore: () => mocks.issueStore }));
vi.mock("@/stores/useRepoStore", () => ({ useRepoStore: () => mocks.repoStore }));

function mountPage() {
  return mount(IssueListPage, {
    global: {
      stubs: {
        AppLayout: { template: "<main><slot name='header' /><slot /></main>" },
        IssueCard: { template: "<article />" },
        RouterLink: { template: "<a><slot /></a>" },
      },
    },
  });
}

describe("IssueListPage", () => {
  afterEach(() => {
    setAppLocale("zh-CN");
    mocks.issueList.mockReset();
  });

  it("按界面语言显示议题标题", async () => {
    mocks.issueList.mockResolvedValue({ items: [], page: 1, total_pages: 1 });
    setAppLocale("zh-CN");
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("议题");

    setAppLocale("en-US");
    await wrapper.vm.$nextTick();
    expect(wrapper.get("h2").text()).toBe("Issues");
  });

  it("列表加载失败时展示错误与重试，成功后恢复列表", async () => {
    mocks.issueList.mockRejectedValueOnce(new Error("network down"));
    mocks.issueList.mockResolvedValueOnce({
      items: [
        {
          number: 7,
          title: "修复构建",
          state: "open",
          author: { login: "dev" },
          created_at: "2026-08-01T00:00:00Z",
          updated_at: "2026-08-02T00:00:00Z",
          labels: [],
        },
      ],
      page: 1,
      total_pages: 1,
    });
    const wrapper = mountPage();
    await flushPromises();

    expect(wrapper.find('[data-testid="issue-list-error"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="issue-list-error"]').text()).toContain("Issue 列表加载失败");
    expect(wrapper.get('[data-testid="issue-list-error"]').text()).toContain("network down");

    await wrapper.get('[data-testid="issue-list-error"] button').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-testid="issue-list-error"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("network down");
    expect(mocks.issueList).toHaveBeenCalledTimes(2);
  });
});
