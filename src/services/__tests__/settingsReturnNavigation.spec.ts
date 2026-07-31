import { describe, expect, it } from "vitest";
import { recordSettingsEntry, takeSettingsReturnLocation } from "../settingsReturnNavigation";

describe("settingsReturnNavigation", () => {
  it("记录进入设置页前的完整路由并在读取后清除", () => {
    recordSettingsEntry("settings", "pr-detail", "/pr/github/acme/repo/42?tab=diff");

    expect(takeSettingsReturnLocation()).toBe("/pr/github/acme/repo/42?tab=diff");
    expect(takeSettingsReturnLocation()).toBeNull();
  });

  it("设置页内切换 hash 时保留原始来源", () => {
    recordSettingsEntry("settings", "pr-list", "/pr");
    recordSettingsEntry("settings", "settings", "/settings");

    expect(takeSettingsReturnLocation()).toBe("/pr");
  });

  it("直接进入设置页时清除之前的来源", () => {
    recordSettingsEntry("settings", "pr-list", "/pr");
    recordSettingsEntry("settings", undefined, "/");

    expect(takeSettingsReturnLocation()).toBeNull();
  });
});
