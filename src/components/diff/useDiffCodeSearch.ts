import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  onUpdated,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from "vue";
import { translate } from "@/i18n";
type SearchSide = "left" | "right";
const SEARCH_SIDES: SearchSide[] = ["left", "right"];
const CODE_SEARCH_QUERY_DEBOUNCE_MS = 75;
const MAX_CODE_SEARCH_REGEX_LENGTH = 256;
const MAX_CODE_SEARCH_REGEX_LINE_LENGTH = 20_000;
const SIDE_DIFF_SELECTOR = ".d2h-file-side-diff, .controlled-file-side-diff";

export interface CodeSearchState {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  error: string;
  matchCount: number;
  activeMatchIndex: number;
}

export type CodeSearchOption = "caseSensitive" | "wholeWord" | "regex";

type CodeSearchMatchAnchor =
  | { kind: "controlled"; side: SearchSide; line: number; text: string; occurrence: number }
  | {
      kind: "legacy";
      side: SearchSide;
      codeElementIndex: number;
      text: string;
      occurrence: number;
    };

interface PendingRefresh {
  preferredIndex: number;
  shouldScroll: boolean;
  preferredAnchor: CodeSearchMatchAnchor | null;
}

interface UseDiffCodeSearchOptions {
  containerRef: Ref<HTMLElement | null>;
  workspaceRef: Ref<HTMLElement | null>;
  diffScrollRef: Ref<HTMLElement | null>;
  selectedFile: ComputedRef<{ status?: string } | null>;
  selectedFilePath: Ref<string>;
  diffHtml: ComputedRef<string>;
  selectedStandardPatch: ComputedRef<{ content_kind?: string } | null>;
  expandedContextGaps: Ref<unknown>;
  isShowingMediaPreview: ComputedRef<boolean>;
  canSearchCurrentFile: ComputedRef<boolean>;
  isDiffSyncScrollEnabled: Ref<boolean>;
  quickComment: Ref<unknown>;
  setSideDiffScrollLeft: (scrollLeft: number, source?: HTMLElement) => void;
  setSideDiffScrollerScrollLeft: (scroller: HTMLElement, scrollLeft: number) => void;
  updateTopScrollbar: () => void;
  scrollElementWithinContainer: (
    element: HTMLElement,
    container: HTMLElement,
    alignment: "center" | "nearest",
  ) => void;
}

export function useDiffCodeSearch(options: UseDiffCodeSearchOptions) {
  const searchInputRefs = ref<HTMLInputElement[]>([]);
  const hoveredCodeSearchSide = ref<SearchSide | null>(null);
  const lastHoveredCodeSearchSide = ref<SearchSide | null>(null);
  const codeSearchPaneVisible = reactive<Record<SearchSide, boolean>>({
    left: false,
    right: false,
  });
  const codeSearchStates = reactive<Record<SearchSide, CodeSearchState>>({
    left: createState(),
    right: createState(),
  });
  const codeSearchMatches: Record<SearchSide, HTMLElement[]> = { left: [], right: [] };
  const pendingRefresh: Record<SearchSide, PendingRefresh | null> = { left: null, right: null };
  const debounceTimers: Record<SearchSide, ReturnType<typeof setTimeout> | null> = {
    left: null,
    right: null,
  };

  const isCodeSearchOpen = computed(
    () => codeSearchPaneVisible.left || codeSearchPaneVisible.right,
  );
  const visibleCodeSearchSides = computed(() =>
    SEARCH_SIDES.filter((side) => codeSearchPaneVisible[side]),
  );

  function createState(): CodeSearchState {
    return {
      query: "",
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      error: "",
      matchCount: 0,
      activeMatchIndex: -1,
    };
  }

  function codeElementsForSide(side: SearchSide, includeHiddenLegacy = false): HTMLElement[] {
    const container = options.containerRef.value;
    if (!container) return [];
    const controlledSide = container.querySelector<HTMLElement>(`.controlled-side-${side}`);
    if (controlledSide)
      return Array.from(controlledSide.querySelectorAll<HTMLElement>(".controlled-code"));
    const files = Array.from(
      container.querySelectorAll<HTMLElement>(".legacy-diff .d2h-file-wrapper"),
    );
    const targetFiles = includeHiddenLegacy
      ? files
      : files.filter((file) => !file.hidden).slice(0, 1);
    const index = side === "left" ? 0 : 1;
    return targetFiles.flatMap((file) => {
      const legacySide = file.querySelectorAll<HTMLElement>(".d2h-file-side-diff")[index];
      return legacySide
        ? Array.from(legacySide.querySelectorAll<HTMLElement>(".d2h-code-line-ctn"))
        : [];
    });
  }

  function clearCodeSearchHighlights(side?: SearchSide): void {
    const sides = side ? [side] : SEARCH_SIDES;
    const marks = side
      ? codeElementsForSide(side, true).flatMap((element) =>
          Array.from(element.querySelectorAll<HTMLElement>("mark.diff-search-match")),
        )
      : Array.from(
          options.containerRef.value?.querySelectorAll<HTMLElement>("mark.diff-search-match") ?? [],
        );
    const parents = new Set<Node>();
    marks.forEach((mark) => {
      if (mark.parentNode) parents.add(mark.parentNode);
      mark.replaceWith(...Array.from(mark.childNodes));
    });
    parents.forEach((parent) => parent.normalize());
    sides.forEach((targetSide) => {
      codeSearchMatches[targetSide] = [];
      codeSearchStates[targetSide].matchCount = 0;
      codeSearchStates[targetSide].activeMatchIndex = -1;
    });
  }

  function searchableCodeElements(side: SearchSide): HTMLElement[] {
    return options.isShowingMediaPreview.value ? [] : codeElementsForSide(side);
  }

  function matchingMarks(element: HTMLElement, text: string): HTMLElement[] {
    return Array.from(element.querySelectorAll<HTMLElement>("mark.diff-search-match")).filter(
      (mark) => mark.textContent === text,
    );
  }

  function captureAnchor(side: SearchSide): CodeSearchMatchAnchor | null {
    const active = codeSearchMatches[side][codeSearchStates[side].activeMatchIndex];
    if (!active || !options.containerRef.value?.contains(active)) return null;
    const codeElement = active.closest<HTMLElement>(
      ".controlled-code, .legacy-diff .d2h-code-line-ctn",
    );
    if (!codeElement) return null;
    const text = active.textContent ?? "";
    const occurrence = matchingMarks(codeElement, text).indexOf(active);
    if (occurrence < 0) return null;
    const lineElement = codeElement.closest<HTMLElement>(".controlled-line[data-side][data-line]");
    const lineSide = lineElement?.dataset.side;
    const line = Number(lineElement?.dataset.line);
    if (lineElement && (lineSide === "left" || lineSide === "right") && Number.isFinite(line)) {
      return { kind: "controlled", side: lineSide, line, text, occurrence };
    }
    const index = searchableCodeElements(side).indexOf(codeElement);
    return index >= 0 ? { kind: "legacy", side, codeElementIndex: index, text, occurrence } : null;
  }

  function anchoredMatchIndex(side: SearchSide, anchor: CodeSearchMatchAnchor): number {
    let codeElement: HTMLElement | null = null;
    if (anchor.kind === "controlled") {
      codeElement =
        Array.from(
          options.containerRef.value?.querySelectorAll<HTMLElement>(
            `.controlled-line[data-side="${anchor.side}"][data-line="${anchor.line}"] .controlled-code`,
          ) ?? [],
        )[0] ?? null;
    } else {
      const candidate = searchableCodeElements(anchor.side)[anchor.codeElementIndex];
      if (candidate?.classList.contains("d2h-code-line-ctn")) codeElement = candidate;
    }
    if (!codeElement) return -1;
    const anchored = matchingMarks(codeElement, anchor.text)[anchor.occurrence];
    return anchored ? codeSearchMatches[side].indexOf(anchored) : -1;
  }

  function quantifierAt(
    pattern: string,
    index: number,
  ): { end: number; repeatsMultipleTimes: boolean; variableLength: boolean } | null {
    const symbol = pattern[index];
    if (symbol === "*" || symbol === "+") {
      return { end: index, repeatsMultipleTimes: true, variableLength: true };
    }
    if (symbol === "?") {
      return { end: index, repeatsMultipleTimes: false, variableLength: true };
    }
    if (symbol !== "{") return null;
    const match = pattern.slice(index).match(/^\{(\d+)(?:,(\d*))?\}/);
    if (!match) return null;
    const minimum = Number(match[1]);
    const maximum = match[0].includes(",")
      ? match[2] === ""
        ? Number.POSITIVE_INFINITY
        : Number(match[2])
      : minimum;
    return {
      end: index + match[0].length - 1,
      repeatsMultipleTimes: maximum > 1,
      variableLength: maximum > minimum,
    };
  }

  function simpleRegexAtomAt(
    pattern: string,
    index: number,
  ): { end: number; signature: string } | null {
    const symbol = pattern[index];
    if (symbol === "[") {
      for (let end = index + 1; end < pattern.length; end += 1) {
        if (pattern[end] === "\\") end += 1;
        else if (pattern[end] === "]") {
          return { end, signature: pattern.slice(index, end + 1) };
        }
      }
      return null;
    }
    if (symbol === "\\") {
      const escaped = pattern[index + 1];
      if (
        !escaped ||
        escaped === "b" ||
        escaped === "B" ||
        /[1-9]/.test(escaped) ||
        (escaped === "k" && pattern[index + 2] === "<")
      ) {
        return null;
      }
      return { end: index + 1, signature: pattern.slice(index, index + 2) };
    }
    if (/^[\^$()|*+?{}]$/.test(symbol)) return null;
    const length = symbol.codePointAt(0)! > 0xffff ? 2 : 1;
    return { end: index + length - 1, signature: pattern.slice(index, index + length) };
  }

  function hasRepeatedAdjacentVariableAtoms(pattern: string): boolean {
    let previousSignature = "";
    let repetitionCount = 0;
    for (let index = 0; index < pattern.length; index += 1) {
      const atom = simpleRegexAtomAt(pattern, index);
      if (!atom) {
        previousSignature = "";
        repetitionCount = 0;
        continue;
      }
      const quantifier = quantifierAt(pattern, atom.end + 1);
      if (!quantifier?.variableLength) {
        previousSignature = "";
        repetitionCount = 0;
        index = atom.end;
        continue;
      }
      repetitionCount = atom.signature === previousSignature ? repetitionCount + 1 : 1;
      previousSignature = atom.signature;
      if (repetitionCount >= 3) return true;
      index = quantifier.end;
      if (pattern[index + 1] === "?") index += 1;
    }
    return false;
  }

  function regexSafetyError(pattern: string): string | null {
    if (pattern.length > MAX_CODE_SEARCH_REGEX_LENGTH) {
      return translate("diff.findRegexTooLong", { count: MAX_CODE_SEARCH_REGEX_LENGTH });
    }
    // Lightweight guard only: reject common adjacent-quantifier explosions without claiming
    // complete ReDoS detection or broadly rejecting valid expressions with distinct atoms.
    if (hasRepeatedAdjacentVariableAtoms(pattern)) {
      return translate("diff.findRegexUnsafe");
    }
    const frames: Array<{ hasAlternation: boolean; hasQuantifier: boolean }> = [
      { hasAlternation: false, hasQuantifier: false },
    ];
    let inClass = false;
    let lastClosed: { hasAlternation: boolean; hasQuantifier: boolean } | null = null;
    for (let index = 0; index < pattern.length; index += 1) {
      const symbol = pattern[index];
      if (inClass) {
        if (symbol === "\\") index += 1;
        else if (symbol === "]") inClass = false;
        continue;
      }
      if (symbol === "[") {
        inClass = true;
        lastClosed = null;
        continue;
      }
      if (symbol === "\\") {
        const escaped = pattern[index + 1] ?? "";
        if (/[1-9]/.test(escaped) || (escaped === "k" && pattern[index + 2] === "<")) {
          return translate("diff.findRegexBackreference");
        }
        index += 1;
        lastClosed = null;
        continue;
      }
      if (symbol === "(") {
        frames.push({ hasAlternation: false, hasQuantifier: false });
        lastClosed = null;
        if (pattern[index + 1] === "?") {
          if (pattern[index + 2] === "<" && !/[=!]/.test(pattern[index + 3] ?? "")) {
            const nameEnd = pattern.indexOf(">", index + 3);
            if (nameEnd >= 0) index = nameEnd;
          } else if (pattern[index + 2] === "<") {
            index += 3;
          } else {
            index += 2;
          }
        }
        continue;
      }
      if (symbol === ")") {
        if (frames.length > 1) {
          const group = frames.pop()!;
          const parent = frames[frames.length - 1];
          parent.hasAlternation ||= group.hasAlternation;
          parent.hasQuantifier ||= group.hasQuantifier;
          lastClosed = group;
        }
        continue;
      }
      if (symbol === "|") {
        frames[frames.length - 1].hasAlternation = true;
        lastClosed = null;
        continue;
      }
      const quantifier = quantifierAt(pattern, index);
      if (quantifier) {
        if (
          lastClosed &&
          quantifier.repeatsMultipleTimes &&
          (lastClosed.hasAlternation || lastClosed.hasQuantifier)
        ) {
          return translate("diff.findRegexUnsafe");
        }
        frames[frames.length - 1].hasQuantifier = true;
        index = quantifier.end;
        lastClosed = null;
        continue;
      }
      lastClosed = null;
    }
    return null;
  }

  function createExpression(side: SearchSide, query: string): RegExp | null {
    const state = codeSearchStates[side];
    if (state.regex) {
      const error = regexSafetyError(query);
      if (error) {
        state.error = error;
        return null;
      }
    }
    const sourceQuery = state.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const source = state.wholeWord
      ? `(?<![\\p{L}\\p{N}_])(?:${sourceQuery})(?![\\p{L}\\p{N}_])`
      : sourceQuery;
    try {
      state.error = "";
      return new RegExp(source, `gu${state.caseSensitive ? "" : "i"}`);
    } catch {
      state.error = translate("diff.findRegexInvalid");
      return null;
    }
  }

  function wrapTextRange(element: HTMLElement, start: number, end: number): HTMLElement | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes: Array<{ node: Text; start: number; end: number }> = [];
    let offset = 0;
    let current = walker.nextNode();
    while (current) {
      const node = current as Text;
      nodes.push({ node, start: offset, end: offset + node.data.length });
      offset += node.data.length;
      current = walker.nextNode();
    }
    const startEntry = nodes.find((entry) => start >= entry.start && start < entry.end);
    const endEntry = nodes.find((entry) => end > entry.start && end <= entry.end);
    if (!startEntry || !endEntry) return null;
    const range = document.createRange();
    range.setStart(startEntry.node, start - startEntry.start);
    range.setEnd(endEntry.node, end - endEntry.start);
    const mark = document.createElement("mark");
    mark.className = "diff-search-match";
    mark.append(range.extractContents());
    range.insertNode(mark);
    return mark;
  }

  function scrollMatchIntoView(match: HTMLElement): void {
    const diffScroll = options.diffScrollRef.value;
    if (diffScroll) options.scrollElementWithinContainer(match, diffScroll, "center");
    const sideScroller = match.closest<HTMLElement>(SIDE_DIFF_SELECTOR);
    if (!sideScroller) return;
    const matchRect = match.getBoundingClientRect();
    const scrollerRect = sideScroller.getBoundingClientRect();
    const matchLeft = sideScroller.scrollLeft + matchRect.left - scrollerRect.left;
    const nextScrollLeft = Math.max(
      0,
      matchLeft - Math.max(0, (sideScroller.clientWidth - matchRect.width) / 2),
    );
    if (options.isDiffSyncScrollEnabled.value) options.setSideDiffScrollLeft(nextScrollLeft);
    else options.setSideDiffScrollerScrollLeft(sideScroller, nextScrollLeft);
    options.updateTopScrollbar();
  }

  function activateMatch(side: SearchSide, index: number, shouldScroll = true): void {
    const matches = codeSearchMatches[side];
    const state = codeSearchStates[side];
    if (matches.length === 0) {
      state.activeMatchIndex = -1;
      return;
    }
    const normalized = (index + matches.length) % matches.length;
    state.activeMatchIndex = normalized;
    matches.forEach((match, matchIndex) =>
      match.classList.toggle("active", matchIndex === normalized),
    );
    if (shouldScroll) scrollMatchIntoView(matches[normalized]);
  }

  function refreshCodeSearch(
    side: SearchSide,
    preferredIndex = 0,
    shouldScroll = true,
    preferredAnchor: CodeSearchMatchAnchor | null = null,
  ): void {
    clearCodeSearchHighlights(side);
    const state = codeSearchStates[side];
    state.error = "";
    if (!state.query) return;
    const expression = createExpression(side, state.query);
    if (!expression) return;
    const elements = searchableCodeElements(side);
    if (
      state.regex &&
      elements.some(
        (element) => (element.textContent?.length ?? 0) > MAX_CODE_SEARCH_REGEX_LINE_LENGTH,
      )
    ) {
      state.error = translate("diff.findRegexLineTooLong", {
        count: MAX_CODE_SEARCH_REGEX_LINE_LENGTH,
      });
      return;
    }
    elements.forEach((element) => {
      const ranges = Array.from(
        (element.textContent ?? "").matchAll(expression),
        (match): [number, number] => [match.index ?? 0, (match.index ?? 0) + match[0].length],
      ).filter(([start, end]) => end > start);
      ranges.reverse().forEach(([start, end]) => wrapTextRange(element, start, end));
    });
    codeSearchMatches[side] = elements.flatMap((element) =>
      Array.from(element.querySelectorAll<HTMLElement>("mark.diff-search-match")),
    );
    state.matchCount = codeSearchMatches[side].length;
    const anchored = preferredAnchor ? anchoredMatchIndex(side, preferredAnchor) : -1;
    const fallback = Math.max(0, Math.min(preferredIndex, codeSearchMatches[side].length - 1));
    activateMatch(side, anchored >= 0 ? anchored : fallback, shouldScroll);
  }

  function restoreDetachedCodeSearchHighlights(): void {
    const container = options.containerRef.value;
    if (!container) return;
    SEARCH_SIDES.forEach((side) => {
      const state = codeSearchStates[side];
      if (!state.query || codeSearchMatches[side].length === 0) return;
      const hasDetachedMatch = codeSearchMatches[side].some(
        (match) => !match.isConnected || !container.contains(match),
      );
      if (!hasDetachedMatch) return;
      // Search marks live in a Vue-rendered text subtree. If a later Vue patch replaces that
      // subtree, rebuild the imperative highlights and keep navigation on the same result.
      refreshCodeSearch(side, state.activeMatchIndex, false);
    });
  }

  function preferredSide(): SearchSide {
    return options.selectedFile.value?.status === "added" ? "right" : "left";
  }

  async function openCodeSearch(side = preferredSide(), openBothSides = false): Promise<void> {
    if (openBothSides) SEARCH_SIDES.forEach((target) => (codeSearchPaneVisible[target] = true));
    else codeSearchPaneVisible[side] = true;
    await nextTick();
    const input = searchInputRefs.value.find((candidate) => candidate.dataset.searchSide === side);
    input?.focus();
    input?.select();
  }

  function cancelDebounce(side: SearchSide): boolean {
    const timer = debounceTimers[side];
    if (timer === null) return false;
    clearTimeout(timer);
    debounceTimers[side] = null;
    return true;
  }

  function closeCodeSearchSide(side: SearchSide): void {
    codeSearchPaneVisible[side] = false;
    cancelDebounce(side);
    pendingRefresh[side] = null;
    codeSearchStates[side].query = "";
    codeSearchStates[side].error = "";
    clearCodeSearchHighlights(side);
  }

  function closeCodeSearch(): void {
    SEARCH_SIDES.forEach(closeCodeSearchSide);
  }

  async function clearCodeSearchQuery(side: SearchSide): Promise<void> {
    cancelDebounce(side);
    codeSearchStates[side].query = "";
    codeSearchStates[side].error = "";
    clearCodeSearchHighlights(side);
    await nextTick();
    searchInputRefs.value.find((input) => input.dataset.searchSide === side)?.focus();
  }

  function toggleCodeSearch(): void {
    if (isCodeSearchOpen.value) {
      closeCodeSearch();
      return;
    }
    const side = lastHoveredCodeSearchSide.value;
    if (side) void openCodeSearch(side);
    else void openCodeSearch(preferredSide(), true);
  }

  function navigateCodeSearch(side: SearchSide, direction: -1 | 1): void {
    if (!codeSearchMatches[side].length) return;
    activateMatch(side, codeSearchStates[side].activeMatchIndex + direction);
  }

  function updateCodeSearchQuery(side: SearchSide, query: string): void {
    codeSearchStates[side].query = query;
  }

  function toggleCodeSearchOption(side: SearchSide, option: CodeSearchOption): void {
    codeSearchStates[side][option] = !codeSearchStates[side][option];
  }

  function handleCodeSearchKeydown(event: KeyboardEvent, side: SearchSide): void {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCodeSearchSide(side);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (cancelDebounce(side)) refreshCodeSearch(side);
      navigateCodeSearch(side, event.shiftKey ? -1 : 1);
    }
  }

  function setHoveredCodeSearchSide(side: SearchSide): void {
    hoveredCodeSearchSide.value = side;
    lastHoveredCodeSearchSide.value = side;
  }
  function clearHoveredCodeSearchSide(): void {
    hoveredCodeSearchSide.value = null;
  }
  function updateHoveredLegacyCodeSearchSide(event: PointerEvent): void {
    if (!(event.target instanceof Element)) return clearHoveredCodeSearchSide();
    const legacySide = event.target.closest<HTMLElement>(".d2h-file-side-diff");
    const file = legacySide?.closest<HTMLElement>(".d2h-file-wrapper");
    if (!legacySide || !file) return clearHoveredCodeSearchSide();
    const index = Array.from(file.querySelectorAll<HTMLElement>(".d2h-file-side-diff")).indexOf(
      legacySide,
    );
    if (index === 0) setHoveredCodeSearchSide("left");
    else if (index === 1) setHoveredCodeSearchSide("right");
    else clearHoveredCodeSearchSide();
  }

  function isEditableShortcutTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"),
    );
  }
  function handleGlobalFind(event: KeyboardEvent): void {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.shiftKey ||
      !(event.metaKey || event.ctrlKey) ||
      event.key.toLowerCase() !== "f"
    )
      return;
    if (
      !options.workspaceRef.value?.isConnected ||
      !options.canSearchCurrentFile.value ||
      options.quickComment.value
    )
      return;
    const isSearchInput =
      event.target instanceof HTMLInputElement && searchInputRefs.value.includes(event.target);
    if (isEditableShortcutTarget(event.target) && !isSearchInput) return;
    const side = isSearchInput
      ? (event.target as HTMLInputElement).dataset.searchSide === "right"
        ? "right"
        : "left"
      : (hoveredCodeSearchSide.value ?? lastHoveredCodeSearchSide.value);
    event.preventDefault();
    if (side) void openCodeSearch(side);
    else void openCodeSearch(preferredSide(), true);
  }

  function registerSearchInput(side: SearchSide, input: HTMLInputElement | null): void {
    searchInputRefs.value = searchInputRefs.value.filter(
      (candidate) => candidate.dataset.searchSide !== side,
    );
    if (input) searchInputRefs.value.push(input);
  }

  SEARCH_SIDES.forEach((side) => {
    watch(
      () => codeSearchStates[side].query,
      (query) => {
        cancelDebounce(side);
        if (!query) {
          clearCodeSearchHighlights(side);
          return;
        }
        debounceTimers[side] = setTimeout(() => {
          debounceTimers[side] = null;
          refreshCodeSearch(side);
        }, CODE_SEARCH_QUERY_DEBOUNCE_MS);
      },
      { flush: "post" },
    );
    watch(
      [
        () => codeSearchStates[side].caseSensitive,
        () => codeSearchStates[side].wholeWord,
        () => codeSearchStates[side].regex,
      ],
      async () => {
        cancelDebounce(side);
        await nextTick();
        refreshCodeSearch(side);
      },
      { flush: "post" },
    );
  });

  watch(
    [
      options.selectedFilePath,
      options.diffHtml,
      options.selectedStandardPatch,
      options.expandedContextGaps,
      options.isShowingMediaPreview,
    ],
    ([path], [previousPath]) => {
      const preserve = path === previousPath;
      SEARCH_SIDES.forEach((side) => {
        const state = codeSearchStates[side];
        if (!state.query) return;
        pendingRefresh[side] = {
          preferredIndex: preserve ? state.activeMatchIndex : 0,
          shouldScroll: !preserve,
          preferredAnchor: preserve ? captureAnchor(side) : null,
        };
      });
    },
  );
  watch(
    [
      options.selectedFilePath,
      options.diffHtml,
      options.selectedStandardPatch,
      options.expandedContextGaps,
      options.isShowingMediaPreview,
    ],
    async () => {
      const refreshes = SEARCH_SIDES.map((side) => {
        const state = codeSearchStates[side];
        if (!state.query) {
          pendingRefresh[side] = null;
          clearCodeSearchHighlights(side);
          return null;
        }
        const refresh = pendingRefresh[side] ?? {
          preferredIndex: 0,
          shouldScroll: true,
          preferredAnchor: null,
        };
        pendingRefresh[side] = null;
        cancelDebounce(side);
        return { side, refresh };
      });
      await nextTick();
      refreshes.forEach(
        (entry) =>
          entry &&
          refreshCodeSearch(
            entry.side,
            entry.refresh.preferredIndex,
            entry.refresh.shouldScroll,
            entry.refresh.preferredAnchor,
          ),
      );
    },
    { flush: "post" },
  );

  watch(options.canSearchCurrentFile, (canSearch) => {
    if (!canSearch) closeCodeSearch();
  });

  onUnmounted(() => {
    SEARCH_SIDES.forEach((side) => {
      cancelDebounce(side);
      pendingRefresh[side] = null;
      codeSearchMatches[side] = [];
    });
    document.removeEventListener("keydown", handleGlobalFind);
  });
  onMounted(() => document.addEventListener("keydown", handleGlobalFind));
  onUpdated(restoreDetachedCodeSearchHighlights);

  return {
    searchInputRefs,
    registerSearchInput,
    hoveredCodeSearchSide,
    codeSearchPaneVisible,
    codeSearchStates,
    isCodeSearchOpen,
    visibleCodeSearchSides,
    openCodeSearch,
    toggleCodeSearch,
    closeCodeSearch,
    closeCodeSearchSide,
    clearCodeSearchQuery,
    navigateCodeSearch,
    updateCodeSearchQuery,
    toggleCodeSearchOption,
    handleCodeSearchKeydown,
    setHoveredCodeSearchSide,
    clearHoveredCodeSearchSide,
    updateHoveredLegacyCodeSearchSide,
    clearCodeSearchHighlights,
    cancelCodeSearchQueryDebounce: cancelDebounce,
  };
}
