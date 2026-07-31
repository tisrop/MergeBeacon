use serde::Deserialize;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub const GITHUB_HOMEPAGE_URL: &str = "https://github.com/tisrop/MergeBeacon";
pub const GITHUB_ISSUES_URL: &str = "https://github.com/tisrop/MergeBeacon/issues/new/choose";
pub const GITHUB_RELEASES_URL: &str = "https://github.com/tisrop/MergeBeacon/releases";

pub const OPEN_COMMAND_PALETTE_ID: &str = "open-command-palette";
pub const OPEN_SETTINGS_ID: &str = "open-settings";
pub const CHECK_UPDATES_ID: &str = "check-updates";
pub const NEW_PULL_REQUEST_ID: &str = "new-pull-request";
pub const NEW_ISSUE_ID: &str = "new-issue";
pub const RELOAD_WINDOW_ID: &str = "reload-window";
pub const OPEN_GITHUB_HOMEPAGE_ID: &str = "open-github-homepage";
pub const REPORT_ISSUE_ID: &str = "report-issue";
pub const OPEN_RELEASE_NOTES_ID: &str = "open-release-notes";
pub const OPEN_DIAGNOSTICS_ID: &str = "open-diagnostics";

const MAX_LABEL_CHARS: usize = 80;

#[derive(Debug, Deserialize, PartialEq, Eq)]
pub struct NativeMenuLabels {
    about: String,
    check_updates: String,
    settings: String,
    quit: String,
    file: String,
    new_pull_request: String,
    new_issue: String,
    close_window: String,
    edit: String,
    undo: String,
    redo: String,
    cut: String,
    copy: String,
    paste: String,
    select_all: String,
    view: String,
    command_palette: String,
    reload: String,
    enter_fullscreen: String,
    window: String,
    minimize: String,
    maximize: String,
    help: String,
    github_homepage: String,
    report_issue: String,
    release_notes: String,
    diagnostics: String,
}

impl NativeMenuLabels {
    pub fn simplified_chinese() -> Self {
        Self {
            about: "关于 MergeBeacon".into(),
            check_updates: "检查更新...".into(),
            settings: "设置...".into(),
            quit: "退出 MergeBeacon".into(),
            file: "文件".into(),
            new_pull_request: "新建 PR / MR...".into(),
            new_issue: "新建 Issue...".into(),
            close_window: "关闭窗口".into(),
            edit: "编辑".into(),
            undo: "撤销".into(),
            redo: "重做".into(),
            cut: "剪切".into(),
            copy: "复制".into(),
            paste: "粘贴".into(),
            select_all: "全选".into(),
            view: "视图".into(),
            command_palette: "命令面板...".into(),
            reload: "重新加载".into(),
            enter_fullscreen: "进入全屏".into(),
            window: "窗口".into(),
            minimize: "最小化".into(),
            maximize: "最大化".into(),
            help: "帮助".into(),
            github_homepage: "GitHub 主页".into(),
            report_issue: "报告问题...".into(),
            release_notes: "版本更新记录".into(),
            diagnostics: "诊断信息...".into(),
        }
    }

    fn values(&self) -> [(&'static str, &str); 27] {
        [
            ("about", &self.about),
            ("check_updates", &self.check_updates),
            ("settings", &self.settings),
            ("quit", &self.quit),
            ("file", &self.file),
            ("new_pull_request", &self.new_pull_request),
            ("new_issue", &self.new_issue),
            ("close_window", &self.close_window),
            ("edit", &self.edit),
            ("undo", &self.undo),
            ("redo", &self.redo),
            ("cut", &self.cut),
            ("copy", &self.copy),
            ("paste", &self.paste),
            ("select_all", &self.select_all),
            ("view", &self.view),
            ("command_palette", &self.command_palette),
            ("reload", &self.reload),
            ("enter_fullscreen", &self.enter_fullscreen),
            ("window", &self.window),
            ("minimize", &self.minimize),
            ("maximize", &self.maximize),
            ("help", &self.help),
            ("github_homepage", &self.github_homepage),
            ("report_issue", &self.report_issue),
            ("release_notes", &self.release_notes),
            ("diagnostics", &self.diagnostics),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        for (name, value) in self.values() {
            if value.trim().is_empty() {
                return Err(format!("menu label {name} cannot be empty"));
            }
            if value.chars().count() > MAX_LABEL_CHARS {
                return Err(format!("menu label {name} is too long"));
            }
            if value.chars().any(char::is_control) {
                return Err(format!("menu label {name} contains control characters"));
            }
        }
        Ok(())
    }
}

pub fn install(app: &AppHandle, labels: NativeMenuLabels) -> Result<(), String> {
    labels.validate()?;
    let menu = build_menu(app, &labels).map_err(|error| format!("failed to build native menu: {error}"))?;
    app.set_menu(menu).map_err(|error| format!("failed to install native menu: {error}"))?;
    Ok(())
}

fn build_menu(app: &AppHandle, labels: &NativeMenuLabels) -> tauri::Result<Menu<Wry>> {
    let command_palette =
        MenuItem::with_id(app, OPEN_COMMAND_PALETTE_ID, &labels.command_palette, true, Some("CmdOrCtrl+K"))?;
    let settings = MenuItem::with_id(app, OPEN_SETTINGS_ID, &labels.settings, true, Some("CmdOrCtrl+,"))?;
    let check_updates = MenuItem::with_id(app, CHECK_UPDATES_ID, &labels.check_updates, true, None::<&str>)?;
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("MergeBeacon"))
        .version(Some(app.package_info().version.to_string()))
        .license(Some("Apache-2.0"))
        .website(Some(GITHUB_HOMEPAGE_URL))
        .website_label(Some("GitHub"))
        .build();
    let about = PredefinedMenuItem::about(app, Some(&labels.about), Some(about_metadata))?;
    let quit = PredefinedMenuItem::quit(app, Some(&labels.quit))?;
    let app_menu = Submenu::with_items(
        app,
        "MergeBeacon",
        true,
        &[
            &about,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let new_pull_request =
        MenuItem::with_id(app, NEW_PULL_REQUEST_ID, &labels.new_pull_request, true, Some("CmdOrCtrl+N"))?;
    let new_issue = MenuItem::with_id(app, NEW_ISSUE_ID, &labels.new_issue, true, Some("CmdOrCtrl+Shift+N"))?;
    let close_window = PredefinedMenuItem::close_window(app, Some(&labels.close_window))?;
    let file = Submenu::with_items(
        app,
        &labels.file,
        true,
        &[&new_pull_request, &new_issue, &PredefinedMenuItem::separator(app)?, &close_window],
    )?;

    let undo = PredefinedMenuItem::undo(app, Some(&labels.undo))?;
    let redo = PredefinedMenuItem::redo(app, Some(&labels.redo))?;
    let cut = PredefinedMenuItem::cut(app, Some(&labels.cut))?;
    let copy = PredefinedMenuItem::copy(app, Some(&labels.copy))?;
    let paste = PredefinedMenuItem::paste(app, Some(&labels.paste))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(&labels.select_all))?;
    let edit = Submenu::with_items(
        app,
        &labels.edit,
        true,
        &[&undo, &redo, &PredefinedMenuItem::separator(app)?, &cut, &copy, &paste, &select_all],
    )?;

    let reload = MenuItem::with_id(app, RELOAD_WINDOW_ID, &labels.reload, true, Some("CmdOrCtrl+R"))?;
    let enter_fullscreen = PredefinedMenuItem::fullscreen(app, Some(&labels.enter_fullscreen))?;
    let view = Submenu::with_items(
        app,
        &labels.view,
        true,
        &[&command_palette, &reload, &PredefinedMenuItem::separator(app)?, &enter_fullscreen],
    )?;

    let minimize = PredefinedMenuItem::minimize(app, Some(&labels.minimize))?;
    let maximize = PredefinedMenuItem::maximize(app, Some(&labels.maximize))?;
    let window = Submenu::with_items(app, &labels.window, true, &[&minimize, &maximize])?;

    let github_homepage = MenuItem::with_id(app, OPEN_GITHUB_HOMEPAGE_ID, &labels.github_homepage, true, None::<&str>)?;
    let report_issue = MenuItem::with_id(app, REPORT_ISSUE_ID, &labels.report_issue, true, None::<&str>)?;
    let release_notes = MenuItem::with_id(app, OPEN_RELEASE_NOTES_ID, &labels.release_notes, true, None::<&str>)?;
    let diagnostics = MenuItem::with_id(app, OPEN_DIAGNOSTICS_ID, &labels.diagnostics, true, None::<&str>)?;
    let help = Submenu::with_items(
        app,
        &labels.help,
        true,
        &[&github_homepage, &report_issue, &release_notes, &PredefinedMenuItem::separator(app)?, &diagnostics],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

#[cfg(test)]
mod tests {
    use super::{NativeMenuLabels, MAX_LABEL_CHARS};

    fn labels() -> NativeMenuLabels {
        NativeMenuLabels {
            about: "About".into(),
            check_updates: "Check for updates".into(),
            settings: "Settings".into(),
            quit: "Quit".into(),
            file: "File".into(),
            new_pull_request: "New pull request".into(),
            new_issue: "New issue".into(),
            close_window: "Close window".into(),
            edit: "Edit".into(),
            undo: "Undo".into(),
            redo: "Redo".into(),
            cut: "Cut".into(),
            copy: "Copy".into(),
            paste: "Paste".into(),
            select_all: "Select all".into(),
            view: "View".into(),
            command_palette: "Command palette".into(),
            reload: "Reload".into(),
            enter_fullscreen: "Enter fullscreen".into(),
            window: "Window".into(),
            minimize: "Minimize".into(),
            maximize: "Maximize".into(),
            help: "Help".into(),
            github_homepage: "GitHub homepage".into(),
            report_issue: "Report issue".into(),
            release_notes: "Release notes".into(),
            diagnostics: "Diagnostics".into(),
        }
    }

    #[test]
    fn accepts_complete_bounded_menu_labels() {
        assert!(labels().validate().is_ok());
        assert!(NativeMenuLabels::simplified_chinese().validate().is_ok());
    }

    #[test]
    fn rejects_empty_control_character_and_oversized_labels() {
        let mut input = labels();
        input.file = "  ".into();
        assert!(input.validate().is_err());

        input.file = "File\nMenu".into();
        assert!(input.validate().is_err());

        input.file = "a".repeat(MAX_LABEL_CHARS + 1);
        assert!(input.validate().is_err());
    }
}
