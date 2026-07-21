import { describe, expect, it } from "vitest";
import type { StandardPatchFile } from "@/types";
import {
  extractDiffHunk,
  findPatchLocation,
  findStandardPatch,
  inferDiffSide,
  patchContainsLine,
} from "@/utils/diffHunk";

const patch: StandardPatchFile = {
  filename: "src/new.ts",
  old_path: "src/old.ts",
  new_path: "src/new.ts",
  status: "renamed",
  additions: 1,
  deletions: 15,
  content_kind: "text",
  patch: "",
  message: null,
  hunks: [
    {
      header: "@@ -1,15 +1,0 @@",
      old_start: 1,
      old_count: 15,
      new_start: 1,
      new_count: 0,
      section_header: null,
      lines: Array.from({ length: 15 }, (_, index) => ({
        kind: "deletion" as const,
        content: `old${index + 1}`,
        old_line: index + 1,
        new_line: null,
      })),
    },
    {
      header: "@@ -20,0 +10 @@",
      old_start: 20,
      old_count: 0,
      new_start: 10,
      new_count: 1,
      section_header: null,
      lines: [
        { kind: "addition", content: "newcode", old_line: null, new_line: 10 },
        {
          kind: "no_newline",
          content: "No newline at end of file",
          old_line: null,
          new_line: null,
        },
      ],
    },
  ],
};

describe("diffHunk", () => {
  it("指定 side 时只提取对应侧，缺少 side 时优先 right", () => {
    const right = extractDiffHunk(patch, 10, "right");
    const left = extractDiffHunk(patch, 10, "left");

    expect(right).toContain("@@ -20,0 +10 @@");
    expect(right).toContain("+newcode");
    expect(right).toContain("\\ No newline at end of file");
    expect(right).not.toContain("-old10");
    expect(left).toContain("@@ -1,15 +1,0 @@");
    expect(left).toContain("-old10");
    expect(extractDiffHunk(patch, 10)).toBe(right);
    expect(extractDiffHunk(patch, 99)).toBeUndefined();
  });

  it("统一处理重命名前后路径、行存在性和定位侧", () => {
    expect(findStandardPatch([patch], "src/old.ts")).toBe(patch);
    expect(findStandardPatch([patch], "src/new.ts")).toBe(patch);
    expect(inferDiffSide(patch, "src/old.ts")).toBe("left");
    expect(inferDiffSide(patch, "src/new.ts")).toBe("right");
    expect(patchContainsLine(patch, 10, "right")).toBe(true);
    expect(patchContainsLine(patch, 10, "left")).toBe(true);
    expect(findPatchLocation(patch, 10, "src/old.ts")).toEqual({ side: "left", line: 10 });
    expect(findPatchLocation(patch, 10, "src/new.ts")).toEqual({ side: "right", line: 10 });
  });

  it("显式 side 不回退到另一侧", () => {
    expect(findPatchLocation(patch, 15, "src/new.ts", "right")).toBeNull();
    expect(findPatchLocation(patch, 15, "src/new.ts", "left")).toEqual({
      side: "left",
      line: 15,
    });
  });
});
