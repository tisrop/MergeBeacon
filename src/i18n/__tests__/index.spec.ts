import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const storage = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

describe("i18n", () => {
  beforeEach(() => {
    storage.clear();
    document.documentElement.lang = "";
    vi.resetModules();
  });

  it("defaults to Simplified Chinese and interpolates translation parameters", async () => {
    const { currentLocale, translate } = await import("@/i18n");

    expect(currentLocale()).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(translate("settings.currentVersion", { version: "0.11.0" })).toBe("当前版本：0.11.0");
    expect(translate("settings.currentVersion", {}, "en-US")).toBe("Current version: {version}");
  });

  it("restores a persisted locale and updates storage and the document language", async () => {
    storage.set("mergebeacon:locale", "en-US");
    const { currentLocale, setAppLocale } = await import("@/i18n");

    expect(currentLocale()).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");

    setAppLocale("zh-CN");
    await nextTick();

    expect(currentLocale()).toBe("zh-CN");
    expect(storage.get("mergebeacon:locale")).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("ignores an unsupported persisted locale", async () => {
    storage.set("mergebeacon:locale", "fr-FR");

    const { currentLocale } = await import("@/i18n");

    expect(currentLocale()).toBe("zh-CN");
  });
});
