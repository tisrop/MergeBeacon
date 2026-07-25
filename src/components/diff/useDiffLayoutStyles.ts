import { nextTick, onScopeDispose, watch, type Ref } from "vue";
import { createDynamicCssClass, getStaticCssClass } from "@/composables/useDynamicCssClass";

interface DiffViewportStyleOptions {
  navigatorWidth: Ref<number>;
  topScrollbarContentWidth: Ref<number>;
  independentTopScrollbarWidths: Ref<[number, number]>;
}

interface QuickCommentCoordinates {
  x: number;
  y: number;
}

interface DiffPopupStyleOptions {
  popupRef: Ref<HTMLElement | null>;
  quickComment: Ref<QuickCommentCoordinates | null>;
}

/** Moves measured Diff layout values out of template bindings and into generated CSS classes. */
export function useDiffViewportStyles(options: DiffViewportStyleOptions) {
  const workspace = createDynamicCssClass("diff-workspace");
  const unifiedScrollbarContent = createDynamicCssClass("diff-unified-scrollbar-content");
  const leftScrollbarContent = createDynamicCssClass("diff-left-scrollbar-content");
  const rightScrollbarContent = createDynamicCssClass("diff-right-scrollbar-content");

  watch(
    options.navigatorWidth,
    (width) => workspace.update({ "--navigator-width": `${width}px` }),
    { immediate: true },
  );
  watch(
    options.topScrollbarContentWidth,
    (width) => unifiedScrollbarContent.update({ width: `${width}px` }),
    { immediate: true },
  );
  watch(
    () => options.independentTopScrollbarWidths.value[0],
    (width) => leftScrollbarContent.update({ width: `${width}px` }),
    { immediate: true },
  );
  watch(
    () => options.independentTopScrollbarWidths.value[1],
    (width) => rightScrollbarContent.update({ width: `${width}px` }),
    { immediate: true },
  );

  onScopeDispose(() => {
    workspace.dispose();
    unifiedScrollbarContent.dispose();
    leftScrollbarContent.dispose();
    rightScrollbarContent.dispose();
  });

  return {
    workspaceClass: workspace.className,
    unifiedScrollbarContentClass: unifiedScrollbarContent.className,
    leftScrollbarContentClass: leftScrollbarContent.className,
    rightScrollbarContentClass: rightScrollbarContent.className,
    treeRowDepthClass(depth: number): string {
      return getStaticCssClass("diff-tree-depth", { "--tree-depth": `${Math.max(1, depth)}` });
    },
  };
}

/** Positions the teleported quick-comment panel without a Vue template style binding. */
export function useDiffPopupStyle(options: DiffPopupStyleOptions) {
  const popup = createDynamicCssClass("diff-quick-comment-popup");

  async function positionPopup(): Promise<void> {
    const comment = options.quickComment.value;
    if (!comment) return;

    let left = comment.x;
    let top = comment.y - 8;
    popup.update({ left: `${left}px`, top: `${top}px` });
    await nextTick();

    const element = options.popupRef.value;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const overflowRight = rect.right - window.innerWidth;
    const overflowBottom = rect.bottom - window.innerHeight;
    if (overflowRight > 0) left = Math.max(0, rect.left - overflowRight);
    if (overflowBottom > 0) top = Math.max(0, rect.top - overflowBottom);
    popup.update({ left: `${left}px`, top: `${top}px` });
  }

  onScopeDispose(() => popup.dispose());

  return { popupPositionClass: popup.className, positionPopup };
}
