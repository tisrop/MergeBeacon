import { getStaticCssClass } from "@/composables/useDynamicCssClass";

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Converts a trusted platform label color into a generated CSS class. This keeps arbitrary label
 * colors out of Vue template style bindings while preserving the platform-provided color.
 */
export function labelColorClass(color: string | null | undefined): string | undefined {
  const match = color?.trim().match(HEX_COLOR_PATTERN);
  if (!match) return undefined;

  const normalized = `#${match[1].toLowerCase()}`;
  return getStaticCssClass("label-color", { "background-color": normalized });
}
