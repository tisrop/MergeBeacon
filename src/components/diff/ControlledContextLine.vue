<script setup lang="ts">
import type { PatchLine } from "@/types";

/**
 * DiffViewer 中受控渲染的单行上下文行。
 *
 * 抽自 DiffViewer 四处逐字节相同的 gap 上下文行渲染；DOM 结构与内联版本
 * 完全一致，DiffViewer 测试对 `.controlled-context-line` 等类名的断言保持不变。
 */
interface ContextRow {
  key: string;
  left: PatchLine | null;
  right: PatchLine | null;
}

defineProps<{
  row: ContextRow;
  side: "left" | "right";
  highlighted: boolean;
}>();
</script>

<template>
  <div
    class="controlled-line controlled-context-line"
    :class="{ 'diff-location-highlight': highlighted }"
    :data-side="side"
    :data-line="side === 'left' ? row.left?.old_line : row.right?.new_line"
  >
    <span class="controlled-line-number" aria-hidden="true">
      {{ side === "left" ? row.left?.old_line : row.right?.new_line }}
    </span>
    <span class="controlled-line-marker" aria-hidden="true"> </span>
    <code class="controlled-code">{{
      (side === "left" ? row.left : row.right)?.content ?? ""
    }}</code>
  </div>
</template>
