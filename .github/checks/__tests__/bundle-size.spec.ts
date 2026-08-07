import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertEntryBundleSize,
  assertEntryModulesEager,
  assertEntryRouterImports,
  checkBundleSize,
  findEntryJavaScript,
} from "../bundle-size.mjs";

async function createBuildFixture(entrySize: number) {
  const root = await mkdtemp(join(tmpdir(), "mergebeacon-bundle-size-"));
  await mkdir(join(root, "dist/.vite"), { recursive: true });
  await mkdir(join(root, "dist/assets"), { recursive: true });
  await mkdir(join(root, "src/router"), { recursive: true });
  await writeFile(
    join(root, "dist/.vite/manifest.json"),
    JSON.stringify({
      "index.html": {
        file: "assets/index-test.js",
        isEntry: true,
      },
    }),
  );
  await writeFile(join(root, "dist/assets/index-test.js"), Buffer.alloc(entrySize));
  await writeFile(
    join(root, "src/router/index.ts"),
    'import PrListPage from "@/pages/PrListPage.vue";\n',
  );
  return root;
}

describe("入口包体积检查", () => {
  it("从 Vite manifest 中定位唯一 JavaScript 入口", () => {
    expect(
      findEntryJavaScript({
        "src/lazy.ts": { file: "assets/lazy.js", isDynamicEntry: true },
        "index.html": { file: "assets/index.js", isEntry: true },
      }),
    ).toBe("assets/index.js");
  });

  it("入口缺失或不唯一时明确失败", () => {
    expect(() => findEntryJavaScript({})).toThrow("实际找到 0 个");
    expect(() =>
      findEntryJavaScript({
        first: { file: "assets/first.js", isEntry: true },
        second: { file: "assets/second.js", isEntry: true },
      }),
    ).toThrow("实际找到 2 个");
  });

  it("阻止默认 PR 列表退化为懒加载路由", () => {
    expect(() =>
      assertEntryModulesEager({
        "src/pages/PrListPage.vue": {
          file: "assets/PrListPage.js",
          isDynamicEntry: true,
        },
      }),
    ).toThrow("首屏模块不得懒加载：src/pages/PrListPage.vue");
    expect(() => assertEntryModulesEager({ "index.html": { isEntry: true } })).not.toThrow();
  });

  it("要求默认 PR 列表在路由中保持静态导入", () => {
    expect(() =>
      assertEntryRouterImports('import PrListPage from "@/pages/PrListPage.vue";'),
    ).not.toThrow();
    expect(() =>
      assertEntryRouterImports('const PrListPage = () => import("@/pages/PrListPage.vue");'),
    ).toThrow('首屏模块必须由路由静态导入：import PrListPage from "@/pages/PrListPage.vue";');
    expect(() =>
      assertEntryRouterImports('import PrListPage from "@/pages/PullRequestListPage.vue";'),
    ).toThrow('首屏模块必须由路由静态导入：import PrListPage from "@/pages/PrListPage.vue";');
  });

  it("入口包不超过预算时通过", () => {
    expect(() => assertEntryBundleSize("assets/index.js", 399 * 1024, 400 * 1024)).not.toThrow();
  });

  it("入口包超过预算时报告文件、实际值和预算", () => {
    expect(() => assertEntryBundleSize("assets/index.js", 401 * 1024, 400 * 1024)).toThrow(
      "入口包体积超限：assets/index.js=401.00 KiB，预算=400.00 KiB",
    );
  });

  it("读取构建产物并返回入口体积", async () => {
    const root = await createBuildFixture(128);

    await expect(checkBundleSize(root, 256)).resolves.toEqual({
      entryFile: "assets/index-test.js",
      sizeBytes: 128,
      budgetBytes: 256,
    });
  });

  it("路由缺少静态首屏导入时给出可操作错误", async () => {
    const root = await createBuildFixture(128);
    await writeFile(join(root, "src/router/index.ts"), "");

    await expect(checkBundleSize(root)).rejects.toThrow("首屏模块必须由路由静态导入");
  });

  it("构建清单不存在时给出可操作错误", async () => {
    const root = await mkdtemp(join(tmpdir(), "mergebeacon-bundle-size-missing-"));

    await expect(checkBundleSize(root)).rejects.toThrow("无法读取 Vite 构建清单");
  });
});
