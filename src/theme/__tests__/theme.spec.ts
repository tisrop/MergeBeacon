import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

const storageStub = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

vi.stubGlobal("localStorage", storageStub);

type MutableMedia = {
  matches: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const media: MutableMedia = {
    matches: initialMatches,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => media),
  );
  return {
    setMatches(matches: boolean) {
      media.matches = matches;
    },
    emitChange() {
      for (const listener of listeners) listener();
    },
  };
}

async function importThemeModule() {
  vi.resetModules();
  return await import("@/theme");
}

describe("theme", () => {
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", storageStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", storageStub);
    storage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("默认跟随系统并在浅色系统下解析为浅色", async () => {
    stubMatchMedia(false);
    const theme = await importThemeModule();

    expect(theme.currentThemeMode()).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("系统偏好为深色时，system 模式解析为深色", async () => {
    stubMatchMedia(true);
    const theme = await importThemeModule();

    expect(theme.currentThemeMode()).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("从本地存储恢复上次的模式选择，非法值回退 system", async () => {
    storage.set("mergebeacon:theme", "dark");
    stubMatchMedia(false);
    const theme = await importThemeModule();

    expect(theme.currentThemeMode()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    storage.set("mergebeacon:theme", "neon");
    const fallback = await importThemeModule();
    expect(fallback.currentThemeMode()).toBe("system");
  });

  it("手动切换立即应用并持久化", async () => {
    stubMatchMedia(false);
    const theme = await importThemeModule();

    theme.setThemeMode("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(storage.get("mergebeacon:theme")).toBe("dark");

    theme.setThemeMode("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(storage.get("mergebeacon:theme")).toBe("light");
  });

  it("system 模式下系统偏好变化实时跟随", async () => {
    const media = stubMatchMedia(false);
    const theme = await importThemeModule();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    media.setMatches(true);
    media.emitChange();

    expect(theme.currentThemeMode()).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("固定模式不受系统偏好变化影响", async () => {
    const media = stubMatchMedia(false);
    const theme = await importThemeModule();
    theme.setThemeMode("light");
    expect(storage.get("mergebeacon:theme")).toBe("light");

    media.setMatches(true);
    media.emitChange();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("initTheme 重新确认当前解析结果", async () => {
    stubMatchMedia(true);
    const theme = await importThemeModule();
    document.documentElement.removeAttribute("data-theme");

    theme.initTheme();

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
