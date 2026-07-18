import { defineStore } from "pinia";
import { ref } from "vue";
import type { Platform } from "@/types";

export interface ReviewProgressContext {
  platform: Platform;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
}

const STORAGE_PREFIX = "mergebeacon:review-progress:";

function contextKey(context: ReviewProgressContext): string {
  return [
    context.platform,
    encodeURIComponent(context.owner),
    encodeURIComponent(context.repo),
    context.prNumber,
    context.headSha || "unknown-head",
  ].join(":");
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readViewedFiles(key: string): string[] {
  try {
    const value = localStorage.getItem(storageKey(key));
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((path): path is string => typeof path === "string" && path.length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeViewedFiles(key: string, paths: Set<string>): void {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify([...paths].sort()));
  } catch {
    // Hardened webviews may disable storage; keep the progress valid for this session.
  }
}

export const useReviewProgressStore = defineStore("review-progress", () => {
  const viewedByContext = ref<Record<string, Set<string>>>({});

  const loadedContexts = new Set<string>();

  function ensureContext(context: ReviewProgressContext): string {
    const key = contextKey(context);
    if (!loadedContexts.has(key)) {
      viewedByContext.value[key] = new Set(readViewedFiles(key));
      loadedContexts.add(key);
    }
    return key;
  }

  function viewedFiles(context: ReviewProgressContext): Set<string> {
    const key = ensureContext(context);
    return viewedByContext.value[key] ?? new Set<string>();
  }

  function isFileViewed(context: ReviewProgressContext, path: string): boolean {
    return viewedFiles(context).has(path);
  }

  function setFileViewed(context: ReviewProgressContext, path: string, viewed: boolean): void {
    if (!path) return;
    const key = ensureContext(context);
    const next = new Set(viewedByContext.value[key] ?? []);
    if (viewed) next.add(path);
    else next.delete(path);
    viewedByContext.value[key] = next;
    writeViewedFiles(key, next);
  }

  function replaceViewedFiles(context: ReviewProgressContext, paths: string[]): void {
    const key = ensureContext(context);
    const next = new Set(paths.filter((path) => path.length > 0));
    viewedByContext.value[key] = next;
    writeViewedFiles(key, next);
  }

  function pruneFiles(context: ReviewProgressContext, validPaths: string[]): void {
    const key = ensureContext(context);
    const valid = new Set(validPaths);
    const current = viewedByContext.value[key] ?? new Set<string>();
    const next = new Set([...current].filter((path) => valid.has(path)));
    if (next.size === current.size) return;
    viewedByContext.value[key] = next;
    writeViewedFiles(key, next);
  }

  return {
    viewedFiles,
    isFileViewed,
    setFileViewed,
    replaceViewedFiles,
    pruneFiles,
  };
});
