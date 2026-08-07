import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();

// 400 KiB 是有意设置的紧预算：默认 `/pr` 首屏保持同步加载以避免冷启动额外等待，
// 其余低频页面和重型功能应优先拆分为异步 chunk。不要仅为新增功能直接提高预算；
// 若必要的共享依赖确实无法拆分，应记录实测启动影响并在评审中说明调整依据。
export const ENTRY_JS_BUDGET_BYTES = 400 * 1024;
export const EAGER_ENTRY_MODULES = ["src/pages/PrListPage.vue"];
export const EAGER_ENTRY_ROUTER_IMPORTS = [
  { identifier: "PrListPage", source: "@/pages/PrListPage.vue" },
];

export function findEntryJavaScript(manifest) {
  const entries = Object.values(manifest).filter(
    (entry) =>
      entry?.isEntry === true && typeof entry.file === "string" && entry.file.endsWith(".js"),
  );

  if (entries.length !== 1) {
    throw new Error(`构建清单应包含唯一 JavaScript 入口，实际找到 ${entries.length} 个`);
  }

  return entries[0].file;
}

export function assertEntryModulesEager(manifest, modules = EAGER_ENTRY_MODULES) {
  const lazyModules = modules.filter((module) => manifest[module]?.isDynamicEntry === true);
  if (lazyModules.length > 0) {
    throw new Error(`首屏模块不得懒加载：${lazyModules.join(", ")}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function assertEntryRouterImports(routerSource, imports = EAGER_ENTRY_ROUTER_IMPORTS) {
  const missingImports = imports.filter(({ identifier, source }) => {
    const pattern = new RegExp(
      `\\bimport\\s+${escapeRegExp(identifier)}\\s+from\\s+["']${escapeRegExp(source)}["']\\s*;`,
    );
    return !pattern.test(routerSource);
  });
  if (missingImports.length > 0) {
    const expected = missingImports
      .map(({ identifier, source }) => `import ${identifier} from "${source}";`)
      .join(", ");
    throw new Error(`首屏模块必须由路由静态导入：${expected}`);
  }
}

export function assertEntryBundleSize(file, sizeBytes, budgetBytes = ENTRY_JS_BUDGET_BYTES) {
  if (sizeBytes > budgetBytes) {
    const actualKiB = (sizeBytes / 1024).toFixed(2);
    const budgetKiB = (budgetBytes / 1024).toFixed(2);
    throw new Error(`入口包体积超限：${file}=${actualKiB} KiB，预算=${budgetKiB} KiB`);
  }
}

export async function checkBundleSize(root = projectRoot, budgetBytes = ENTRY_JS_BUDGET_BYTES) {
  const manifestPath = resolve(root, "dist/.vite/manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 Vite 构建清单 ${manifestPath}：${error.message}`);
  }

  assertEntryModulesEager(manifest);

  const routerPath = resolve(root, "src/router/index.ts");
  let routerSource;
  try {
    routerSource = await readFile(routerPath, "utf8");
  } catch (error) {
    throw new Error(`无法读取路由配置 ${routerPath}：${error.message}`);
  }
  assertEntryRouterImports(routerSource);

  const entryFile = findEntryJavaScript(manifest);
  const entryPath = resolve(root, "dist", entryFile);
  let sizeBytes;
  try {
    sizeBytes = (await stat(entryPath)).size;
  } catch (error) {
    throw new Error(`无法读取入口包 ${entryPath}：${error.message}`);
  }

  assertEntryBundleSize(entryFile, sizeBytes, budgetBytes);
  return { entryFile, sizeBytes, budgetBytes };
}

async function main() {
  const result = await checkBundleSize();
  process.stdout.write(
    `入口包体积检查通过：${result.entryFile}=${(result.sizeBytes / 1024).toFixed(2)} KiB，预算=${(
      result.budgetBytes / 1024
    ).toFixed(2)} KiB\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
