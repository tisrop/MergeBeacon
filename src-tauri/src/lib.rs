pub mod ai;
mod commands;
pub mod crypto;
pub mod error;
pub mod error_log;
pub mod file_content;
pub mod http_client;
pub mod issue_template;
pub mod local_store;
pub mod models;
mod native_menu;
pub mod patch;
pub mod platform;
pub mod pr_template;
#[cfg(all(feature = "restart-timing-test", not(debug_assertions)))]
compile_error!("restart-timing-test is only available in debug builds");
#[cfg(feature = "restart-timing-test")]
mod restart_timing_test;
mod single_instance;
mod state;
pub mod vault;
mod window_state;

use commands::{
    ai as ai_cmds, auth, capabilities, error_log as error_log_cmds, inbox, issue, native_menu as native_menu_cmds,
    notification, pr, review, support, update,
};
use error_log::ErrorLogStore;
use local_store::CommentSnapshotStore;
use state::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

fn eval_main_window(handle: &tauri::AppHandle, script: &str) {
    let Some(window) = handle.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.eval(script) {
        eprintln!("执行菜单操作失败：{error}");
    }
}

fn open_external_url(handle: &tauri::AppHandle, url: &str, label: &str) {
    if let Err(error) = handle.opener().open_url(url, None::<&str>) {
        eprintln!("打开“{label}”失败：{error}");
    }
}

pub fn run() {
    let activation = Arc::new(single_instance::ActivationCoordinator::default());
    let second_instance_activation = activation.clone();
    let setup_activation = activation.clone();

    tauri::Builder::default()
        // 官方要求 single-instance 必须是首个注册的插件。
        .plugin(tauri_plugin_single_instance::init(move |app, _args, _cwd| {
            #[cfg(feature = "restart-timing-test")]
            restart_timing_test::record_duplicate_activation();
            if second_instance_activation.request_activation() {
                single_instance::activate_main_window(app);
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED)
                .skip_initial_state("main")
                .build(),
        )
        .manage(AppState::new())
        .setup(move |app| {
            // Keep every native entry point available while the webview initializes or if IPC fails.
            native_menu::install(app.handle(), native_menu::NativeMenuLabels::simplified_chinese())
                .map_err(std::io::Error::other)?;

            let app_dir = app.path().app_data_dir().unwrap_or_default();
            let comment_store = CommentSnapshotStore::new(&app_dir.join("comment_cache.db"));
            app.manage(comment_store);
            app.manage(ErrorLogStore::new(app.path().app_data_dir().ok()));

            if let Some(window) = app.get_webview_window("main") {
                let restored = window
                    .restore_state(StateFlags::POSITION | StateFlags::SIZE)
                    .and_then(|()| window_state::ensure_visible(&window))
                    .and_then(|()| window.restore_state(StateFlags::MAXIMIZED));
                if let Err(error) = restored {
                    eprintln!("恢复窗口状态失败：{error}");
                }

                // The native window may finish applying the plugin state after setup. Recheck
                // once on the main thread so an off-screen position is corrected after geometry settles.
                let deferred_window = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(100));
                    let callback_window = deferred_window.clone();
                    if let Err(error) = deferred_window.run_on_main_thread(move || {
                        if let Err(error) = window_state::ensure_visible(&callback_window) {
                            eprintln!("延迟窗口可见性校正失败：{error}");
                        }
                    }) {
                        eprintln!("调度延迟窗口可见性校正失败：{error}");
                    }
                });
            }
            if setup_activation.mark_ready() {
                single_instance::activate_main_window(app.handle());
            }
            #[cfg(feature = "restart-timing-test")]
            restart_timing_test::arm(app.handle().clone());

            let menu_ready = Arc::new(AtomicBool::new(false));
            let menu_ready_clone = menu_ready.clone();

            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                menu_ready_clone.store(true, Ordering::SeqCst);
            });

            app.on_menu_event(move |handle, event| {
                if !menu_ready.load(Ordering::SeqCst) {
                    return;
                }
                if event.id() == native_menu::OPEN_SETTINGS_ID {
                    eval_main_window(
                        handle,
                        "if(typeof window.__goToSettings==='function'){window.__goToSettings()}",
                    );
                } else if event.id() == native_menu::OPEN_COMMAND_PALETTE_ID {
                    eval_main_window(
                        handle,
                        "if(typeof window.__openCommandPalette==='function'){window.__openCommandPalette()}",
                    );
                } else if event.id() == native_menu::NEW_PULL_REQUEST_ID {
                    eval_main_window(
                        handle,
                        "if(typeof window.__handleNativeMenuAction==='function'){window.__handleNativeMenuAction('new-pull-request')}",
                    );
                } else if event.id() == native_menu::NEW_ISSUE_ID {
                    eval_main_window(
                        handle,
                        "if(typeof window.__handleNativeMenuAction==='function'){window.__handleNativeMenuAction('new-issue')}",
                    );
                } else if event.id() == native_menu::CHECK_UPDATES_ID {
                    eval_main_window(
                        handle,
                        "if(typeof window.__handleNativeMenuAction==='function'){window.__handleNativeMenuAction('check-updates')}",
                    );
                } else if event.id() == native_menu::OPEN_DIAGNOSTICS_ID {
                    eval_main_window(
                        handle,
                        "if(typeof window.__handleNativeMenuAction==='function'){window.__handleNativeMenuAction('open-diagnostics')}",
                    );
                } else if event.id() == native_menu::RELOAD_WINDOW_ID {
                    if let Some(window) = handle.get_webview_window("main") {
                        if let Err(error) = window.reload() {
                            eprintln!("重新加载窗口失败：{error}");
                        }
                    }
                } else if event.id() == native_menu::OPEN_GITHUB_HOMEPAGE_ID {
                    open_external_url(handle, native_menu::GITHUB_HOMEPAGE_URL, "GitHub homepage");
                } else if event.id() == native_menu::REPORT_ISSUE_ID {
                    open_external_url(handle, native_menu::GITHUB_ISSUES_URL, "issue report page");
                } else if event.id() == native_menu::OPEN_RELEASE_NOTES_ID {
                    open_external_url(handle, native_menu::GITHUB_RELEASES_URL, "release notes");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Auth
            auth::auth_login,
            auth::auth_logout,
            auth::auth_check,
            auth::auth_has_any_token,
            auth::auth_has_token,
            // Support / platform capabilities
            support::support_info,
            support::copy_support_info,
            support::copy_recent_error_logs,
            support::clipboard_write_text,
            support::app_version,
            error_log_cmds::error_log_record,
            update::update_check,
            update::update_download_and_install,
            update::update_restart,
            capabilities::platform_capabilities,
            native_menu_cmds::native_menu_set_labels,
            // Desktop notification
            notification::desktop_notification_permission_granted,
            notification::desktop_notification_request_permission,
            notification::desktop_notification_send,
            // Repo
            auth::repo_list,
            // PR
            inbox::review_inbox_list,
            pr::pr_list,
            pr::pr_list_statuses,
            pr::pr_list_statuses_cancel,
            pr::pr_detail,
            pr::pr_dependencies,
            pr::pr_merge_queue_status,
            pr::pr_branches,
            pr::pr_labels,
            pr::pr_templates,
            pr::pr_description_image_upload,
            pr::pr_participant_suggestions,
            pr::pr_create_preview,
            pr::pr_create,
            pr::pr_metadata_update,
            pr::pr_merge_readiness,
            pr::pr_diff,
            pr::pr_commits,
            pr::pr_compare_diff,
            pr::pr_file_content,
            pr::pr_merge,
            pr::pr_close,
            pr::pr_reopen,
            // Review
            review::review_submit,
            review::review_comment_add,
            review::review_thread_reply,
            review::review_comment_update,
            review::review_comment_delete,
            review::review_list,
            review::review_comments_list,
            review::review_thread_set_resolved,
            review::review_viewed_files_list,
            review::review_file_set_viewed,
            // Issue
            issue::issue_list,
            issue::issue_detail,
            issue::issue_create,
            issue::issue_metadata_update,
            issue::issue_comments_list,
            issue::issue_comment_add,
            issue::issue_templates,
            // AI
            ai_cmds::ai_get_config,
            ai_cmds::ai_save_config,
            ai_cmds::ai_save_api_key,
            ai_cmds::ai_pr_draft,
            ai_cmds::ai_pr_draft_cancel,
            ai_cmds::ai_review,
            ai_cmds::ai_review_stream,
            ai_cmds::ai_review_cancel,
            ai_cmds::ai_list_models,
            ai_cmds::ai_test_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
