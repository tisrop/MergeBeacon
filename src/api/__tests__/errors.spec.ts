import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, normalizeApiError, prDetail } from "@/api";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: vi.fn(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

describe("IPC errors", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("preserves structured command error metadata", async () => {
    invokeMock.mockRejectedValue({
      code: "rate_limited",
      message: "代码平台请求过于频繁，请稍后重试",
      retryable: true,
      http_status: 429,
    });

    const promise = prDetail("github", "owner", "repo", 42);

    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      code: "rate_limited",
      message: "代码平台请求过于频繁，请稍后重试",
      retryable: true,
      httpStatus: 429,
    });
  });

  it("keeps legacy string errors compatible with existing UI", async () => {
    invokeMock.mockRejectedValue("仓库不存在");

    try {
      await prDetail("github", "owner", "repo", 42);
      expect.unreachable("expected command to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(String(error)).toBe("仓库不存在");
      expect((error as ApiError).code).toBe("unknown");
    }
  });

  it("parses structured JSON strings during mixed-version upgrades", () => {
    const error = normalizeApiError(
      JSON.stringify({
        code: "authentication",
        message: "登录凭据已失效，请重新登录",
        retryable: false,
      }),
    );

    expect(error).toMatchObject({
      code: "authentication",
      message: "登录凭据已失效，请重新登录",
      retryable: false,
    });
  });

  it("rejects malformed payloads without exposing object serialization", () => {
    const error = normalizeApiError({ code: "rate_limited", message: "raw" });

    expect(error.code).toBe("unknown");
    expect(error.message).toBe("操作失败");
  });
});
