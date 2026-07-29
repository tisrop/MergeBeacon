import { getStaticCssClass } from "@/composables/useDynamicCssClass";

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DARK_LABEL_TEXT = "#1f2328";
const LIGHT_LABEL_TEXT = "#ffffff";

function normalizedHex(color: string | null | undefined): string | undefined {
  const match = color?.trim().match(HEX_COLOR_PATTERN);
  if (!match) return undefined;
  return `#${match[1].toLowerCase()}`;
}

/**
 * Converts a trusted platform label color into a generated CSS class. This keeps arbitrary label
 * colors out of Vue template style bindings while preserving the platform-provided color.
 */
export function labelColorClass(color: string | null | undefined): string | undefined {
  const normalized = normalizedHex(color);
  if (!normalized) return undefined;
  return getStaticCssClass("label-color", { "background-color": normalized });
}

function relativeLuminance(red: number, green: number, blue: number): number {
  const [linearRed, linearGreen, linearBlue] = [red, green, blue].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return linearRed * 0.2126 + linearGreen * 0.7152 + linearBlue * 0.0722;
}

function contrastRatio(first: number, second: number): number {
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Renders a GitHub-style label with its original background and readable foreground color. */
export function labelTagColorClass(color: string | null | undefined): string | undefined {
  const normalized = normalizedHex(color);
  if (!normalized) return undefined;

  const raw = normalized.slice(1);
  const opaque = raw.length === 8 ? raw.slice(0, 6) : raw;
  const expanded =
    opaque.length === 3
      ? opaque
          .split("")
          .map((value) => value + value)
          .join("")
      : opaque;
  const [red, green, blue] = [0, 2, 4].map((offset) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16),
  );
  const backgroundLuminance = relativeLuminance(red, green, blue);
  const darkTextLuminance = relativeLuminance(31, 35, 40);
  const darkContrast = contrastRatio(backgroundLuminance, darkTextLuminance);
  const lightContrast = contrastRatio(backgroundLuminance, 1);

  return getStaticCssClass("label-tag-color", {
    "--label-tag-background": normalized,
    "--label-tag-foreground": darkContrast >= lightContrast ? DARK_LABEL_TEXT : LIGHT_LABEL_TEXT,
  });
}
