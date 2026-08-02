import { html } from "diff2html";
import { sanitizeHtmlFragment } from "@/utils/sanitizeHtml";

const MAX_INLINE_HIGHLIGHT_RATIO = 0.8;
const LOW_SIMILARITY_HIGHLIGHT_CLASS = "d2h-low-similarity-highlight";
const LEGACY_DIFF_ALLOWED_TAGS = new Set([
  "BR",
  "DEL",
  "DIV",
  "INPUT",
  "INS",
  "LABEL",
  "PATH",
  "SPAN",
  "SVG",
  "TABLE",
  "TBODY",
  "TD",
  "TR",
]);
const LEGACY_DIFF_ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  "*": new Set(["class"]),
  INPUT: new Set(["checked", "disabled", "type"]),
  PATH: new Set(["d"]),
  SVG: new Set(["aria-hidden", "height", "version", "viewbox", "width"]),
};
const LEGACY_DIFF_CLASS_PATTERN = /^d2h-[a-z0-9-]+$/;

function textLength(value: string | null): number {
  return Array.from(value ?? "").length;
}

function normalizeInlineHighlights(renderedHtml: string): string {
  const document = new DOMParser().parseFromString(renderedHtml, "text/html");

  document.querySelectorAll<HTMLElement>(".d2h-code-line-ctn").forEach((line) => {
    const highlights = Array.from(line.querySelectorAll<HTMLElement>("ins, del"));
    const totalLength = textLength(line.textContent);
    if (highlights.length === 0 || totalLength === 0) return;

    const highlightedLength = highlights.reduce(
      (length, highlight) => length + textLength(highlight.textContent),
      0,
    );
    if (highlightedLength / totalLength < MAX_INLINE_HIGHLIGHT_RATIO) return;

    // diff2html 会把低相似度替换行的大部分内容标成词级变化。GitHub 对这种行只保留
    // 整行浅色背景，避免整段代码被误显示为深红或深绿。
    highlights.forEach((highlight) => highlight.classList.add(LOW_SIMILARITY_HIGHLIGHT_CLASS));
  });

  return document.body.innerHTML;
}

export function sanitizeLegacyDiffHtml(renderedHtml: string): string {
  return sanitizeHtmlFragment(renderedHtml, {
    allowedTags: LEGACY_DIFF_ALLOWED_TAGS,
    allowedAttributes: LEGACY_DIFF_ALLOWED_ATTRIBUTES,
    afterSanitizeElement(element) {
      if (element.hasAttribute("class")) {
        const safeClasses = Array.from(element.classList).filter((className) =>
          LEGACY_DIFF_CLASS_PATTERN.test(className),
        );
        if (safeClasses.length > 0) element.setAttribute("class", safeClasses.join(" "));
        else element.removeAttribute("class");
      }
      if (element.tagName === "INPUT") {
        if (element.getAttribute("type") !== "checkbox") {
          element.remove();
          return;
        }
        element.setAttribute("disabled", "");
      }
    },
  });
}

export function renderLegacyDiffHtml(diff: string, options: Parameters<typeof html>[1]): string {
  return sanitizeLegacyDiffHtml(normalizeInlineHighlights(html(diff, options)));
}
