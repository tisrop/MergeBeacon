const LEGACY_KEY_PREFIX = "mergepilot:";

/**
 * 读取 JSON 存储；解析失败或缺失时返回 fallback。
 * 持久化不可用时保持内存值可用，调用方不应依赖这里的抛错。
 */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is best effort; the in-memory value remains usable.
  }
}

/**
 * 读取字符串存储；缺失时尝试迁移旧 `mergepilot:` 前缀 key。
 * 旧值先复制到新 key 再删除，迁移失败不影响新 key 的可用性。
 */
export function readStorageString(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    if (value !== null) return value;
    const legacyKey = key.replace("mergebeacon:", LEGACY_KEY_PREFIX);
    const legacyValue = localStorage.getItem(legacyKey);
    if (legacyValue !== null) {
      localStorage.setItem(key, legacyValue);
      localStorage.removeItem(legacyKey);
    }
    return legacyValue;
  } catch {
    return null;
  }
}

export function writeStorageString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the in-memory value usable when persistence is unavailable.
  }
}
