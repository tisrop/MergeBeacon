import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrListPage from "@/pages/PrListPage.vue";
import type { Platform, PrSummary } from "@/types";
import { setAppLocale } from "@/i18n";

const item: PrSummary = {
  number: 1,
  title: "历史变更",
  author: { id: 1, login: "dev", name: "Dev", avatar_url: "" },
  state: "closed",
  created_at: "",
  updated_at: "",
  labels: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn() },
  route: { query: {} as Record<string, string> },
  authStore: {
    activePlatform: "github" as Platform,
    isLoggedIn: false,
  },
  repoStore: {
    activeRepo: { owner: "team", repo: "repo" },
    activeFullName: "team/repo",
    forkContext: null,
    hasUpstreamInfo: false,
    viewingUpstream: false,
    switchForkView: vi.fn(),
  },
  prStore: {
    list: [] as PrSummary[],
    listTruncated: true,
    listTotalCount: 1234,
    loading: false,
    error: null,
    totalPages: 1,
    perPage: 20,
    pageSizes: [10, 20, 50, 100],
    filters: { state: "closed", page: 1 },
    listQuery: {
      title: "",
      author: "",
      label: "",
      reviews: null,
      assignee: "",
      sort: "updated_desc",
    },
    hasListQuery: false,
    stateCounts: { open: 1, closed: 1, merged: 0, all: 2 },
    fetchStateCounts: vi.fn(),
    fetchPrList: vi.fn(),
    clearContext: vi.fn(() => false),
    cancelListStatusSupplement: vi.fn(),
    prevPage: vi.fn(),
    nextPage: vi.fn(),
    setPage: vi.fn(),
    setFilter: vi.fn(),
    setPerPage: vi.fn(),
    setListQuery: vi.fn(),
    clearListQuery: vi.fn(),
  },
  listFilterOptions: {
    participants: { value: [] },
    labels: { value: [] },
    loading: { value: false },
    error: { value: null },
    load: vi.fn(),
    clear: vi.fn(),
  },
}));

const reactivePrStore = reactive(mocks.prStore);
const reactiveRepoStore = reactive(mocks.repoStore);

enableAutoUnmount(afterEach);

vi.mock("vue-router", () => ({
  useRouter: () => mocks.router,
  useRoute: () => mocks.route,
}));
vi.mock("@/stores/useAuthStore", () => ({ useAuthStore: () => mocks.authStore }));
vi.mock("@/stores/useRepoStore", () => ({ useRepoStore: () => reactiveRepoStore }));
vi.mock("@/stores/usePrStore", () => ({ usePrStore: () => reactivePrStore }));
vi.mock("@/components/pr/usePrListFilterOptions", () => ({
  usePrListFilterOptions: () => mocks.listFilterOptions,
  userFilterOptions: () => [],
  labelFilterOptions: () => [],
}));

function mountPage(platform: Platform) {
  mocks.authStore.activePlatform = platform;
  mocks.prStore.list = [item];
  mocks.prStore.setPage.mockImplementation((page: number) => {
    reactivePrStore.filters.page = page;
  });
  mocks.prStore.setFilter.mockImplementation((state) => {
    reactivePrStore.filters.state = state;
    reactivePrStore.filters.page = 1;
  });
  mocks.prStore.prevPage.mockImplementation(() => {
    if (reactivePrStore.filters.page > 1) reactivePrStore.filters.page--;
  });
  mocks.prStore.nextPage.mockImplementation(() => {
    if (reactivePrStore.filters.page < reactivePrStore.totalPages) {
      reactivePrStore.filters.page++;
    }
  });
  mocks.prStore.setPerPage.mockImplementation((perPage: number) => {
    reactivePrStore.perPage = perPage;
    reactivePrStore.filters.page = 1;
  });
  return mount(PrListPage, {
    global: {
      stubs: {
        AppLayout: { template: "<main><slot name='header' /><slot /></main>" },
        PrCard: { template: "<article />" },
        PrSearchBar: { template: "<form class='pr-search-stub' />" },
        AppSelect: {
          template:
            "<button class=\"page-size-select\" @click=\"$emit('update:modelValue', '50')\" />",
        },
        RouterLink: { template: "<a><slot /></a>" },
      },
    },
  });
}

describe("PrListPage 截断提示", () => {
  afterEach(() => {
    setAppLocale("zh-CN");
    mocks.authStore.activePlatform = "github";
    mocks.authStore.isLoggedIn = false;
    mocks.repoStore.activeRepo = { owner: "team", repo: "repo" };
    mocks.repoStore.activeFullName = "team/repo";
    mocks.prStore.list = [];
    mocks.prStore.listTruncated = true;
    mocks.prStore.listTotalCount = 1234;
    mocks.prStore.totalPages = 1;
    mocks.prStore.filters.state = "closed";
    mocks.prStore.filters.page = 1;
    mocks.prStore.perPage = 20;
    mocks.prStore.listQuery = {
      title: "",
      author: "",
      label: "",
      reviews: null,
      assignee: "",
      sort: "updated_desc",
    };
    mocks.prStore.fetchPrList.mockReset();
    mocks.prStore.fetchStateCounts.mockReset();
    mocks.prStore.clearContext.mockReset();
    mocks.prStore.clearContext.mockReturnValue(false);
    mocks.prStore.cancelListStatusSupplement.mockReset();
    mocks.prStore.setPage.mockReset();
    mocks.prStore.setFilter.mockReset();
    mocks.prStore.prevPage.mockReset();
    mocks.prStore.nextPage.mockReset();
    mocks.prStore.setPerPage.mockReset();
    mocks.listFilterOptions.load.mockReset();
    mocks.listFilterOptions.clear.mockReset();
  });

  it.each([
    ["github", "拉取请求（PR）"],
    ["gitlab", "合并请求（MR）"],
    ["gitee", "拉取请求（PR）"],
  ] as const)("中文界面为 %s 显示平台对应的请求标题", (platform, expected) => {
    setAppLocale("zh-CN");
    const wrapper = mountPage(platform);

    expect(wrapper.get("h2").text()).toBe(expected);
  });

  it.each(["github", "gitlab", "gitee"] as const)("%s 加载平台对应的筛选选项", async (platform) => {
    mocks.authStore.isLoggedIn = true;
    const wrapper = mountPage(platform);
    await flushPromises();

    expect(wrapper.find(".pr-search-stub").exists()).toBe(true);
    expect(mocks.listFilterOptions.load).toHaveBeenCalledWith(platform, "team", "repo");
    expect(mocks.listFilterOptions.clear).not.toHaveBeenCalled();
  });

  it("GitHub 提示真实总数和可浏览上限", () => {
    const wrapper = mountPage("github");

    expect(wrapper.find(".result-count").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("1 条结果");
    expect(wrapper.get(".search-limit-notice").text()).toBe(
      "共 1,234 条已关闭或已合并 Pull Request，仅可浏览前 1,000 条。",
    );
  });

  it.each([
    ["gitlab", "GitLab 当前仅返回部分 Merge Request，更多历史记录暂不可分页查看。"],
    ["gitee", "Gitee 当前仅返回部分 Pull Request，更多历史记录暂不可分页查看。"],
  ] as const)("%s 使用平台对应的中性截断提示", (platform, expected) => {
    const wrapper = mountPage(platform);

    expect(wrapper.get(".search-limit-notice").text()).toBe(expected);
  });

  it("点击跳转后更新页码并直接请求目标页，当前页和越界页不可提交", async () => {
    mocks.authStore.isLoggedIn = true;
    mocks.prStore.totalPages = 5;
    const wrapper = mountPage("github");
    await flushPromises();
    mocks.prStore.fetchPrList.mockClear();
    mocks.prStore.fetchStateCounts.mockClear();
    const input = wrapper.get<HTMLInputElement>('[aria-label="跳转页码"]');
    const submit = wrapper.get<HTMLButtonElement>(".page-jump button");

    expect(input.element.value).toBe("1");
    expect(submit.element.disabled).toBe(true);

    await input.setValue("4");
    expect(submit.element.disabled).toBe(false);
    await submit.trigger("click");
    await flushPromises();
    expect(mocks.prStore.setPage).toHaveBeenCalledWith(4);
    expect(mocks.prStore.filters.page).toBe(4);
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledWith("github", "team", "repo");
    expect(mocks.prStore.fetchStateCounts).not.toHaveBeenCalled();

    await input.setValue("6");
    expect(submit.element.disabled).toBe(true);
    await submit.trigger("click");
    expect(mocks.prStore.setPage).toHaveBeenCalledTimes(1);
  });

  it("再次点击当前筛选项重置页码后刷新第一页列表", async () => {
    mocks.authStore.isLoggedIn = true;
    mocks.prStore.filters.state = "open";
    mocks.prStore.filters.page = 5;
    mocks.prStore.totalPages = 5;
    const wrapper = mountPage("github");
    await flushPromises();
    mocks.prStore.fetchPrList.mockClear();
    mocks.prStore.fetchStateCounts.mockClear();

    const openFilter = wrapper.get('[aria-pressed="true"]');
    await openFilter.trigger("click");
    await flushPromises();

    expect(mocks.prStore.setFilter).toHaveBeenCalledWith("open");
    expect(mocks.prStore.filters.page).toBe(1);
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledWith("github", "team", "repo");
    expect(mocks.prStore.fetchStateCounts).not.toHaveBeenCalled();
  });

  it("查询对象变化后刷新列表且不刷新状态计数", async () => {
    mocks.authStore.isLoggedIn = true;
    mountPage("github");
    await flushPromises();
    mocks.prStore.fetchPrList.mockClear();
    mocks.prStore.fetchStateCounts.mockClear();

    reactivePrStore.listQuery = {
      ...reactivePrStore.listQuery,
      label: "bug",
    };
    await flushPromises();

    expect(mocks.prStore.fetchPrList).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledWith("github", "team", "repo");
    expect(mocks.prStore.fetchStateCounts).not.toHaveBeenCalled();
  });

  it("优先完成 PR 列表请求后再刷新状态计数", async () => {
    mocks.authStore.isLoggedIn = true;
    const listRequest = deferred<void>();
    mocks.prStore.fetchPrList.mockReturnValueOnce(listRequest.promise);

    mountPage("github");
    await Promise.resolve();

    expect(mocks.prStore.fetchPrList).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchStateCounts).not.toHaveBeenCalled();

    listRequest.resolve();
    await flushPromises();

    expect(mocks.prStore.fetchStateCounts).toHaveBeenCalledOnce();
  });

  it("切换状态筛选时优先请求 PR 列表，完成后刷新状态计数", async () => {
    mocks.authStore.isLoggedIn = true;
    mocks.prStore.filters.state = "open";
    const wrapper = mountPage("github");
    await flushPromises();
    mocks.prStore.fetchPrList.mockClear();
    mocks.prStore.fetchStateCounts.mockClear();
    const listRequest = deferred<void>();
    mocks.prStore.fetchPrList.mockReturnValueOnce(listRequest.promise);

    await wrapper.findAll(".filters button")[1].trigger("click");
    await Promise.resolve();

    expect(mocks.prStore.setFilter).toHaveBeenCalledWith("closed");
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchStateCounts).not.toHaveBeenCalled();

    listRequest.resolve();
    await flushPromises();

    expect(mocks.prStore.fetchStateCounts).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchStateCounts).toHaveBeenCalledWith("github", "team", "repo");
  });

  it("切换仓库后不再刷新迟到列表所属仓库的状态计数", async () => {
    mocks.authStore.isLoggedIn = true;
    const oldListRequest = deferred<void>();
    mocks.prStore.fetchPrList
      .mockReturnValueOnce(oldListRequest.promise)
      .mockResolvedValueOnce(undefined);
    mountPage("github");
    await Promise.resolve();

    reactiveRepoStore.activeRepo = { owner: "other", repo: "repo" };
    await flushPromises();

    expect(mocks.prStore.fetchStateCounts).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchStateCounts).toHaveBeenCalledWith("github", "other", "repo");

    oldListRequest.resolve();
    await flushPromises();

    expect(mocks.prStore.fetchStateCounts).toHaveBeenCalledOnce();
  });

  it("进入不同仓库时恢复开放状态且只请求一次列表", async () => {
    mocks.authStore.isLoggedIn = true;
    mountPage("github");
    await flushPromises();
    mocks.prStore.fetchPrList.mockClear();
    mocks.prStore.fetchStateCounts.mockClear();
    mocks.prStore.filters.state = "closed";
    mocks.prStore.filters.page = 3;
    mocks.prStore.clearContext.mockImplementationOnce(() => {
      reactivePrStore.filters.state = "open";
      reactivePrStore.filters.page = 1;
      return true;
    });

    reactiveRepoStore.activeRepo = { owner: "other", repo: "repo" };
    await flushPromises();

    expect(mocks.prStore.clearContext).toHaveBeenCalledOnce();
    expect(mocks.prStore.filters).toEqual({ state: "open", page: 1 });
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledWith("github", "other", "repo");
  });

  it("离开列表页时取消在途的 GitHub 状态补充", () => {
    const wrapper = mountPage("github");

    wrapper.unmount();

    expect(mocks.prStore.cancelListStatusSupplement).toHaveBeenCalledOnce();
  });

  it.each([
    ["上一页", ".pagination > button:first-child", 2, "prevPage"],
    ["下一页", ".pagination > button:nth-of-type(2)", 4, "nextPage"],
  ] as const)("点击%s后只请求目标页列表", async (_label, selector, expectedPage, method) => {
    mocks.authStore.isLoggedIn = true;
    mocks.prStore.filters.page = 3;
    mocks.prStore.totalPages = 5;
    const wrapper = mountPage("github");
    await flushPromises();
    mocks.prStore.fetchPrList.mockClear();
    mocks.prStore.fetchStateCounts.mockClear();

    await wrapper.get(selector).trigger("click");
    await flushPromises();

    expect(mocks.prStore[method]).toHaveBeenCalledOnce();
    expect(mocks.prStore.filters.page).toBe(expectedPage);
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledWith("github", "team", "repo");
    expect(mocks.prStore.fetchStateCounts).not.toHaveBeenCalled();
  });

  it.each([
    ["当前页不是第一页", 3, "3"],
    ["第一页存在未提交的跳页输入", 1, "4"],
  ])("切换每页条数时重置页码和跳页输入：%s", async (_scenario, page, inputValue) => {
    mocks.authStore.isLoggedIn = true;
    mocks.prStore.filters.page = page;
    mocks.prStore.totalPages = 5;
    const wrapper = mountPage("github");
    await flushPromises();
    mocks.prStore.fetchPrList.mockClear();
    mocks.prStore.fetchStateCounts.mockClear();
    const input = wrapper.get<HTMLInputElement>('[aria-label="跳转页码"]');
    await input.setValue(inputValue);

    await wrapper.get(".page-size-select").trigger("click");
    await flushPromises();

    expect(mocks.prStore.setPerPage).toHaveBeenCalledWith(50);
    expect(mocks.prStore.perPage).toBe(50);
    expect(mocks.prStore.filters.page).toBe(1);
    expect(input.element.value).toBe("1");
    expect(mocks.prStore.fetchPrList).toHaveBeenCalledOnce();
    expect(mocks.prStore.fetchStateCounts).not.toHaveBeenCalled();
  });
});
