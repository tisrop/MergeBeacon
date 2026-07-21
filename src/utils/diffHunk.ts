import type { DiffSide, PatchHunk, PatchLine, StandardPatchFile } from "@/types";

const HUNK_TRAILING_LINES = 8;

function lineNumberOnSide(line: PatchLine, side: DiffSide): number | null {
  return side === "left" ? line.old_line : line.new_line;
}

function renderPatchLine(line: PatchLine): string {
  switch (line.kind) {
    case "addition":
      return `+${line.content}`;
    case "deletion":
      return `-${line.content}`;
    case "no_newline":
      return `\\ ${line.content}`;
    default:
      return ` ${line.content}`;
  }
}

function extractHunkOnSide(hunks: PatchHunk[], line: number, side: DiffSide): string | undefined {
  for (const hunk of hunks) {
    const targetIndex = hunk.lines.findIndex(
      (candidate) => lineNumberOnSide(candidate, side) === line,
    );
    if (targetIndex < 0) continue;

    const rendered = [hunk.header];
    let trailingLines = 0;
    for (const [index, candidate] of hunk.lines.entries()) {
      rendered.push(renderPatchLine(candidate));
      if (index <= targetIndex || candidate.kind === "no_newline") continue;
      trailingLines += 1;
      if (trailingLines >= HUNK_TRAILING_LINES) break;
    }
    return rendered.join("\n");
  }
  return undefined;
}

export function findStandardPatch(
  patches: StandardPatchFile[],
  path: string,
): StandardPatchFile | undefined {
  return patches.find(
    (candidate) =>
      candidate.filename === path || candidate.old_path === path || candidate.new_path === path,
  );
}

export function inferDiffSide(patch: StandardPatchFile, path: string): DiffSide | undefined {
  if (patch.old_path !== patch.new_path && path === patch.old_path) return "left";
  if (path === patch.new_path || path === patch.filename) return "right";
  return undefined;
}

export function patchContainsLine(
  patch: StandardPatchFile,
  line: number,
  side?: DiffSide,
): boolean {
  const sides: DiffSide[] = side ? [side] : ["right", "left"];
  return sides.some((candidateSide) =>
    patch.hunks.some((hunk) =>
      hunk.lines.some((candidate) => lineNumberOnSide(candidate, candidateSide) === line),
    ),
  );
}

export function extractDiffHunk(
  patch: StandardPatchFile,
  line: number,
  side?: DiffSide,
): string | undefined {
  if (side) return extractHunkOnSide(patch.hunks, line, side);
  return (
    extractHunkOnSide(patch.hunks, line, "right") ?? extractHunkOnSide(patch.hunks, line, "left")
  );
}

export function findPatchLocation(
  patch: StandardPatchFile,
  line: number,
  requestedPath: string,
  requestedSide?: DiffSide | null,
): { side: DiffSide; line: number } | null {
  if (requestedSide) {
    return patchContainsLine(patch, line, requestedSide) ? { side: requestedSide, line } : null;
  }

  const inferredSide = inferDiffSide(patch, requestedPath);
  const sides: DiffSide[] = inferredSide
    ? [inferredSide, inferredSide === "left" ? "right" : "left"]
    : ["right", "left"];
  for (const side of sides) {
    if (patchContainsLine(patch, line, side)) return { side, line };
  }
  return null;
}
