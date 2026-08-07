import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertIpcContract,
  BACKEND_ONLY_COMMANDS,
  checkIpcContract,
  parseBackendCommands,
  parseFrontendCommands,
} from "../ipc-contract.mjs";

const backendFixture = `
  .invoke_handler(tauri::generate_handler![
    auth::auth_login,
    support::support_info,
    review::review_submit,
  ])
`;

const frontendFixture = `
  const ERROR_LOG_RECORD_COMMAND = "error_log_record";
  export function login() { return invoke("auth_login"); }
  export function review() { return invoke<Result>("review_submit", {}); }
  void tauriInvoke(ERROR_LOG_RECORD_COMMAND, {});
`;

describe("IPC 命令契约检查", () => {
  it("解析 Tauri generate_handler 中的命令", () => {
    expect(parseBackendCommands(backendFixture)).toEqual([
      "auth_login",
      "support_info",
      "review_submit",
    ]);
  });

  it("解析前端封装与直接 Tauri 常量调用", () => {
    expect(parseFrontendCommands(frontendFixture)).toEqual([
      "auth_login",
      "review_submit",
      "error_log_record",
    ]);
  });

  it("前端调用未注册命令时失败", () => {
    expect(() => assertIpcContract(["auth_login"], ["auth_login", "missing"], new Set())).toThrow(
      "前端调用但后端未注册：missing",
    );
  });

  it("后端命令缺少前端封装时失败", () => {
    expect(() => assertIpcContract(["auth_login", "orphan"], ["auth_login"], new Set())).toThrow(
      "后端已注册但前端无封装：orphan",
    );
  });

  it("允许显式后端专用命令并拒绝失效白名单", () => {
    expect(
      assertIpcContract(["auth_login", "internal"], ["auth_login"], new Set(["internal"])),
    ).toEqual({
      backendCount: 2,
      frontendCount: 1,
      backendOnlyCount: 1,
    });
    expect(() => assertIpcContract(["auth_login"], ["auth_login"], new Set(["removed"]))).toThrow(
      "后端专用命令白名单已失效：removed",
    );
  });

  it("拒绝重复注册或重复前端命令声明", () => {
    expect(() =>
      assertIpcContract(["auth_login", "auth_login"], ["auth_login"], new Set()),
    ).toThrow("后端重复注册：auth_login");
    expect(() =>
      assertIpcContract(["auth_login"], ["auth_login", "auth_login"], new Set()),
    ).toThrow("前端重复声明命令：auth_login");
  });

  it("当前项目命令集合与后端专用白名单保持一致", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const [backendSource, frontendSource] = await Promise.all([
      readFile(resolve(root, "src-tauri/src/lib.rs"), "utf8"),
      readFile(resolve(root, "src/api/index.ts"), "utf8"),
    ]);

    expect([...BACKEND_ONLY_COMMANDS].sort()).toEqual(["auth_has_any_token", "support_info"]);
    expect(
      assertIpcContract(parseBackendCommands(backendSource), parseFrontendCommands(frontendSource)),
    ).toEqual(await checkIpcContract(root));
  });
});
