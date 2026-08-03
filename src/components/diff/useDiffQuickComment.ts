import { onMounted, onUnmounted, ref, watch, type Ref } from "vue";

export interface QuickCommentTarget {
  x: number;
  y: number;
  path: string;
  startLine: number;
  endLine: number;
  side: "left" | "right";
  selectedText: string;
}

interface DiffQuickCommentOptions {
  containerRef: Ref<HTMLElement | null>;
  readOnly: Readonly<Ref<boolean>>;
}

interface SelectionRange {
  path: string;
  startLine: number;
  endLine: number;
  side: "left" | "right";
}

function getFileFromNode(node: Node): HTMLElement | null {
  let element: HTMLElement | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (element) {
    if (
      element.classList.contains("controlled-file-wrapper") ||
      element.classList.contains("d2h-file-wrapper") ||
      element.classList.contains("d2h-wrapper")
    ) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

function getControlledSelectionRange(range: Range, file: HTMLElement): SelectionRange | null {
  const path = file.dataset.filePath ?? "";
  if (!path) return null;

  const selectedLines = Array.from(
    file.querySelectorAll<HTMLElement>(".controlled-line[data-line][data-side]"),
  ).filter((line) => range.intersectsNode(line));
  const selectedSides = new Set(selectedLines.map((line) => line.dataset.side));
  if (selectedLines.length === 0 || selectedSides.size !== 1) return null;

  const side = selectedLines[0].dataset.side;
  if (side !== "left" && side !== "right") return null;
  const lines = selectedLines
    .map((line) => Number.parseInt(line.dataset.line ?? "", 10))
    .filter((line) => Number.isFinite(line) && line > 0);
  if (lines.length === 0) return null;

  return {
    path,
    startLine: Math.min(...lines),
    endLine: Math.max(...lines),
    side,
  };
}

function getLegacySelectionRange(range: Range, file: HTMLElement): SelectionRange | null {
  const fileNameElement =
    file.querySelector(".d2h-file-name") ||
    file.querySelector(".d2h-file-name-wrapper .d2h-file-name");
  const path = fileNameElement?.textContent?.trim() || "";
  if (!path) return null;

  const lines: number[] = [];
  let side: "left" | "right" | null = null;
  file.querySelectorAll("tr").forEach((row) => {
    if (!range.intersectsNode(row)) return;
    row.querySelectorAll(".d2h-code-side-linenumber, .d2h-code-linenumber").forEach((element) => {
      const line = Number.parseInt((element as HTMLElement).textContent || "0", 10);
      if (!line) return;
      lines.push(line);
      if (side) return;

      const scroller = (element as HTMLElement).closest<HTMLElement>(".d2h-file-side-diff");
      if (!scroller) return;
      const sideDiffs = scroller.parentElement?.querySelectorAll(".d2h-file-side-diff");
      side = sideDiffs && sideDiffs.length > 1 && sideDiffs[0] === scroller ? "left" : "right";
    });
  });

  if (lines.length === 0 || !side) return null;
  return { path, startLine: Math.min(...lines), endLine: Math.max(...lines), side };
}

function getSelectionRange(): SelectionRange | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return null;

  const range = selection.getRangeAt(0);
  const startFile = getFileFromNode(range.startContainer);
  const endFile = getFileFromNode(range.endContainer);
  if (!startFile || startFile !== endFile) return null;

  return startFile.classList.contains("controlled-file-wrapper")
    ? getControlledSelectionRange(range, startFile)
    : getLegacySelectionRange(range, startFile);
}

export function useDiffQuickComment(options: DiffQuickCommentOptions) {
  const quickComment = ref<QuickCommentTarget | null>(null);
  let contextMenuListenerAttached = false;

  function handleContextMenu(event: MouseEvent): void {
    if (options.readOnly.value) return;
    const target = event.target as HTMLElement;
    if (!options.containerRef.value?.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();

    const selectionRange = getSelectionRange();
    if (!selectionRange) return;
    quickComment.value = {
      x: event.clientX,
      y: event.clientY,
      path: selectionRange.path,
      startLine: selectionRange.startLine,
      endLine: selectionRange.endLine,
      side: selectionRange.side,
      selectedText: window.getSelection()?.toString().trim() || "",
    };
  }

  function syncContextMenuListener(readOnly = options.readOnly.value): void {
    if (readOnly) {
      if (contextMenuListenerAttached) {
        document.removeEventListener("contextmenu", handleContextMenu, true);
        contextMenuListenerAttached = false;
      }
      return;
    }
    if (!contextMenuListenerAttached) {
      document.addEventListener("contextmenu", handleContextMenu, true);
      contextMenuListenerAttached = true;
    }
  }

  function handleDocumentClick(): void {
    quickComment.value = null;
  }

  watch(options.readOnly, (readOnly) => {
    syncContextMenuListener(readOnly);
    if (readOnly) quickComment.value = null;
  });

  onMounted(() => {
    syncContextMenuListener();
    document.addEventListener("click", handleDocumentClick);
  });

  onUnmounted(() => {
    if (contextMenuListenerAttached) {
      document.removeEventListener("contextmenu", handleContextMenu, true);
      contextMenuListenerAttached = false;
    }
    document.removeEventListener("click", handleDocumentClick);
  });

  return { quickComment };
}
