import { prFileContent } from "@/api";
import type { Platform } from "@/types";

const DISCOVERY_PATHS = [
  ".mergebeacon/ai-review.md",
  ".mergebeacon/rules.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  ".github/ai-review.md",
] as const;
const MAX_DISCOVERED_RULES_LENGTH = 12_000;

export interface AiRepositoryRulesReference {
  platform: Platform;
  owner: string;
  repo: string;
  revision: string;
}

export interface DiscoveredAiRules {
  path: string;
  content: string;
}

function isMissingFileError(error: unknown): boolean {
  const message = String(error).trim().toLowerCase();
  const status = message.replace(/https?:\/\/\S+/g, "").match(/\b([45]\d{2})\b/)?.[1];
  if (status) return status === "404";
  return /\bnot found\b/.test(message) || message.includes("不存在");
}

/**
 * Read repository-owned review instructions in a stable order. A partial or
 * binary response is never used as policy because it could silently omit a
 * rule; the next convention is attempted instead.
 */
export async function discoverAiRepositoryRules(
  reference: AiRepositoryRulesReference,
): Promise<DiscoveredAiRules | null> {
  for (const path of DISCOVERY_PATHS) {
    try {
      const file = await prFileContent(
        reference.platform,
        reference.owner,
        reference.repo,
        path,
        reference.revision,
      );
      const content = file.content.trim();
      if (
        !content ||
        file.binary ||
        file.truncated ||
        content.length > MAX_DISCOVERED_RULES_LENGTH
      ) {
        continue;
      }
      return { path, content };
    } catch (cause) {
      // A missing convention is expected; permission and transport failures are not.
      if (!isMissingFileError(cause)) throw cause;
    }
  }
  return null;
}

export const aiRepositoryRuleDiscoveryPaths = DISCOVERY_PATHS;
