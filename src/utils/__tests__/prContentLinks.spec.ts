import { describe, expect, it } from "vitest";
import { resolvePrContentLink } from "@/utils/prContentLinks";

const githubContext = {
  platform: "github" as const,
  owner: "Stirling-Tools",
  repo: "Stirling-PDF",
  webUrl: "https://github.com/Stirling-Tools/Stirling-PDF/pull/7191",
};

describe("resolvePrContentLink", () => {
  it("将 GitHub PR 链接解析为应用内目标", () => {
    expect(
      resolvePrContentLink(
        "https://github.com/Stirling-Tools/Stirling-PDF/pull/7190",
        githubContext,
      ),
    ).toEqual({
      kind: "pr",
      target: { owner: "Stirling-Tools", repo: "Stirling-PDF", number: 7190 },
    });
  });

  it("将 GitHub 官方跳转域的 Issue 链接解析为应用内目标", () => {
    expect(
      resolvePrContentLink("https://redirect.github.com/pyasn1/pyasn1/issues/113", githubContext),
    ).toEqual({
      kind: "issue",
      target: { owner: "pyasn1", repo: "pyasn1", number: 113 },
    });
  });

  it("不信任名称相似的第三方域名", () => {
    const url = "https://redirect.github.com.evil.example/pyasn1/pyasn1/issues/113";
    expect(resolvePrContentLink(url, githubContext)).toEqual({ kind: "external", url });
  });
});
