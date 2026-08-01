import { isDesktopRuntime, setNativeMenuLabels } from "@/api";
import { translate, type AppLocale } from "@/i18n";
import type { NativeMenuLabels } from "@/types";

export function buildNativeMenuLabels(locale: AppLocale): NativeMenuLabels {
  const t = (key: Parameters<typeof translate>[0]) => translate(key, {}, locale);
  return {
    about: t("menu.about"),
    check_updates: t("menu.checkUpdates"),
    settings: t("menu.settings"),
    quit: t("menu.quit"),
    file: t("menu.file"),
    new_pull_request: t("menu.newPullRequest"),
    new_issue: t("menu.newIssue"),
    close_window: t("menu.closeWindow"),
    edit: t("menu.edit"),
    undo: t("menu.undo"),
    redo: t("menu.redo"),
    cut: t("menu.cut"),
    copy: t("menu.copy"),
    paste: t("menu.paste"),
    select_all: t("menu.selectAll"),
    view: t("menu.view"),
    command_palette: t("menu.commandPalette"),
    reload: t("menu.reload"),
    enter_fullscreen: t("menu.enterFullscreen"),
    window: t("menu.window"),
    minimize: t("menu.minimize"),
    maximize: t("menu.maximize"),
    help: t("menu.help"),
    github_homepage: t("menu.githubHomepage"),
    report_issue: t("menu.reportIssue"),
    release_notes: t("menu.releaseNotes"),
    diagnostics: t("menu.diagnostics"),
  };
}

export async function syncNativeMenuLabels(locale: AppLocale): Promise<void> {
  if (!isDesktopRuntime()) return;
  await setNativeMenuLabels(buildNativeMenuLabels(locale));
}
