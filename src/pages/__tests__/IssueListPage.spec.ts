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
});
