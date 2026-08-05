import { nextTick, onUnmounted, ref, watch, type Ref } from "vue";
import { createDynamicCssClass, type DynamicCssClass } from "@/composables/useDynamicCssClass";

export type DropdownPlacement = "up" | "down";

export interface SelectDropdownPlacementOptions {
  /** 下拉是否展开；为 false 时跳过计算并移除监听器。 */
  open: Ref<boolean>;
  /** 触发器元素 ref，用于测量位置。 */
  triggerRef: Ref<HTMLElement | null>;
  /** 下拉面板元素 ref，用于测量内容高度。 */
  dropdownRef: Ref<HTMLElement | null>;
  /** createDynamicCssClass 的前缀，用于生成隔离的动态 class。 */
  cssPrefix: string;
  /** 写入动态 max-height 的 CSS 变量名（如 `--app-select-dropdown-max-height`）。 */
  cssVarName: string;
  /** 内容变化时需要重新测量的依赖（如 filteredOptions）；可选。 */
  recalcTrigger?: Ref<unknown>;
}

/** 下拉面板期望/上限高度（px）。 */
const PLACEMENT_MAX_HEIGHT = 280;
/** 下拉面板最小可见高度（px），空间不足时作为 clamp 下界。 */
const PLACEMENT_MIN_HEIGHT = 64;
/** 触发器与面板之间的间距（px）。 */
const PLACEMENT_GAP = 4;

/**
 * 计算元素在所有 overflow 祖先裁剪后的可视垂直区间。
 * z-index 无法逃逸 overflow 裁剪，因此必须沿祖先链收缩 top/bottom 边界。
 */
export function verticalClippingBoundary(element: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  let ancestor = element.parentElement;
  while (ancestor) {
    const computedStyle = window.getComputedStyle(ancestor);
    const overflow = `${computedStyle.overflow} ${computedStyle.overflowY}`;
    if (/auto|scroll|hidden|clip/.test(overflow)) {
      const rect = ancestor.getBoundingClientRect();
      top = Math.max(top, rect.top);
      bottom = Math.min(bottom, rect.bottom);
    }
    ancestor = ancestor.parentElement;
  }
  return { top, bottom };
}

/**
 * 共享的下拉浮层定位逻辑：根据触发器与可视边界计算向上/向下弹出方向，
 * 并把按可用空间 clamp 后的 max-height 写入隔离的动态 CSS 变量。
 * 自动监听 resize/scroll/内容变化重新计算，并在卸载时清理监听器与动态样式。
 *
 * 必须在组件 setup 期间调用（内部使用 watch/onUnmounted）。
 */
export function useSelectDropdownPlacement(options: SelectDropdownPlacementOptions): {
  dropdownPlacement: Ref<DropdownPlacement>;
  dropdownCssClass: DynamicCssClass;
  updateDropdownPlacement: () => void;
} {
  const dropdownPlacement = ref<DropdownPlacement>("down");
  const dropdownCssClass = createDynamicCssClass(options.cssPrefix);
  // 记忆上次写入的 placement:maxHeight，未变化时跳过 dropdownCssClass.update，
  // 避免 dropdown 打开期间高频 scroll/resize 反复重建共享动态样式表（renderRules 会重写整段 textContent）。
  let lastPlacementKey: string | null = null;

  function updateDropdownPlacement(): void {
    if (!options.open.value || !options.triggerRef.value || !options.dropdownRef.value) return;
    const triggerRect = options.triggerRef.value.getBoundingClientRect();
    const boundary = verticalClippingBoundary(options.triggerRef.value);
    const spaceAbove = Math.max(0, triggerRect.top - boundary.top - PLACEMENT_GAP);
    const spaceBelow = Math.max(0, boundary.bottom - triggerRect.bottom - PLACEMENT_GAP);
    const desiredHeight = Math.min(
      options.dropdownRef.value.scrollHeight || PLACEMENT_MAX_HEIGHT,
      PLACEMENT_MAX_HEIGHT,
    );
    const placement: DropdownPlacement =
      spaceBelow < desiredHeight && spaceAbove > spaceBelow ? "up" : "down";
    const availableSpace = placement === "up" ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(
      PLACEMENT_MIN_HEIGHT,
      Math.min(PLACEMENT_MAX_HEIGHT, Math.floor(availableSpace)),
    );
    const placementKey = `${placement}:${maxHeight}`;
    if (placementKey === lastPlacementKey) return;
    lastPlacementKey = placementKey;
    dropdownPlacement.value = placement;
    dropdownCssClass.update({ [options.cssVarName]: `${maxHeight}px` });
  }

  function addPlacementListeners(): void {
    window.addEventListener("resize", updateDropdownPlacement);
    document.addEventListener("scroll", updateDropdownPlacement, true);
  }

  function removePlacementListeners(): void {
    window.removeEventListener("resize", updateDropdownPlacement);
    document.removeEventListener("scroll", updateDropdownPlacement, true);
  }

  watch(options.open, async (isOpen) => {
    removePlacementListeners();
    if (!isOpen) {
      // 关闭后重置缓存，确保下次打开无论几何是否与上次相同都重新写入。
      lastPlacementKey = null;
      return;
    }
    await nextTick();
    updateDropdownPlacement();
    addPlacementListeners();
  });

  if (options.recalcTrigger) {
    watch(options.recalcTrigger, async () => {
      if (!options.open.value) return;
      await nextTick();
      updateDropdownPlacement();
    });
  }

  onUnmounted(() => {
    removePlacementListeners();
    dropdownCssClass.dispose();
  });

  return { dropdownPlacement, dropdownCssClass, updateDropdownPlacement };
}
