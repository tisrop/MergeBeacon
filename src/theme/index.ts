import { readonly, ref } from "vue";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "mergebeacon:theme";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // Storage is optional; system preference remains the session default.
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  return systemPrefersDark() ? "dark" : "light";
}

function persistMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // The reactive setting remains valid for this session.
  }
}

const activeMode = ref<ThemeMode>(readStoredMode());
const resolvedTheme = ref<ResolvedTheme>(resolveTheme(activeMode.value));

function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

function handleSystemChange(): void {
  if (activeMode.value !== "system") return;
  resolvedTheme.value = resolveTheme("system");
  applyResolvedTheme(resolvedTheme.value);
}

if (typeof window.matchMedia === "function") {
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener?.("change", handleSystemChange);
}

export function setThemeMode(mode: ThemeMode): void {
  activeMode.value = mode;
  resolvedTheme.value = resolveTheme(mode);
  applyResolvedTheme(resolvedTheme.value);
  persistMode(mode);
}

export function useTheme() {
  return {
    mode: readonly(activeMode),
    resolved: readonly(resolvedTheme),
    setMode: setThemeMode,
  };
}

export function currentThemeMode(): ThemeMode {
  return activeMode.value;
}

/** Re-asserts the resolved theme on the document root; called once during app startup. */
export function initTheme(): void {
  applyResolvedTheme(resolvedTheme.value);
}

initTheme();
