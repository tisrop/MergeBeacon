<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { marked } from "marked";
import { clipboardWriteText } from "@/api";
import { useI18n } from "@/i18n";
import { getErrorMessage } from "@/utils/error";

const props = defineProps<{
  content: string;
  breaks?: boolean;
  variant?: "document";
  linkMode?: "default" | "emit";
  repositoryReferences?: boolean;
}>();

const emit = defineEmits<{
  "link-click": [payload: { href: string; text: string; title: string | null }];
}>();

const { t } = useI18n();

const allowedTags = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
  "DETAILS",
  "EM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HR",
  "I",
  "IMG",
  "INPUT",
  "LI",
  "OL",
  "P",
  "PRE",
  "S",
  "STRONG",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

const allowedAttributes: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  CODE: new Set(["class"]),
  DETAILS: new Set(["open"]),
  IMG: new Set(["alt", "height", "src", "title", "width"]),
  INPUT: new Set(["checked", "disabled", "type"]),
  OL: new Set(["start"]),
  TABLE: new Set(["align"]),
  TD: new Set(["align", "colspan", "rowspan"]),
  TH: new Set(["align", "colspan", "rowspan"]),
};

const safeRelativeUrlBase = new URL("https://mergebeacon.invalid");
const explicitSchemePattern = /^[a-z][a-z\d+.-]*:/i;
const protocolRelativePattern = /^[\\/]{2}/;
const githubUserAttachmentPathPattern =
  /^\/user-attachments\/assets\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const githubVideoAttachmentHosts = new Set([
  "user-images.githubusercontent.com",
  "secured-user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "github-production-user-asset-6210df.s3.amazonaws.com",
]);
const videoAttachmentPathPattern = /\.(?:mp4|m4v|mov|webm|ogv|ogg)$/i;
// Reuse the parser for synchronous recomputations; parseFromString still returns an isolated document.
const htmlParser = new DOMParser();

function parseHtmlFragment(html: string): { document: Document; root: Element } | null {
  const document = htmlParser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = document.body.firstElementChild;
  return root ? { document, root } : null;
}

function isSafeUrl(value: string, attribute: "href" | "src"): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (protocolRelativePattern.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed, safeRelativeUrlBase);
    if (!explicitSchemePattern.test(trimmed)) {
      return parsed.origin === safeRelativeUrlBase.origin;
    }
    const protocol = parsed.protocol;
    return attribute === "href"
      ? ["http:", "https:", "mailto:"].includes(protocol)
      : ["http:", "https:"].includes(protocol);
  } catch {
    return false;
  }
}

function sanitizeHtml(rawHtml: string): string {
  const fragment = parseHtmlFragment(rawHtml);
  if (!fragment) return "";
  const { root } = fragment;

  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (!allowedTags.has(element.tagName)) {
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM"].includes(element.tagName)) {
        element.remove();
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
      continue;
    }

    const allowed = allowedAttributes[element.tagName] ?? new Set<string>();
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || !allowed.has(name)) {
        element.removeAttribute(attribute.name);
      }
    }
    for (const name of ["href", "src"] as const) {
      const value = element.getAttribute(name);
      if (value && !isSafeUrl(value, name)) element.removeAttribute(name);
    }
    if (element.tagName === "INPUT") {
      if (element.getAttribute("type") !== "checkbox") {
        element.remove();
        continue;
      }
      element.setAttribute("disabled", "");
    }
    if (element.tagName === "A" && element.hasAttribute("href")) {
      element.setAttribute("rel", "noopener noreferrer");
    }
  }
  return root.innerHTML;
}

function isGitHubVideoAttachmentCandidate(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== ""
    ) {
      return false;
    }
    if (parsed.hostname === "github.com") {
      return parsed.search === "" && githubUserAttachmentPathPattern.test(parsed.pathname);
    }
    return (
      githubVideoAttachmentHosts.has(parsed.hostname) &&
      videoAttachmentPathPattern.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function addGitHubAttachmentPreviews(sanitizedHtml: string): string {
  const fragment = parseHtmlFragment(sanitizedHtml);
  if (!fragment) return "";
  const { document, root } = fragment;

  for (const anchor of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    const href = anchor.getAttribute("href");
    if (!href || !isGitHubVideoAttachmentCandidate(href)) continue;

    const video = document.createElement("video");
    video.src = href;
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.dataset.mediaAttachmentPreview = "pending";
    video.setAttribute("aria-label", t("markdown.videoAttachment"));
    anchor.dataset.mediaAttachmentFallback = "";
    anchor.hidden = true;
    anchor.before(video);
  }
  return root.innerHTML;
}

function copyIcon(): string {
  return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
}

function addCodeBlockControls(sanitizedHtml: string): string {
  const fragment = parseHtmlFragment(sanitizedHtml);
  if (!fragment) return "";
  const { document, root } = fragment;

  for (const [index, pre] of Array.from(root.querySelectorAll("pre")).entries()) {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-code-block";
    const button = document.createElement("button");
    button.className = "markdown-code-copy";
    button.type = "button";
    button.dataset.codeCopy = String(index);
    button.title = t("markdown.copyCode");
    button.setAttribute("aria-label", t("markdown.copyCode"));
    button.innerHTML = copyIcon();
    pre.replaceWith(wrapper);
    wrapper.append(pre, button);
  }
  const status = document.createElement("span");
  status.className = "markdown-copy-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  root.append(status);
  return root.innerHTML;
}

function addRepositoryReferenceLinks(sanitizedHtml: string): string {
  const fragment = parseHtmlFragment(sanitizedHtml);
  if (!fragment) return "";
  const { document, root } = fragment;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) textNodes.push(walker.currentNode);
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest("a, code, pre")) continue;
    const value = textNode.data;
    const matches = [...value.matchAll(/(^|[^\w/])([#!])(\d+)\b/g)];
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const index = match.index ?? 0;
      const prefix = match[1];
      const symbol = match[2];
      const number = match[3];
      fragment.append(value.slice(offset, index), prefix);
      const anchor = document.createElement("a");
      anchor.href = `/__mergebeacon__/reference/${symbol === "#" ? "hash" : "bang"}/${number}`;
      anchor.textContent = `${symbol}${number}`;
      anchor.title = t("markdown.openReference", { reference: `${symbol}${number}` });
      fragment.append(anchor);
      offset = index + match[0].length;
    }
    fragment.append(value.slice(offset));
    textNode.replaceWith(fragment);
  }
  return root.innerHTML;
}

const html = computed(() => {
  const sanitized = sanitizeHtml(
    marked.parse(props.content, {
      async: false,
      gfm: true,
      breaks: props.breaks ?? true,
    }) as string,
  );
  const linked = props.repositoryReferences ? addRepositoryReferenceLinks(sanitized) : sanitized;
  const withMedia = addGitHubAttachmentPreviews(linked);
  return props.variant === "document" ? addCodeBlockControls(withMedia) : withMedia;
});

const rootRef = ref<HTMLElement | null>(null);
let activeCopyButton: HTMLButtonElement | null = null;
let copyResetHandle: ReturnType<typeof setTimeout> | null = null;
let copySequence = 0;
let copyInFlight = false;

function clearCopyFeedback(): void {
  if (copyResetHandle !== null) {
    clearTimeout(copyResetHandle);
    copyResetHandle = null;
  }
  if (activeCopyButton) {
    delete activeCopyButton.dataset.copyState;
    activeCopyButton.title = t("markdown.copyCode");
    activeCopyButton.setAttribute("aria-label", t("markdown.copyCode"));
    activeCopyButton = null;
  }
  const status = rootRef.value?.querySelector(".markdown-copy-status");
  if (status) status.textContent = "";
}

function setCopyStatus(message: string): void {
  const status = rootRef.value?.querySelector(".markdown-copy-status");
  if (status) status.textContent = message;
}

function showCopyFeedback(
  button: HTMLButtonElement,
  state: "copied" | "error",
  message: string,
): void {
  clearCopyFeedback();
  activeCopyButton = button;
  button.dataset.copyState = state;
  button.title = message;
  button.setAttribute("aria-label", message);
  setCopyStatus(message);
  copyResetHandle = setTimeout(
    () => {
      clearCopyFeedback();
    },
    state === "copied" ? 1500 : 3000,
  );
}

async function handleRendererClick(event: MouseEvent): Promise<void> {
  if (copyInFlight || !(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("[data-code-copy]");
  if (button && rootRef.value?.contains(button)) {
    const code = button.closest(".markdown-code-block")?.querySelector("code");
    if (!code) return;

    const sequence = ++copySequence;
    copyInFlight = true;
    button.disabled = true;
    setCopyStatus(t("markdown.copyingCode"));
    try {
      await clipboardWriteText(code.textContent ?? "");
      if (sequence !== copySequence) return;
      showCopyFeedback(button, "copied", t("markdown.codeCopied"));
    } catch (error) {
      if (sequence !== copySequence) return;
      showCopyFeedback(
        button,
        "error",
        t("common.copyFailed", {
          message: getErrorMessage(error, t("markdown.clipboardUnavailable")),
        }),
      );
    } finally {
      button.disabled = false;
      copyInFlight = false;
    }
    return;
  }

  if (props.linkMode === "emit") {
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || !rootRef.value?.contains(anchor)) return;
    event.preventDefault();
    emit("link-click", {
      href: anchor.getAttribute("href") ?? "",
      text: anchor.textContent?.trim() ?? "",
      title: anchor.getAttribute("title"),
    });
  }
}

function mediaAttachmentVideo(event: Event): HTMLVideoElement | null {
  const video = event.target;
  if (
    !(video instanceof HTMLVideoElement) ||
    !video.dataset.mediaAttachmentPreview ||
    !rootRef.value?.contains(video)
  ) {
    return null;
  }
  return video;
}

function handleMediaAttachmentLoaded(event: Event): void {
  const video = mediaAttachmentVideo(event);
  if (!video) return;
  video.dataset.mediaAttachmentPreview = "ready";
  const fallback = video.nextElementSibling;
  if (
    fallback instanceof HTMLAnchorElement &&
    fallback.dataset.mediaAttachmentFallback !== undefined
  ) {
    fallback.hidden = true;
  }
}

function handleMediaAttachmentError(event: Event): void {
  const video = mediaAttachmentVideo(event);
  if (!video) return;
  const fallback = video.nextElementSibling;
  if (
    fallback instanceof HTMLAnchorElement &&
    fallback.dataset.mediaAttachmentFallback !== undefined
  ) {
    fallback.hidden = false;
  }
  video.remove();
}

watch(
  () => [props.content, props.variant, props.repositoryReferences],
  () => {
    copySequence += 1;
    clearCopyFeedback();
  },
);

onUnmounted(() => {
  copySequence += 1;
  clearCopyFeedback();
});
</script>

<template>
  <div
    ref="rootRef"
    class="markdown-renderer"
    :class="{ 'markdown-renderer-document': variant === 'document' }"
    @click="handleRendererClick"
    @error.capture="handleMediaAttachmentError"
    @loadedmetadata.capture="handleMediaAttachmentLoaded"
    v-html="html"
  />
</template>

<style scoped src="./MarkdownRenderer.css"></style>
