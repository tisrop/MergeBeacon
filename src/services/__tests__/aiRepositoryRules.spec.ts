import { beforeEach, describe, expect, it, vi } from "vitest";
import { prFileContent } from "@/api";
import { ApiError } from "@/api/errors";
import {
  aiRepositoryRuleDiscoveryPaths,
  discoverAiRepositoryRules,
} from "@/services/aiRepositoryRules";

vi.mock("@/api", () => ({
  prFileContent: vi.fn(),
}));

describe("aiRepositoryRules", () => {
  beforeEach(() => vi.clearAllMocks());

  it("按优先级查找第一个完整的文本规则文件", async () => {
    vi.mocked(prFileContent).mockRejectedValueOnce(new Error("404")).mockResolvedValueOnce({
      path: ".mergebeacon/rules.md",
      revision: "head-1",
      content: "  检查异步生命周期  ",
      truncated: false,
      binary: false,
    });

    await expect(
      discoverAiRepositoryRules({
        platform: "github",
        owner: "team",
        repo: "repo",
        revision: "head-1",
      }),
    ).resolves.toEqual({ path: ".mergebeacon/rules.md", content: "检查异步生命周期" });
    expect(prFileContent).toHaveBeenCalledTimes(2);
    expect(prFileContent).toHaveBeenNthCalledWith(
      2,
      "github",
      "team",
      "repo",
      ".mergebeacon/rules.md",
      "head-1",
    );
  });

  it("跳过空、二进制和截断文件，不把不完整内容作为规则", async () => {
    vi.mocked(prFileContent)
      .mockResolvedValueOnce({
        path: aiRepositoryRuleDiscoveryPaths[0],
        revision: "head-1",
        content: "   ",
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: aiRepositoryRuleDiscoveryPaths[1],
        revision: "head-1",
        content: "binary-looking content",
        truncated: false,
        binary: true,
      })
      .mockResolvedValueOnce({
        path: aiRepositoryRuleDiscoveryPaths[2],
        revision: "head-1",
        content: "partial rules",
        truncated: true,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: aiRepositoryRuleDiscoveryPaths[3],
        revision: "head-1",
        content: "有效规则",
        truncated: false,
        binary: false,
      });

    await expect(
      discoverAiRepositoryRules({
        platform: "gitlab",
        owner: "team",
        repo: "repo",
        revision: "head-1",
      }),
    ).resolves.toEqual({ path: "CLAUDE.md", content: "有效规则" });
    expect(prFileContent).toHaveBeenCalledTimes(4);
  });

  it.each(["Not Found", "Resource Not Found", "文件不存在"])(
    "识别平台返回的缺失文件错误：%s",
    async (message) => {
      vi.mocked(prFileContent).mockRejectedValue(new Error(message));

      await expect(
        discoverAiRepositoryRules({
          platform: "gitee",
          owner: "team",
          repo: "repo",
          revision: "head-1",
        }),
      ).resolves.toBeNull();
      expect(prFileContent).toHaveBeenCalledTimes(aiRepositoryRuleDiscoveryPaths.length);
    },
  );

  it("不把带 403 状态的 Not Found 文案误判为缺失文件", async () => {
    vi.mocked(prFileContent).mockRejectedValue(new Error("403 Forbidden: Resource Not Found"));

    await expect(
      discoverAiRepositoryRules({
        platform: "gitlab",
        owner: "team",
        repo: "repo",
        revision: "head-1",
      }),
    ).rejects.toThrow("403 Forbidden");
    expect(prFileContent).toHaveBeenCalledTimes(1);
  });

  it("优先使用结构化错误码区分文件缺失和权限失败", async () => {
    vi.mocked(prFileContent)
      .mockRejectedValueOnce(
        new ApiError({
          code: "not_found",
          message: "请求的远端资源不存在或当前 Token 无权访问",
          retryable: false,
          http_status: 404,
        }),
      )
      .mockRejectedValueOnce(
        new ApiError({
          code: "permission_denied",
          message: "当前 Token 没有执行此操作的权限",
          retryable: false,
          http_status: 403,
        }),
      );

    await expect(
      discoverAiRepositoryRules({
        platform: "gitlab",
        owner: "team",
        repo: "repo",
        revision: "head-1",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(prFileContent).toHaveBeenCalledTimes(2);
  });

  it("跳过超过上下文上限的规则文件，避免静默截断团队规则", async () => {
    vi.mocked(prFileContent)
      .mockResolvedValueOnce({
        path: aiRepositoryRuleDiscoveryPaths[0],
        revision: "head-1",
        content: "x".repeat(12_001),
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: aiRepositoryRuleDiscoveryPaths[1],
        revision: "head-1",
        content: "短规则",
        truncated: false,
        binary: false,
      });

    await expect(
      discoverAiRepositoryRules({
        platform: "github",
        owner: "team",
        repo: "repo",
        revision: "head-1",
      }),
    ).resolves.toEqual({ path: ".mergebeacon/rules.md", content: "短规则" });
  });

  it("将非缺失文件错误交给调用方展示", async () => {
    vi.mocked(prFileContent).mockRejectedValue(new Error("网络连接失败"));

    await expect(
      discoverAiRepositoryRules({
        platform: "github",
        owner: "team",
        repo: "repo",
        revision: "head-1",
      }),
    ).rejects.toThrow("网络连接失败");
    expect(prFileContent).toHaveBeenCalledTimes(1);
  });
});
