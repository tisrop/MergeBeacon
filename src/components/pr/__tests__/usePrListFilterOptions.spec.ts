import { describe, expect, it, vi } from "vitest";
import { listRepositoryLabels, prParticipantSuggestions } from "@/api";
import {
  labelFilterOptions,
  userFilterOptions,
  usePrListFilterOptions,
} from "@/components/pr/usePrListFilterOptions";
import type { PrLabel, User } from "@/types";

vi.mock("@/api", () => ({
  listRepositoryLabels: vi.fn(),
  prParticipantSuggestions: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("usePrListFilterOptions", () => {
  it("去重、排序并保留当前选中的用户和标签", () => {
    const users: User[] = [
      { id: 2, login: "zoe", name: "Zoe", avatar_url: "" },
      { id: 1, login: "Alice", name: "", avatar_url: "" },
      { id: 3, login: "alice", name: "duplicate", avatar_url: "" },
    ];
    const labels: PrLabel[] = [
      { name: "bug", color: null, description: null },
      { name: "BUG", color: null, description: null },
    ];

    expect(userFilterOptions(users, "external")).toEqual([
      { value: "Alice", label: "Alice" },
      { value: "external", label: "external" },
      { value: "zoe", label: "zoe (Zoe)" },
    ]);
    expect(labelFilterOptions(labels, "feature")).toEqual([
      { value: "bug", label: "bug" },
      { value: "feature", label: "feature" },
    ]);
  });

  it("仓库切换后忽略旧请求的迟到响应", async () => {
    const oldUsers = deferred<User[]>();
    const oldLabels = deferred<PrLabel[]>();
    vi.mocked(prParticipantSuggestions)
      .mockReturnValueOnce(oldUsers.promise)
      .mockResolvedValueOnce([{ id: 2, login: "new-user", name: "", avatar_url: "" }]);
    vi.mocked(listRepositoryLabels)
      .mockReturnValueOnce(oldLabels.promise)
      .mockResolvedValueOnce([{ name: "new-label", color: null, description: null }]);
    const options = usePrListFilterOptions();

    const oldRequest = options.load("github", "old", "repo");
    const newRequest = options.load("github", "new", "repo");
    await newRequest;
    oldUsers.resolve([{ id: 1, login: "old-user", name: "", avatar_url: "" }]);
    oldLabels.resolve([{ name: "old-label", color: null, description: null }]);
    await oldRequest;

    expect(options.participants.value.map((user) => user.login)).toEqual(["new-user"]);
    expect(options.labels.value.map((label) => label.name)).toEqual(["new-label"]);
    expect(options.loading.value).toBe(false);
  });

  it("部分选项失败时保留成功数据并允许强制重试", async () => {
    vi.mocked(prParticipantSuggestions)
      .mockRejectedValueOnce(new Error("participants unavailable"))
      .mockResolvedValueOnce([{ id: 1, login: "dev", name: "", avatar_url: "" }]);
    vi.mocked(listRepositoryLabels).mockResolvedValue([
      { name: "bug", color: null, description: null },
    ]);
    const options = usePrListFilterOptions();

    await options.load("github", "team", "repo");
    expect(options.labels.value.map((label) => label.name)).toEqual(["bug"]);
    expect(options.error.value).toBe("部分筛选选项加载失败");

    await options.load("github", "team", "repo", true);
    expect(options.participants.value.map((user) => user.login)).toEqual(["dev"]);
    expect(options.error.value).toBeNull();
  });
});
