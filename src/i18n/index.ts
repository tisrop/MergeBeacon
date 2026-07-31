import { computed, readonly, ref, watch } from "vue";
import { enUS, type MessageKey, zhCN } from "./messages";

export type AppLocale = "zh-CN" | "en-US";
export type TranslationParams = Record<string, string | number>;

export const APP_LOCALE_STORAGE_KEY = "mergebeacon:locale";

function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en-US";
}

function readInitialLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(APP_LOCALE_STORAGE_KEY);
    if (isAppLocale(stored)) return stored;
  } catch {
    // Storage is optional; browser language remains a stable session default.
  }
  return "zh-CN";
}

const activeLocale = ref<AppLocale>(readInitialLocale());
const messages = { "zh-CN": zhCN, "en-US": enUS } as const;

export function translate(
  key: MessageKey,
  params: TranslationParams = {},
  locale: AppLocale = activeLocale.value,
): string {
  return messages[locale][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder,
  );
}

export function setAppLocale(locale: AppLocale): void {
  activeLocale.value = locale;
  try {
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale);
  } catch {
    // The reactive setting remains valid for this session.
  }
}

export function useI18n() {
  return {
    locale: readonly(activeLocale),
    isEnglish: computed(() => activeLocale.value === "en-US"),
    t: translate,
    setLocale: setAppLocale,
  };
}

export function currentLocale(): AppLocale {
  return activeLocale.value;
}

watch(
  activeLocale,
  (locale) => {
    document.documentElement.lang = locale;
    document.title = "MergeBeacon";
  },
  { immediate: true },
);
