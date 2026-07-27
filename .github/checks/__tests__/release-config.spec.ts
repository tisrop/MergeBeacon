import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Release notes 分类配置", () => {
  it("按 Bug Fixes、Enhancements 和 Other Changes 分类", async () => {
    const config = await readFile(".github/release.yml", "utf8");
    const categoryTitles = [...config.matchAll(/^\s*-\s+title:\s*["']?([^"'\n]+?)["']?\s*$/gm)].map(
      ([, title]) => title,
    );

    expect(categoryTitles).toHaveLength(3);
    expect(categoryTitles).toEqual(
      expect.arrayContaining(["Bug Fixes", "Enhancements", "Other Changes"]),
    );
    expect(config).toMatch(/^\s*-\s+bug\s*$/m);
    expect(config).toMatch(/^\s*-\s+enhancement\s*$/m);
    expect(config).toMatch(/^\s*-\s+["']?\*["']?\s*$/m);
  });

  it("生成发布说明时显式使用分类配置", async () => {
    const workflow = await readFile(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain('-f configuration_file_path=".github/release.yml"');
  });
});
