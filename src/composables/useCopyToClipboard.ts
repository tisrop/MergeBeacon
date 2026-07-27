import { getCurrentInstance, onUnmounted, ref } from "vue";
import { clipboardWriteText } from "@/api";
import { getErrorMessage } from "@/utils/error";

/** 复制成功提示的停留时长：足够被看到，又不会长期占住图标状态。 */
const COPIED_STATE_DURATION = 1500;

/**
 * 图标式复制按钮的状态编排。
 *
 * 复制经由 `src/api/index.ts` 交给原生剪贴板插件完成，组件只消费这里的
 * copying / copied / errorMessage 三个状态，并在卸载时清理成功提示计时器。
 */
export function useCopyToClipboard(fallbackErrorMessage = "复制失败") {
  const copying = ref(false);
  const copied = ref(false);
  const errorMessage = ref("");
  let copiedResetHandle: ReturnType<typeof setTimeout> | null = null;

  function clearCopiedReset(): void {
    if (copiedResetHandle === null) return;
    clearTimeout(copiedResetHandle);
    copiedResetHandle = null;
  }

  async function copy(text: string): Promise<boolean> {
    if (copying.value) return false;
    clearCopiedReset();
    copying.value = true;
    copied.value = false;
    errorMessage.value = "";
    try {
      await clipboardWriteText(text);
      copied.value = true;
      copiedResetHandle = setTimeout(() => {
        copiedResetHandle = null;
        copied.value = false;
      }, COPIED_STATE_DURATION);
      return true;
    } catch (error) {
      errorMessage.value = getErrorMessage(error, fallbackErrorMessage);
      return false;
    } finally {
      copying.value = false;
    }
  }

  /** 目标切换时立即回到初始状态，避免上一个目标的结果被误读成当前目标的结果。 */
  function resetCopyState(): void {
    clearCopiedReset();
    copied.value = false;
    errorMessage.value = "";
  }

  if (getCurrentInstance()) onUnmounted(clearCopiedReset);

  return { copying, copied, errorMessage, copy, resetCopyState };
}
