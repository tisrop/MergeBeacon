import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repoList } from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";
import { useRepoStore } from "@/stores/useRepoStore";
import type { RepoSummary } from "@/types";

vi.mock("@/api", () => ({
  repoList: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  authCheck: vi.fn(),
}));

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

function repo(id: number, fullName: string): RepoSummary {
  const [owner, name] = fullName.split("/");
  return {
    id,
    name,
    full_name: fullName,
    owner,
    owner_type: "user",
    owner_display_name: owner,
    description: "",
    private: false,
    fork: false,
    parent_full_name: null,
    parent_owner: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("useRepoStore", () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it("增量追加并去重，且分页按平台隔离", async () => {
    vi.mocked(repoList)
      .mockResolvedValueOnce({ items: [repo(1, "a/one")], page: 1, total_pages: 2, total_count: 2 })
      .mockResolvedValueOnce({
        items: [repo(1, "a/one"), repo(2, "a/two")],
        page: 2,
        total_pages: 2,
        total_count: 2,
      })
      .mockResolvedValueOnce({
        items: [repo(3, "b/three")],
        page: 1,
        total_pages: 3,
        total_count: 3,
      });
    const auth = useAuthStore();
    const store = useRepoStore();

    await store.fetchRepos("github");
    await store.loadMore("github");
    expect(store.reposCache.github.map((item) => item.full_name)).toEqual(["a/one", "a/two"]);

    auth.setActivePlatform("gitlab");
    await store.fetchRepos("gitlab");
    expect(store.repos.map((item) => item.full_name)).toEqual(["b/three"]);
    expect(store.pages.github).toBe(2);
    expect(store.pages.gitlab).toBe(1);
  });

  it("加载更多失败时保留数据并可重试同一页", async () => {
    vi.mocked(repoList)
      .mockResolvedValueOnce({ items: [repo(1, "a/one")], page: 1, total_pages: 2, total_count: 2 })
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        items: [repo(2, "a/two")],
        page: 2,
        total_pages: 2,
        total_count: 2,
      });
    const store = useRepoStore();
    await store.fetchRepos("github");
    await store.loadMore("github");
    expect(store.reposCache.github).toHaveLength(1);
    expect(store.errors.github).toContain("network");
    await store.retry("github");
    expect(store.reposCache.github).toHaveLength(2);
  });

  it("刷新第一页会替换旧列表而不是追加", async () => {
    vi.mocked(repoList)
      .mockResolvedValueOnce({
        items: [repo(1, "a/old")],
        page: 1,
        total_pages: 1,
        total_count: 1,
      })
      .mockResolvedValueOnce({
        items: [repo(2, "a/new")],
        page: 1,
        total_pages: 1,
        total_count: 1,
      });
    const store = useRepoStore();

    await store.refreshRepos("github");
    await store.refreshRepos("github");

    expect(store.reposCache.github.map((item) => item.full_name)).toEqual(["a/new"]);
  });

  it("缓存为空时复用同平台正在进行的仓库请求", async () => {
    const request = deferred<{
      items: RepoSummary[];
      page: number;
      total_pages: number;
      total_count: number;
    }>();
    vi.mocked(repoList).mockReturnValueOnce(request.promise);
    const store = useRepoStore();

    const sidebarLoad = store.fetchRepos("github");
    const createPageLoad = store.ensureRepos("github");

    expect(repoList).toHaveBeenCalledTimes(1);
    request.resolve({
      items: [repo(1, "a/one")],
      page: 1,
      total_pages: 3,
      total_count: 3,
    });
    await Promise.all([sidebarLoad, createPageLoad]);

    expect(store.reposCache.github.map((item) => item.full_name)).toEqual(["a/one"]);
    expect(store.pages.github).toBe(1);
    expect(store.totalPagesByPlatform.github).toBe(3);
  });

  it("平台切换后旧平台的迟到成功结果不会覆盖当前列表", async () => {
    const githubRequest = deferred<{
      items: RepoSummary[];
      page: number;
      total_pages: number;
      total_count: number;
    }>();
    vi.mocked(repoList)
      .mockReturnValueOnce(githubRequest.promise)
      .mockResolvedValueOnce({
        items: [repo(2, "gitlab/current")],
        page: 1,
        total_pages: 1,
        total_count: 1,
      });
    const auth = useAuthStore();
    const store = useRepoStore();

    const oldRequest = store.fetchRepos("github");
    auth.setActivePlatform("gitlab");
    await store.fetchRepos("gitlab");
    githubRequest.resolve({
      items: [repo(1, "github/late")],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
    await oldRequest;

    expect(store.repos.map((item) => item.full_name)).toEqual(["gitlab/current"]);
    expect(store.error).toBeNull();
  });

  it("平台切换后旧平台的迟到错误不会显示在当前平台", async () => {
    const githubRequest = deferred<never>();
    vi.mocked(repoList)
      .mockReturnValueOnce(githubRequest.promise)
      .mockResolvedValueOnce({
        items: [repo(2, "gitlab/current")],
        page: 1,
        total_pages: 1,
        total_count: 1,
      });
    const auth = useAuthStore();
    const store = useRepoStore();

    const oldRequest = store.fetchRepos("github");
    auth.setActivePlatform("gitlab");
    await store.fetchRepos("gitlab");
    githubRequest.reject(new Error("github late error"));
    await oldRequest;

    expect(store.repos.map((item) => item.full_name)).toEqual(["gitlab/current"]);
    expect(store.error).toBeNull();
    expect(store.errors.github).toContain("github late error");
  });

  it("迟到旧请求不会清空新请求的 loadingMore", async () => {
    const firstPage = deferred<{
      items: RepoSummary[];
      page: number;
      total_pages: number;
      total_count: number;
    }>();
    const secondPage = deferred<{
      items: RepoSummary[];
      page: number;
      total_pages: number;
      total_count: number;
    }>();
    vi.mocked(repoList)
      .mockReturnValueOnce(firstPage.promise)
      .mockReturnValueOnce(secondPage.promise);
    const store = useRepoStore();

    const staleRequest = store.fetchRepos("github", 1);
    const currentRequest = store.fetchRepos("github", 2);
    expect(store.loadingMoreByPlatform.github).toBe(true);

    // 旧请求迟到完成，不得清掉新请求的加载更多状态。
    firstPage.resolve({
      items: [repo(1, "a/one")],
      page: 1,
      total_pages: 1,
      total_count: 1,
    });
    await staleRequest;
    expect(store.loadingMoreByPlatform.github).toBe(true);

    secondPage.resolve({
      items: [repo(2, "a/two")],
      page: 2,
      total_pages: 2,
      total_count: 2,
    });
    await currentRequest;
    expect(store.loadingMoreByPlatform.github).toBe(false);
    expect(store.reposCache.github.map((item) => item.full_name)).toEqual(["a/two"]);
  });

  it("显式平台写入仓库选择时不会污染当前平台", () => {
    const auth = useAuthStore();
    const store = useRepoStore();
    auth.setActivePlatform("github");

    store.setActiveRepo("gitee-owner", "gitee-repo", "gitee");
    store.setForkContext(
      {
        upstreamFullName: "upstream/repo",
        upstreamOwner: "upstream",
        forkOwner: "gitee-owner",
        forkRepo: "gitee-repo",
      },
      "gitee",
    );

    expect(store.activeRepos.github).toBeNull();
    expect(store.activeRepos.gitee).toEqual({ owner: "gitee-owner", repo: "gitee-repo" });
    expect(store.forkContexts.github).toBeNull();
    expect(store.forkContexts.gitee?.forkOwner).toBe("gitee-owner");
  });

  it("按平台持久化星标仓库并支持取消", () => {
    const store = useRepoStore();

    store.toggleRepoStar("team/project", "github");

    expect(store.isRepoStarred("team/project", "github")).toBe(true);
    expect(store.isRepoStarred("team/project", "gitlab")).toBe(false);
    expect(JSON.parse(storage.get("mergebeacon:starred-repos:v1") ?? "{}")).toEqual({
      github: ["team/project"],
      gitlab: [],
      gitee: [],
    });

    setActivePinia(createPinia());
    const restoredStore = useRepoStore();
    expect(restoredStore.isRepoStarred("team/project", "github")).toBe(true);

    restoredStore.toggleRepoStar("team/project", "github");
    expect(restoredStore.isRepoStarred("team/project", "github")).toBe(false);
  });

  it("忽略损坏或无效的星标持久化数据", () => {
    storage.set(
      "mergebeacon:starred-repos:v1",
      JSON.stringify({ github: ["valid/repo", "invalid", 42], gitlab: "wrong-shape" }),
    );

    const store = useRepoStore();

    expect(store.starredReposByPlatform.github).toEqual(["valid/repo"]);
    expect(store.starredReposByPlatform.gitlab).toEqual([]);
    expect(store.starredReposByPlatform.gitee).toEqual([]);
  });
});
