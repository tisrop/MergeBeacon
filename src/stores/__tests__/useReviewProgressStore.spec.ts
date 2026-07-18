import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewProgressStore } from "@/stores/useReviewProgressStore";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

const context = {
  platform: "github" as const,
  owner: "octocat",
  repo: "hello-world",
  prNumber: 42,
  headSha: "head-1",
};

describe("useReviewProgressStore", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
  });

  it("按 PR 和 head SHA 隔离文件已查看状态", () => {
    const store = useReviewProgressStore();
    store.setFileViewed(context, "src/main.ts", true);

    expect(store.isFileViewed(context, "src/main.ts")).toBe(true);
    expect(store.isFileViewed({ ...context, headSha: "head-2" }, "src/main.ts")).toBe(false);
    expect(storage.get("mergebeacon:review-progress:github:octocat:hello-world:42:head-1")).toBe(
      '["src/main.ts"]',
    );
  });

  it("清理已经不在当前 Diff 中的文件", () => {
    const store = useReviewProgressStore();
    store.setFileViewed(context, "src/main.ts", true);
    store.setFileViewed(context, "src/removed.ts", true);

    store.pruneFiles(context, ["src/main.ts"]);

    expect([...store.viewedFiles(context)]).toEqual(["src/main.ts"]);
  });

  it("使用远端结果替换本地缓存", () => {
    const store = useReviewProgressStore();
    store.setFileViewed(context, "src/local.ts", true);

    store.replaceViewedFiles(context, ["src/remote.ts"]);

    expect([...store.viewedFiles(context)]).toEqual(["src/remote.ts"]);
    expect(storage.get("mergebeacon:review-progress:github:octocat:hello-world:42:head-1")).toBe(
      '["src/remote.ts"]',
    );
  });

  it("本地存储不可用时仍保留会话内状态", () => {
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("storage disabled");
    });
    const store = useReviewProgressStore();

    store.setFileViewed(context, "src/main.ts", true);

    expect(store.isFileViewed(context, "src/main.ts")).toBe(true);
  });
});
