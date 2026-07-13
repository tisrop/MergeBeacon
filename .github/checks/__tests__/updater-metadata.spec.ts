import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleUpdaterMetadata, createUpdaterFragment } from "../updater-metadata.mjs";

async function signatureFile(directory: string, name: string, signature: string) {
  const path = join(directory, name);
  await writeFile(path, signature);
  return path;
}

function fragment(platform: string, assetName: string) {
  const entry = {
    signature: `signature-${platform}`,
    asset_label: assetName,
    asset_name: assetName,
  };
  return { platform, platforms: { [platform]: entry } };
}

describe("updater 元数据汇总", () => {
  it("从 macOS Tauri 产物生成架构隔离的分片", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mergepilot-updater-"));
    const signature = await signatureFile(
      directory,
      "Merge Pilot.app.tar.gz.sig",
      "trusted updater signature",
    );

    const result = await createUpdaterFragment({
      artifactPaths: [signature],
      platform: "darwin-aarch64",
      productName: "Merge Pilot",
      version: "0.3.5",
    });

    expect(result.platforms["darwin-aarch64"]).toMatchObject({
      asset_label: "Merge Pilot_0.3.5_aarch64.app.tar.gz",
      asset_name: "Merge.Pilot_0.3.5_aarch64.app.tar.gz",
    });
    expect(result.platforms["darwin-aarch64-app"]).toEqual(result.platforms["darwin-aarch64"]);
  });

  it("Windows 主条目优先使用 MSI 并保留 NSIS 条目", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mergepilot-updater-"));
    const msiSignature = await signatureFile(
      directory,
      "Merge Pilot_0.3.5_x64_en-US.msi.sig",
      "msi-signature",
    );
    const nsisSignature = await signatureFile(
      directory,
      "Merge Pilot_0.3.5_x64-setup.exe.sig",
      "nsis-signature",
    );

    const result = await createUpdaterFragment({
      artifactPaths: [nsisSignature, msiSignature],
      platform: "windows-x86_64",
      productName: "Merge Pilot",
      version: "0.3.5",
    });

    expect(result.platforms["windows-x86_64"].signature).toBe("msi-signature");
    expect(result.platforms["windows-x86_64-msi"].signature).toBe("msi-signature");
    expect(result.platforms["windows-x86_64-nsis"].signature).toBe("nsis-signature");
  });

  it("只使用 Release API 返回的资源地址汇总四个平台", () => {
    const platforms = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];
    const fragments = platforms.map((platform) => fragment(platform, `${platform}.updater`));
    const assets = platforms.map((platform, index) => ({
      name: `${platform}.updater`,
      label: `${platform}.updater`,
      url: `https://api.github.com/repos/tisrop/MergePilot/releases/assets/${index + 1}`,
    }));

    const metadata = assembleUpdaterMetadata({
      fragments,
      assets,
      version: "0.3.5",
      notes: "发布说明",
      pubDate: "2026-07-13T12:00:00.000Z",
      assetUrlPrefix: "https://api.github.com/repos/tisrop/MergePilot/releases/assets/",
    });

    expect(Object.keys(metadata.platforms)).toEqual(platforms);
    expect(metadata.platforms["linux-x86_64"].url).toBe(assets[2].url);
  });

  it("拒绝缺失平台、重复条目和非官方资源地址", () => {
    const validFragments = [
      fragment("darwin-aarch64", "darwin-aarch64.updater"),
      fragment("darwin-x86_64", "darwin-x86_64.updater"),
      fragment("linux-x86_64", "linux-x86_64.updater"),
      fragment("windows-x86_64", "windows-x86_64.updater"),
    ];
    const assets = validFragments.map(({ platform }) => ({
      name: `${platform}.updater`,
      label: `${platform}.updater`,
      url: `https://api.github.com/repos/tisrop/MergePilot/releases/assets/${platform}`,
    }));
    const input = {
      fragments: validFragments,
      assets,
      version: "0.3.5",
      notes: "发布说明",
      pubDate: "2026-07-13T12:00:00.000Z",
      assetUrlPrefix: "https://api.github.com/repos/tisrop/MergePilot/releases/assets/",
    };

    expect(() => assembleUpdaterMetadata({ ...input, fragments: validFragments.slice(1) })).toThrow(
      "latest.json 缺少平台条目：darwin-aarch64",
    );
    expect(() =>
      assembleUpdaterMetadata({ ...input, fragments: [...validFragments, validFragments[0]] }),
    ).toThrow("updater 平台条目重复：darwin-aarch64");
    expect(() =>
      assembleUpdaterMetadata({
        ...input,
        assets: [{ ...assets[0], url: "https://example.com/update" }, ...assets.slice(1)],
      }),
    ).toThrow("darwin-aarch64 的 Release updater 资源地址无效");
  });

  it("Release 工作流并行构建且只有汇总任务写 latest.json", async () => {
    const workflow = await readFile(resolve(".github/workflows/release.yml"), "utf8");

    expect(workflow).not.toContain("max-parallel: 1");
    expect(workflow).toContain("prepare-release:");
    expect(workflow).toContain("releaseId: ${{ needs.prepare-release.outputs.release-id }}");
    expect(workflow).toContain("uploadUpdaterJson: false");
    expect(workflow).toContain("name: updater-fragment-${{ matrix.updater-platform }}");
    expect(workflow).toContain("assemble-updater-metadata:");
    expect(workflow).toContain("needs: [prepare-release, build]");
    expect(workflow.match(/gh release upload[^\n]*latest\.json/g)).toHaveLength(1);
  });
});
