import { describe, expect, it } from "vitest";
import type { PrCommitSummary } from "@/types";
import { normalizeCommitRange, resolveCommitRangeRevisions } from "@/utils/commitRange";

function commit(sha: string, parents: string[] = []): PrCommitSummary {
  return {
    sha,
    title: `提交 ${sha}`,
    author_name: "Alice",
    authored_at: "2026-07-19T10:00:00Z",
    parent_shas: parents,
  };
}

const commits = [commit("c1", ["base0"]), commit("c2", ["c1"]), commit("c3", ["c2"])];

describe("normalizeCommitRange", () => {
  it("把倒序选择规整为有序闭区间", () => {
    expect(normalizeCommitRange(commits, { startIndex: 2, endIndex: 0 })).toEqual({
      startIndex: 0,
      endIndex: 2,
    });
  });

  it("把越界下标夹取到列表范围内", () => {
    expect(normalizeCommitRange(commits, { startIndex: -5, endIndex: 99 })).toEqual({
      startIndex: 0,
      endIndex: 2,
    });
  });

  it("提交列表为空时返回 null", () => {
    expect(normalizeCommitRange([], { startIndex: 0, endIndex: 0 })).toBeNull();
  });
});

describe("resolveCommitRangeRevisions", () => {
  it("单个提交使用第一父提交作为 base", () => {
    expect(resolveCommitRangeRevisions(commits, { startIndex: 1, endIndex: 1 }, "prBase")).toEqual({
      baseSha: "c1",
      headSha: "c2",
    });
  });

  it("多个提交使用区间首个提交的父提交和末尾提交", () => {
    expect(resolveCommitRangeRevisions(commits, { startIndex: 0, endIndex: 2 }, "prBase")).toEqual({
      baseSha: "base0",
      headSha: "c3",
    });
  });

  it("缺少父提交时退回到列表中的前一个提交", () => {
    const withoutParents = [commit("c1"), commit("c2"), commit("c3")];
    expect(
      resolveCommitRangeRevisions(withoutParents, { startIndex: 1, endIndex: 2 }, "prBase"),
    ).toEqual({ baseSha: "c1", headSha: "c3" });
  });

  it("首个提交且缺少父提交时退回到 PR 的 base 提交", () => {
    const withoutParents = [commit("c1"), commit("c2")];
    expect(
      resolveCommitRangeRevisions(withoutParents, { startIndex: 0, endIndex: 1 }, "prBase"),
    ).toEqual({ baseSha: "prBase", headSha: "c2" });
  });

  it("既没有父提交也没有 PR base 时返回 null，不猜测对比基准", () => {
    const withoutParents = [commit("c1"), commit("c2")];
    expect(
      resolveCommitRangeRevisions(withoutParents, { startIndex: 0, endIndex: 1 }, null),
    ).toBeNull();
  });

  it("base 与 head 相同时返回 null", () => {
    const selfParent = [commit("c1", ["c1"])];
    expect(
      resolveCommitRangeRevisions(selfParent, { startIndex: 0, endIndex: 0 }, null),
    ).toBeNull();
  });
});
