import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GUIDE_START = "<!-- mergebeacon-download-guide:start -->";
const GUIDE_END = "<!-- mergebeacon-download-guide:end -->";

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label}不能为空`);
  }
}

function uniqueAsset(assets, label, predicate) {
  const matches = assets.filter(
    (asset) => typeof asset?.name === "string" && predicate(asset.name),
  );
  if (matches.length !== 1) {
    throw new Error(`${label}无法唯一匹配 Release 资源`);
  }
  return matches[0];
}

function optionalUniqueAsset(assets, label, predicate) {
  const matches = assets.filter(
    (asset) => typeof asset?.name === "string" && predicate(asset.name),
  );
  if (matches.length > 1) {
    throw new Error(`${label}存在多个 Release 资源`);
  }
  return matches[0] ?? null;
}

function encodePathSegments(value) {
  return String(value).split("/").map(encodeURIComponent).join("/");
}

function assetUrl(repository, tag, asset) {
  return `https://github.com/${repository}/releases/download/${encodePathSegments(tag)}/${encodeURIComponent(asset.name)}`;
}

function downloadBadgeLink({ label, detail, color, logo, repository, tag, asset }) {
  const badgePath = [label, detail, color].map(encodeURIComponent).join("-");
  const badgeQuery = new URLSearchParams({
    style: "flat-square",
    logo,
    logoColor: "white",
  });
  const badgeUrl = `https://img.shields.io/badge/${badgePath}?${badgeQuery}`;
  return `[![${label} ${detail}](${badgeUrl})](${assetUrl(repository, tag, asset)})`;
}

function downloadCountBadge(repository, tag, asset, label = "downloads") {
  const [owner, name] = repository.split("/");
  const badgeUrl = [
    "https://img.shields.io/github/downloads",
    encodeURIComponent(owner),
    encodeURIComponent(name),
    encodeURIComponent(tag),
    encodeURIComponent(asset.name),
  ].join("/");
  return `![${label}](${badgeUrl}?label=${encodeURIComponent(label)}&cacheSeconds=300&style=flat-square)`;
}

function stripExistingGuide(body) {
  const start = body.indexOf(GUIDE_START);
  const end = body.indexOf(GUIDE_END);
  if (start === -1 && end === -1) return body.trim();
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Release notes 中的下载引导标记不完整");
  }
  if (body.indexOf(GUIDE_START, start + GUIDE_START.length) !== -1) {
    throw new Error("Release notes 中存在多个下载引导起始标记");
  }
  if (body.indexOf(GUIDE_END, end + GUIDE_END.length) !== -1) {
    throw new Error("Release notes 中存在多个下载引导结束标记");
  }
  return `${body.slice(0, start)}${body.slice(end + GUIDE_END.length)}`.trim();
}

export function buildReleaseDownloadGuide({ body, assets, repository, tag }) {
  if (typeof body !== "string") {
    throw new Error("Release notes 必须是字符串");
  }
  if (!Array.isArray(assets)) {
    throw new Error("Release assets 必须是数组");
  }
  assertNonEmptyString(repository, "repository");
  assertNonEmptyString(tag, "tag");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository 格式无效");
  }

  const macArm = uniqueAsset(assets, "macOS Apple Silicon DMG", (name) =>
    /(?:aarch64|arm64)\.dmg$/i.test(name),
  );
  const macIntel = uniqueAsset(assets, "macOS Intel DMG", (name) =>
    /(?:x64|x86_64)\.dmg$/i.test(name),
  );
  const windowsMsi = uniqueAsset(assets, "Windows MSI", (name) => /\.msi$/i.test(name));
  const windowsExe = uniqueAsset(assets, "Windows EXE 安装包", (name) =>
    /(?:setup|installer).*\.exe$/i.test(name),
  );
  const windowsPortable = uniqueAsset(assets, "Windows 便携版 ZIP", (name) =>
    /_x64-portable\.zip$/i.test(name),
  );
  const linuxAppImage = uniqueAsset(assets, "Linux AppImage", (name) => /\.AppImage$/i.test(name));
  const linuxDeb = optionalUniqueAsset(assets, "Linux DEB", (name) => /\.deb$/i.test(name));
  const linuxRpm = optionalUniqueAsset(assets, "Linux RPM", (name) => /\.rpm$/i.test(name));

  const badge = (label, detail, color, logo, asset, countLabel = "downloads") =>
    `${downloadBadgeLink({ label, detail, color, logo, repository, tag, asset })} ${downloadCountBadge(repository, tag, asset, countLabel)}`;
  const macDownloads = [
    badge("DMG", "Apple Silicon", "555555", "apple", macArm),
    badge("DMG", "Intel", "555555", "apple", macIntel),
  ];
  const windowsDownloads = [
    badge("MSI", "x64", "0078D4", "windows11", windowsMsi, "manual + in-app"),
    badge("EXE", "x64", "0078D4", "windows11", windowsExe, "manual + in-app"),
    badge("ZIP", "x64", "0078D4", "windows11", windowsPortable, "manual + app update"),
  ];
  const linuxDownloads = [
    badge("AppImage", "x64", "1793D1", "linux", linuxAppImage, "manual + in-app"),
  ];
  if (linuxDeb) {
    linuxDownloads.push(badge("DEB", "x64", "1793D1", "linux", linuxDeb));
  }
  if (linuxRpm) {
    linuxDownloads.push(badge("RPM", "x64", "1793D1", "linux", linuxRpm));
  }

  const guide = [
    GUIDE_START,
    "**Download based on your device:**",
    "",
    "| OS | Download |",
    "| --- | --- |",
    `| macOS | ${macDownloads.join("<br>")} |`,
    `| Windows | ${windowsDownloads.join("<br>")} |`,
    `| Linux | ${linuxDownloads.join("<br>")} |`,
    GUIDE_END,
  ].join("\n");

  const notes = stripExistingGuide(body);
  return notes ? `${notes}\n\n${guide}\n` : `${guide}\n`;
}

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) {
      throw new Error(`命令参数无效：${argument ?? "<empty>"}`);
    }

    const separator = argument.indexOf("=");
    const name = argument.slice(2, separator === -1 ? undefined : separator);
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1);
    if (!name || value === undefined || value.length === 0 || value.startsWith("--")) {
      throw new Error(`命令参数无效：${argument}`);
    }
    options[name] = value;
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [release, assets] = await Promise.all([
    readFile(options.release, "utf8").then(JSON.parse),
    readFile(options.assets, "utf8").then(JSON.parse),
  ]);
  const body = buildReleaseDownloadGuide({
    body: release.body ?? "",
    assets,
    repository: options.repository,
    tag: options.tag,
  });
  await writeFile(options.output, body);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
