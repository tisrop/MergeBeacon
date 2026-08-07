import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();

export const BACKEND_ONLY_COMMANDS = new Set(["auth_has_any_token", "support_info"]);

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

export function parseBackendCommands(source) {
  const handler = source.match(
    /\.invoke_handler\s*\(\s*tauri::generate_handler!\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!handler) {
    throw new Error("无法定位 Tauri generate_handler 命令注册表");
  }

  return [...handler[1].matchAll(/(?:^|\n)\s*(?:[a-z_][a-z0-9_]*::)+([a-z_][a-z0-9_]*)\s*,/g)].map(
    (match) => match[1],
  );
}

export function parseFrontendCommands(source) {
  const commands = [
    ...source.matchAll(/\b(?:invoke|tauriInvoke)(?:<[^;()]*>)?\(\s*["']([a-z_][a-z0-9_]*)["']/g),
  ].map((match) => match[1]);

  const commandConstants = new Map(
    [...source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*["']([a-z_][a-z0-9_]*)["']/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  for (const match of source.matchAll(
    /\b(?:invoke|tauriInvoke)(?:<[^;()]*>)?\(\s*([A-Z][A-Z0-9_]*)\b/g,
  )) {
    const command = commandConstants.get(match[1]);
    if (command) commands.push(command);
  }

  return commands;
}

export function assertIpcContract(
  backendCommands,
  frontendCommands,
  backendOnlyCommands = BACKEND_ONLY_COMMANDS,
) {
  const duplicateBackend = duplicateValues(backendCommands);
  const duplicateFrontend = duplicateValues(frontendCommands);
  const backend = new Set(backendCommands);
  const frontend = new Set(frontendCommands);
  const frontendMissingRegistration = sortedUnique(frontendCommands).filter(
    (command) => !backend.has(command),
  );
  const backendMissingWrapper = sortedUnique(backendCommands).filter(
    (command) => !frontend.has(command) && !backendOnlyCommands.has(command),
  );
  const staleAllowlist = [...backendOnlyCommands]
    .filter((command) => !backend.has(command) || frontend.has(command))
    .sort();

  const problems = [];
  if (duplicateBackend.length > 0) {
    problems.push(`后端重复注册：${duplicateBackend.join("、")}`);
  }
  if (duplicateFrontend.length > 0) {
    problems.push(`前端重复声明命令：${duplicateFrontend.join("、")}`);
  }
  if (frontendMissingRegistration.length > 0) {
    problems.push(`前端调用但后端未注册：${frontendMissingRegistration.join("、")}`);
  }
  if (backendMissingWrapper.length > 0) {
    problems.push(`后端已注册但前端无封装：${backendMissingWrapper.join("、")}`);
  }
  if (staleAllowlist.length > 0) {
    problems.push(`后端专用命令白名单已失效：${staleAllowlist.join("、")}`);
  }
  if (problems.length > 0) {
    throw new Error(`IPC 命令契约检查失败：\n- ${problems.join("\n- ")}`);
  }

  return {
    backendCount: backend.size,
    frontendCount: frontend.size,
    backendOnlyCount: backendOnlyCommands.size,
  };
}

export async function checkIpcContract(root = projectRoot) {
  const [backendSource, frontendSource] = await Promise.all([
    readFile(resolve(root, "src-tauri/src/lib.rs"), "utf8"),
    readFile(resolve(root, "src/api/index.ts"), "utf8"),
  ]);
  return assertIpcContract(
    parseBackendCommands(backendSource),
    parseFrontendCommands(frontendSource),
  );
}

async function main() {
  const result = await checkIpcContract();
  process.stdout.write(
    `IPC 命令契约检查通过：后端 ${result.backendCount} 个，前端 ${result.frontendCount} 个，后端专用 ${result.backendOnlyCount} 个\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
