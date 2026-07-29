import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useIssueStore } from "@/stores/useIssueStore";
import type { Issue } from "@/types";

const createdIssue: Issue = {
  number: 13,
  title: "刚创建的 Issue",
  body: "",
  author: { id: 1, login: "dev", name: "Dev", avatar_url: "" },
  state: "open",
  labels: ["bug"],
  created_at: "2026-07-29T00:00:00Z",
  updated_at: "2026-07-29T00:00:00Z",
  metadata_permissions: {
    can_edit_title_body: true,
    can_change_state: true,
    can_manage_labels: true,
  },
};

describe("useIssueStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("远端列表未包含刚创建的 Issue 时将其合入列表", () => {
    const store = useIssueStore();
    store.rememberCreatedIssue("github", "team", "repo", createdIssue);

    const result = store.mergePendingCreatedIssue("github", "team", "repo", []);

    expect(result).toEqual([expect.objectContaining({ number: 13, title: "刚创建的 Issue" })]);
    expect(store.pendingCreatedIssue?.issue.number).toBe(13);
  });

  it("远端列表确认新 Issue 后清除待同步记录且不重复展示", () => {
    const store = useIssueStore();
    store.rememberCreatedIssue("github", "team", "repo", createdIssue);
    const remoteIssue = store.mergePendingCreatedIssue("github", "team", "repo", [])[0];

    const result = store.mergePendingCreatedIssue("github", "team", "repo", [remoteIssue]);

    expect(result).toEqual([remoteIssue]);
    expect(store.pendingCreatedIssue).toBeNull();
  });

  it("不把其他仓库刚创建的 Issue 合入当前列表", () => {
    const store = useIssueStore();
    store.rememberCreatedIssue("github", "team", "other", createdIssue);

    const result = store.mergePendingCreatedIssue("github", "team", "repo", []);

    expect(result).toEqual([]);
    expect(store.pendingCreatedIssue?.repo).toBe("other");
  });
});
