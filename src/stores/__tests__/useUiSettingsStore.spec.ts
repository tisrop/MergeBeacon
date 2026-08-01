import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { setAppLocale } from "@/i18n";
import { useUiSettingsStore } from "@/stores/useUiSettingsStore";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

describe("useUiSettingsStore languages", () => {
  beforeEach(() => {
    storage.clear();
    setAppLocale("zh-CN");
    setActivePinia(createPinia());
  });

  it("persists interface language changes through the shared i18n state", async () => {
    const store = useUiSettingsStore();

    store.setLocale("en-US");
    await nextTick();

    expect(store.locale).toBe("en-US");
    expect(storage.get("mergebeacon:locale")).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("restores a manual AI review language preference", () => {
    storage.set("mergebeacon:ai-review-language", "en-US");

    expect(useUiSettingsStore().aiReviewLanguagePreference).toBe("en-US");
  });

  it("falls back to auto for invalid preferences and removes storage when auto is selected", () => {
    storage.set("mergebeacon:ai-review-language", "fr-FR");
    const store = useUiSettingsStore();

    expect(store.aiReviewLanguagePreference).toBe("auto");

    store.setAiReviewLanguagePreference("zh-CN");
    expect(storage.get("mergebeacon:ai-review-language")).toBe("zh-CN");

    store.setAiReviewLanguagePreference("auto");
    expect(store.aiReviewLanguagePreference).toBe("auto");
    expect(storage.has("mergebeacon:ai-review-language")).toBe(false);
  });
});
