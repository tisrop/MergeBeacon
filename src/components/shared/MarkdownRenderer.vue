<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { marked } from "marked";
import { clipboardWriteText } from "@/api";
import { getErrorMessage } from "@/utils/error";

const props = defineProps<{
  content: string;
  breaks?: boolean;
  variant?: "document";
}>();

const allowedTags = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "CODE",
  "DEL",
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
  const document = new DOMParser().parseFromString(`<div>${rawHtml}</div>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return "";

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

function copyIcon(): string {
  return `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  `;
}

function addCodeBlockControls(sanitizedHtml: string): string {
  const document = new DOMParser().parseFromString(`<div>${sanitizedHtml}</div>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return "";

  for (const [index, pre] of Array.from(root.querySelectorAll("pre")).entries()) {
    const wrapper = document.createElement("div");
    wrapper.className = "markdown-code-block";
    const button = document.createElement("button");
    button.className = "markdown-code-copy";
    button.type = "button";
    button.dataset.codeCopy = String(index);
    button.title = "复制代码";
    button.setAttribute("aria-label", "复制代码");
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

const html = computed(() =>
  props.variant === "document"
    ? addCodeBlockControls(
        sanitizeHtml(
          marked.parse(props.content, {
            async: false,
            gfm: true,
            breaks: props.breaks ?? true,
          }) as string,
        ),
      )
    : sanitizeHtml(
        marked.parse(props.content, {
          async: false,
          gfm: true,
          breaks: props.breaks ?? true,
        }) as string,
      ),
);

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
    activeCopyButton.title = "复制代码";
    activeCopyButton.setAttribute("aria-label", "复制代码");
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
  if (!button || !rootRef.value?.contains(button)) return;
  const code = button.closest(".markdown-code-block")?.querySelector("code");
  if (!code) return;

  const sequence = ++copySequence;
  copyInFlight = true;
  button.disabled = true;
  setCopyStatus("正在复制代码");
  try {
    await clipboardWriteText(code.textContent ?? "");
    if (sequence !== copySequence) return;
    showCopyFeedback(button, "copied", "代码已复制");
  } catch (error) {
    if (sequence !== copySequence) return;
    showCopyFeedback(button, "error", `复制失败：${getErrorMessage(error, "无法访问剪贴板")}`);
  } finally {
    button.disabled = false;
    copyInFlight = false;
  }
}

watch(
  () => [props.content, props.variant],
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
    v-html="html"
  />
</template>

<style scoped src="./MarkdownRenderer.css"></style>
