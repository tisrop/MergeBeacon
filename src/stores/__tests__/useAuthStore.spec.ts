import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authCheck, authHasToken, authLogin, authLogout } from "@/api";
import { useAuthStore } from "@/stores/useAuthStore";

const storage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock("@/api", () => ({
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  authCheck: vi.fn(),
  authHasToken: vi.fn(),
}));

const user = { id: 1, login: "saved-user", name: "Saved User", avatar_url: "" };

describe("useAuthStore session restore", () => {
  beforeEach(() => {
    storage.clear();
    setActivePinia(createPinia());
  });

  it("优先恢复上次使用的平台", async () => {
    storage.set("mergepilot:activePlatform", "gitlab");
    vi.mocked(authHasToken).mockResolvedValue(true);
    vi.mocked(authCheck).mockResolvedValue(user);
    const store = useAuthStore();

    expect(await store.restoreSession()).toBe(true);
    expect(authHasToken).toHaveBeenCalledWith("gitlab");
    expect(store.activePlatform).toBe("gitlab");
    expect(store.activeUser?.login).toBe("saved-user");
  });

  it("上次平台无 Token 时恢复其他已登录平台", async () => {
    storage.set("mergepilot:activePlatform", "github");
    vi.mocked(authHasToken).mockImplementation(async (platform) => platform === "gitee");
    vi.mocked(authCheck).mockResolvedValue(user);
    const store = useAuthStore();

    expect(await store.restoreSession()).toBe(true);
    expect(store.activePlatform).toBe("gitee");
    expect(store.platforms.gitee.isLoggedIn).toBe(true);
    expect(storage.get("mergepilot:activePlatform")).toBe("gitee");
  });
  it("指定未登录平台时不回退到其他已登录平台", async () => {
    storage.set("mergepilot:activePlatform", "gitee");
    vi.mocked(authHasToken).mockImplementation(async (platform) => platform === "github");
    vi.mocked(authCheck).mockResolvedValue(user);
    const store = useAuthStore();
    store.platforms.github = { user, isLoggedIn: true };

    expect(await store.restorePlatformSession("gitee")).toBe(false);
    expect(authHasToken).toHaveBeenCalledWith("gitee");
    expect(authCheck).not.toHaveBeenCalledWith("github");
    expect(store.activePlatform).toBe("gitee");
  });

  it("登录状态按平台隔离，登出一个平台不影响其他平台", async () => {
    const githubUser = { ...user, id: 1, login: "github-user" };
    const gitlabUser = { ...user, id: 2, login: "gitlab-user" };
    vi.mocked(authLogin)
      .mockResolvedValueOnce({ user: githubUser, credential_storage: "system_keyring" })
      .mockResolvedValueOnce({ user: gitlabUser, credential_storage: "encrypted_file" });
    vi.mocked(authLogout).mockResolvedValue(undefined);
    const store = useAuthStore();

    await store.login("github", "github-token");
    await store.login("gitlab", "gitlab-token");
    await store.logout("github");

    expect(store.platforms.github).toEqual({ user: null, isLoggedIn: false });
    expect(store.platforms.gitlab).toEqual({ user: gitlabUser, isLoggedIn: true });
    expect(store.activePlatform).toBe("gitlab");
    expect(store.activeUser?.login).toBe("gitlab-user");
  });
});
