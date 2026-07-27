import type { PrCommitSummary } from "@/types";

/** 提交区间选择，`startIndex`/`endIndex` 是提交列表（最早 → 最新）中的下标，闭区间。 */
export interface CommitRangeSelection {
  startIndex: number;
  endIndex: number;
}

/** 提交区间对应的 compare 端点。 */
export interface CommitRangeRevisions {
  baseSha: string;
  headSha: string;
}

/** 把任意下标对规整为有序、且落在提交列表范围内的闭区间；列表为空时返回 null。 */
export function normalizeCommitRange(
  commits: PrCommitSummary[],
  range: CommitRangeSelection,
): CommitRangeSelection | null {
  if (commits.length === 0) return null;
  const last = commits.length - 1;
  const start = clampIndex(Math.min(range.startIndex, range.endIndex), last);
  const end = clampIndex(Math.max(range.startIndex, range.endIndex), last);
  if (start === null || end === null) return null;
  return { startIndex: start, endIndex: end };
}

/**
 * 推导提交区间的 compare base/head。
 *
 * base 优先取区间首个提交的第一父提交；平台没有返回父提交时，退回到列表中的前一个提交，
 * 仍然没有才使用 PR / MR 的 base 提交。任何一端缺失或两端相同都返回 null，
 * 由调用方给出明确原因，不得静默换成整体 Diff。
 */
export function resolveCommitRangeRevisions(
  commits: PrCommitSummary[],
  range: CommitRangeSelection,
  prBaseSha: string | null,
): CommitRangeRevisions | null {
  const normalized = normalizeCommitRange(commits, range);
  if (!normalized) return null;

  const headSha = commits[normalized.endIndex].sha;
  const start = commits[normalized.startIndex];
  const baseSha =
    start.parent_shas?.[0] ??
    (normalized.startIndex > 0 ? commits[normalized.startIndex - 1].sha : prBaseSha);

  if (!baseSha || !headSha || baseSha === headSha) return null;
  return { baseSha, headSha };
}

function clampIndex(value: number, last: number): number | null {
  if (!Number.isInteger(value)) return null;
  if (value < 0) return 0;
  if (value > last) return last;
  return value;
}
