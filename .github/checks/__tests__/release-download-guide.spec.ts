import { describe, expect, it } from "vitest";
import { buildReleaseDownloadGuide, parseArguments } from "../release-download-guide.mjs";

const repository = "tisrop/MergeBeacon";
const tag = "v0.10.0";

function asset(name: string) {
  return { name };
}

function releaseAssets() {
  return [
    asset("MergeBeacon_0.10.0_aarch64.dmg"),
    asset("MergeBeacon_0.10.0_x64.dmg"),
    asset("MergeBeacon_0.10.0_x64_en-US.msi"),
    asset("MergeBeacon_0.10.0_x64-setup.exe"),
    asset("MergeBeacon_0.10.0_x64-portable.zip"),
    asset("MergeBeacon_0.10.0_amd64.AppImage"),
    asset("MergeBeacon_0.10.0_amd64.deb"),
    asset("MergeBeacon_0.10.0-1.x86_64.rpm"),
    asset("MergeBeacon_0.10.0_aarch64.app.tar.gz"),
    asset("MergeBeacon_0.10.0_x64.app.tar.gz"),
    asset("latest.json"),
  ];
}

describe("Release 下载引导", () => {
  it("支持 --key=value 和 --key value 两种 CLI 参数形式", () => {
    expect(
      parseArguments([
        "--release=release.json",
        "--assets",
        "assets.json",
        "--repository=tisrop/MergeBeacon",
        "--tag",
        "v0.10.0",
        "--output=release-body.md",
      ]),
    ).toEqual({
      release: "release.json",
      assets: "assets.json",
      repository: "tisrop/MergeBeacon",
      tag: "v0.10.0",
      output: "release-body.md",
    });
  });

  it("拒绝缺少值或无效名称的 CLI 参数", () => {
    expect(() => parseArguments(["--release"])).toThrow("命令参数无效：--release");
    expect(() => parseArguments(["--=release.json"])).toThrow("命令参数无效：--=release.json");
    expect(() => parseArguments(["release.json"])).toThrow("命令参数无效：release.json");
  });

  it("按设备生成安装包徽章表格，统计安装包下载量并排除 latest.json", () => {
    const body = buildReleaseDownloadGuide({
      body: "## What's Changed\n\n- 新功能",
      assets: releaseAssets(),
      repository,
      tag,
    });

    expect(body).toContain("**Download based on your device:**");
    expect(body).toContain("| OS | Download |");
    expect(body).toContain("| macOS |");
    expect(body).toContain("| Windows |");
    expect(body).toContain("| Linux |");
    expect(body).toContain("img.shields.io/badge/DMG-Apple%20Silicon-555555");
    expect(body).toContain("img.shields.io/badge/DMG-Intel-555555");
    expect(body).toContain("img.shields.io/badge/MSI-x64-0078D4");
    expect(body).toContain("img.shields.io/badge/EXE-x64-0078D4");
    expect(body).toContain("img.shields.io/badge/ZIP-x64-0078D4");
    expect(body).toContain("img.shields.io/badge/AppImage-x64-1793D1");
    expect(body).toContain("img.shields.io/badge/DEB-x64-1793D1");
    expect(body).toContain("img.shields.io/badge/RPM-x64-1793D1");
    expect(body).toContain("MergeBeacon_0.10.0_aarch64.dmg");
    expect(body).toContain("MergeBeacon_0.10.0_x64-portable.zip");
    const downloadCounts = {
      "MergeBeacon_0.10.0_aarch64.dmg": "downloads",
      "MergeBeacon_0.10.0_x64.dmg": "downloads",
      "MergeBeacon_0.10.0_x64_en-US.msi": "manual%20%2B%20in-app",
      "MergeBeacon_0.10.0_x64-setup.exe": "manual%20%2B%20in-app",
      "MergeBeacon_0.10.0_x64-portable.zip": "manual%20%2B%20app%20update",
      "MergeBeacon_0.10.0_amd64.AppImage": "manual%20%2B%20in-app",
      "MergeBeacon_0.10.0_amd64.deb": "downloads",
      "MergeBeacon_0.10.0-1.x86_64.rpm": "downloads",
    };
    for (const [name, label] of Object.entries(downloadCounts)) {
      expect(body).toContain(
        `img.shields.io/github/downloads/tisrop/MergeBeacon/v0.10.0/${name}?label=${label}&cacheSeconds=300&style=flat-square`,
      );
    }
    expect(body).not.toContain("/releases/download/v0.10.0/latest.json");
    expect(body).not.toContain("/v0.10.0/latest.json?label=");
    expect(body).not.toContain("**In-app updater downloads:**");
    expect(body).not.toContain(".app.tar.gz");
  });

  it("保留 Tag 中的路径分隔符并编码各路径段", () => {
    const body = buildReleaseDownloadGuide({
      body: "说明",
      assets: releaseAssets(),
      repository,
      tag: "v0.10.0/rc 1",
    });

    expect(body).toContain("/releases/download/v0.10.0/rc%201/");
    expect(body).toContain("/github/downloads/tisrop/MergeBeacon/v0.10.0%2Frc%201/");
  });

  it("重复执行时替换已有下载引导而不是继续追加", () => {
    const first = buildReleaseDownloadGuide({
      body: "原始发布说明",
      assets: releaseAssets(),
      repository,
      tag,
    });
    const second = buildReleaseDownloadGuide({
      body: first,
      assets: releaseAssets(),
      repository,
      tag,
    });

    expect(second.split("| OS | Download |")).toHaveLength(2);
    expect(second.match(/mergebeacon-download-guide:start/g)).toHaveLength(1);
    expect(second).toContain("原始发布说明");
  });

  it("Linux 的发行版安装包缺失时仍保留 AppImage 引导", () => {
    const assets = releaseAssets().filter(
      ({ name }) => !name.endsWith(".deb") && !name.endsWith(".rpm"),
    );
    const body = buildReleaseDownloadGuide({ body: "说明", assets, repository, tag });

    expect(body).toContain("AppImage");
    expect(body).not.toContain("Debian / Ubuntu (.deb)");
    expect(body).not.toContain("Fedora / RPM (.rpm)");
  });

  it("核心平台安装包缺失或重复时拒绝生成不完整引导", () => {
    const missing = releaseAssets().filter(({ name }) => !name.endsWith("aarch64.dmg"));
    expect(() =>
      buildReleaseDownloadGuide({ body: "说明", assets: missing, repository, tag }),
    ).toThrow("macOS Apple Silicon DMG无法唯一匹配 Release 资源");

    const duplicate = [...releaseAssets(), asset("MergeBeacon-copy_x64.dmg")];
    expect(() =>
      buildReleaseDownloadGuide({ body: "说明", assets: duplicate, repository, tag }),
    ).toThrow("macOS Intel DMG无法唯一匹配 Release 资源");

    const withoutUpdaterMetadata = releaseAssets().filter(
      ({ name }) => !name.endsWith(".app.tar.gz") && name !== "latest.json",
    );
    expect(() =>
      buildReleaseDownloadGuide({ body: "说明", assets: withoutUpdaterMetadata, repository, tag }),
    ).not.toThrow();
  });
});
