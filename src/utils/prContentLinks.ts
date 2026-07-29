import type { Platform } from "@/types";

export interface PrContentLinkContext {
  platform: Platform;
  owner: string;
  repo: string;
  webUrl?: string | null;
}

export interface PrContentRouteTarget {
  owner: string;
  repo: string;
  number: number;
}

export type PrContentLinkTarget =
  | { kind: "issue"; target: PrContentRouteTarget }
  | { kind: "pr"; target: PrContentRouteTarget }
  | { kind: "reference"; reference: "hash" | "bang"; number: number }
  | { kind: "external"; url: string };

const explicitSchemePattern = /^[a-z][a-z\d+.-]*:/i;
const protocolRelativePattern = /^[\\/]{2}/;
const githubWebHosts = new Set(["github.com", "redirect.github.com"]);

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function samePathSegments(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every(
    (segment, index) => segment.toLocaleLowerCase() === right[index].toLocaleLowerCase(),
  );
}

function webUrl(context: PrContentLinkContext): URL | null {
  const rawUrl = context.webUrl?.trim();
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isSamePlatformWebOrigin(parsed: URL, baseUrl: URL, platform: Platform): boolean {
  if (parsed.origin === baseUrl.origin) return true;
  return (
    platform === "github" &&
    parsed.protocol === "https:" &&
    baseUrl.protocol === "https:" &&
    baseUrl.hostname.toLocaleLowerCase() === "github.com" &&
    githubWebHosts.has(parsed.hostname.toLocaleLowerCase()) &&
    !parsed.port
  );
}

function resourcePathTarget(
  segments: string[],
  platform: Platform,
  kind: "issue" | "pr",
): { repositoryEnd: number; number: number } | null {
  let marker: string;
  let requiresDash = false;
  if (kind === "issue") {
    marker = "issues";
    requiresDash = platform === "gitlab";
  } else if (platform === "github") {
    marker = "pull";
  } else if (platform === "gitee") {
    marker = "pulls";
  } else {
    marker = "merge_requests";
    requiresDash = true;
  }

  const markerIndex = segments.map((segment) => segment.toLocaleLowerCase()).lastIndexOf(marker);
  const number = Number(segments[markerIndex + 1]);
  const repositoryEnd = requiresDash ? markerIndex - 1 : markerIndex;
  return repositoryEnd > 0 &&
    (!requiresDash || segments[markerIndex - 1] === "-") &&
    Number.isInteger(number) &&
    number > 0
    ? { repositoryEnd, number }
    : null;
}

function instancePathPrefix(context: PrContentLinkContext, baseUrl: URL): string[] {
  const segments = baseUrl.pathname.split("/").filter(Boolean).map(safeDecodePathSegment);
  const target = resourcePathTarget(segments, context.platform, "pr");
  if (!target) return [];
  const repositorySegments = segments.slice(0, target.repositoryEnd);
  const expected = [...context.owner.split("/"), context.repo].filter(Boolean);
  const prefixEnd = repositorySegments.length - expected.length;
  return prefixEnd >= 0 && samePathSegments(repositorySegments.slice(prefixEnd), expected)
    ? repositorySegments.slice(0, prefixEnd)
    : [];
}

function routeTarget(
  segments: string[],
  context: PrContentLinkContext,
  baseUrl: URL,
  kind: "issue" | "pr",
): PrContentRouteTarget | null {
  const resource = resourcePathTarget(segments, context.platform, kind);
  if (!resource) return null;
  let repositorySegments = segments.slice(0, resource.repositoryEnd);
  const prefix = instancePathPrefix(context, baseUrl);
  if (prefix.length > 0 && samePathSegments(repositorySegments.slice(0, prefix.length), prefix)) {
    repositorySegments = repositorySegments.slice(prefix.length);
  }
  if (repositorySegments.length < 2) return null;
  return {
    owner: repositorySegments.slice(0, -1).join("/"),
    repo: repositorySegments.at(-1) ?? "",
    number: resource.number,
  };
}

export function resolvePrContentLink(
  href: string,
  context: PrContentLinkContext,
): PrContentLinkTarget | null {
  const trimmed = href.trim();
  if (!trimmed || protocolRelativePattern.test(trimmed)) return null;
  const reference = trimmed.match(/^\/__mergebeacon__\/reference\/(hash|bang)\/(\d+)$/);
  if (reference) {
    const number = Number(reference[2]);
    return Number.isSafeInteger(number) && number > 0
      ? { kind: "reference", reference: reference[1] as "hash" | "bang", number }
      : null;
  }
  const isRelative = !explicitSchemePattern.test(trimmed);
  const baseUrl = webUrl(context);
  if (isRelative && !baseUrl) return null;

  try {
    const parsed = new URL(trimmed, baseUrl ?? undefined);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
    if (
      !baseUrl ||
      parsed.protocol === "mailto:" ||
      !isSamePlatformWebOrigin(parsed, baseUrl, context.platform)
    ) {
      return { kind: "external", url: parsed.toString() };
    }

    const segments = parsed.pathname.split("/").filter(Boolean).map(safeDecodePathSegment);
    const issue = routeTarget(segments, context, baseUrl, "issue");
    if (issue) return { kind: "issue", target: issue };
    const pr = routeTarget(segments, context, baseUrl, "pr");
    if (pr) return { kind: "pr", target: pr };
    return { kind: "external", url: parsed.toString() };
  } catch {
    return null;
  }
}
