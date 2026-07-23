use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{CommandError, CommandResult};

#[cfg(target_os = "macos")]
use std::{
    sync::{Arc, LazyLock},
    time::Duration,
};
#[cfg(not(target_os = "macos"))]
use tauri::plugin::PermissionState;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;
#[cfg(target_os = "macos")]
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const NOTIFICATION_ACTION_EVENT: &str = "desktop-notification-action";
const OPEN_ACTION_ID: &str = "open";
#[cfg(target_os = "macos")]
const ACTION_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
#[cfg(target_os = "macos")]
const MAX_PENDING_ACTION_RESPONSES: usize = 64;
#[cfg(target_os = "macos")]
static ACTION_RESPONSE_SLOTS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(MAX_PENDING_ACTION_RESPONSES)));

#[derive(Debug, Deserialize)]
pub struct DesktopNotificationPayload {
    id: i64,
    title: String,
    body: String,
    group: String,
    #[serde(default)]
    extra: Value,
    #[serde(default = "default_actionable")]
    actionable: bool,
}

fn default_actionable() -> bool {
    true
}

fn has_valid_navigation_target(extra: &Value) -> bool {
    let Some(target) = extra.as_object() else {
        return false;
    };
    matches!(target.get("platform").and_then(Value::as_str), Some("github" | "gitlab" | "gitee"))
        && target.get("owner").and_then(Value::as_str).is_some_and(|value| !value.trim().is_empty())
        && target.get("repo").and_then(Value::as_str).is_some_and(|value| !value.trim().is_empty())
        && target.get("number").and_then(Value::as_u64).is_some_and(|value| value > 0)
}

fn validate_payload(payload: &DesktopNotificationPayload) -> Result<(), String> {
    if payload.title.trim().is_empty() || payload.body.trim().is_empty() {
        return Err("桌面通知标题和正文不能为空".to_string());
    }
    if payload.group.trim().is_empty() {
        return Err("桌面通知分组不能为空".to_string());
    }
    if payload.actionable && !has_valid_navigation_target(&payload.extra) {
        return Err("可点击桌面通知缺少有效的 PR / MR 定位信息".to_string());
    }
    Ok(())
}

fn emit_navigation(app: &AppHandle, extra: Value) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(NOTIFICATION_ACTION_EVENT, extra);
}

#[cfg(target_os = "macos")]
fn reserve_action_response_slot(slots: &Arc<Semaphore>) -> Result<OwnedSemaphorePermit, String> {
    Arc::clone(slots).try_acquire_owned().map_err(|_| "待处理的桌面通知操作过多，请处理现有通知后重试".to_string())
}

#[tauri::command]
pub async fn desktop_notification_permission_granted(app: AppHandle) -> CommandResult<bool> {
    permission_granted(&app).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn desktop_notification_request_permission(app: AppHandle) -> CommandResult<bool> {
    request_permission(&app).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn desktop_notification_send(app: AppHandle, payload: DesktopNotificationPayload) -> CommandResult<()> {
    validate_payload(&payload)?;
    send_notification(app, payload).await.map_err(CommandError::from)
}

#[cfg(target_os = "macos")]
async fn permission_granted(_app: &AppHandle) -> Result<bool, String> {
    use mac_usernotifications::{get_notification_settings, AuthorizationStatus};

    let settings = get_notification_settings().await.map_err(|error| format!("读取 macOS 通知权限失败：{error}"))?;
    Ok(matches!(
        settings.authorization_status,
        AuthorizationStatus::Authorized | AuthorizationStatus::Provisional | AuthorizationStatus::Ephemeral
    ))
}

#[cfg(not(target_os = "macos"))]
async fn permission_granted(app: &AppHandle) -> Result<bool, String> {
    app.notification()
        .permission_state()
        .map(|state| state == PermissionState::Granted)
        .map_err(|error| format!("读取系统通知权限失败：{error}"))
}

#[cfg(target_os = "macos")]
async fn request_permission(_app: &AppHandle) -> Result<bool, String> {
    mac_usernotifications::request_auth().await.map_err(|error| format!("请求 macOS 通知权限失败：{error}"))
}

#[cfg(not(target_os = "macos"))]
async fn request_permission(app: &AppHandle) -> Result<bool, String> {
    app.notification()
        .request_permission()
        .map(|state| state == PermissionState::Granted)
        .map_err(|error| format!("请求系统通知权限失败：{error}"))
}

#[cfg(target_os = "macos")]
async fn send_notification(app: AppHandle, payload: DesktopNotificationPayload) -> Result<(), String> {
    use mac_usernotifications::{Action, Notification};

    let response_slot = payload.actionable.then(|| reserve_action_response_slot(&ACTION_RESPONSE_SLOTS)).transpose()?;
    let mut notification = Notification::new()
        .id(&format!("mergebeacon-{}", payload.id))
        .title(&payload.title)
        .message(&payload.body)
        .thread_id(&payload.group)
        .default_sound();
    if payload.actionable {
        notification = notification.action(Action::button(OPEN_ACTION_ID, "打开 PR / MR")).timeout(ACTION_TIMEOUT);
    }

    let handle = notification.send().await.map_err(|error| format!("发送 macOS 通知失败：{error}"))?;
    if !payload.actionable {
        return Ok(());
    }

    let extra = payload.extra;
    tauri::async_runtime::spawn(async move {
        let _response_slot = response_slot;
        let Ok(response) = handle.response().await else {
            return;
        };
        if !response.is_default_action() && response.action_identifier != OPEN_ACTION_ID {
            return;
        }
        emit_navigation(&app, extra);
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn send_notification(app: AppHandle, payload: DesktopNotificationPayload) -> Result<(), String> {
    use notify_rust::{Notification, NotificationResponse};

    let mut notification = Notification::new();
    notification.id(payload.id as u32).appname("MergeBeacon").summary(&payload.title).body(&payload.body);
    if payload.actionable {
        notification.action(OPEN_ACTION_ID, "打开 PR / MR");
    }

    let handle = notification.show().map_err(|error| format!("发送系统通知失败：{error}"))?;
    if !payload.actionable {
        return Ok(());
    }

    let extra = payload.extra;
    tauri::async_runtime::spawn_blocking(move || {
        let _ = handle.wait_for_response(move |response: &NotificationResponse| {
            let should_open = matches!(response, NotificationResponse::Default)
                || matches!(response, NotificationResponse::Action(action) if action == OPEN_ACTION_ID);
            if should_open {
                emit_navigation(&app, extra);
            }
        });
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn payload(extra: Value, actionable: bool) -> DesktopNotificationPayload {
        DesktopNotificationPayload {
            id: 1,
            title: "title".to_string(),
            body: "body".to_string(),
            group: "group".to_string(),
            extra,
            actionable,
        }
    }

    #[test]
    fn actionable_notification_requires_a_complete_target() {
        assert!(validate_payload(&payload(
            json!({
                "platform": "github",
                "owner": "team",
                "repo": "repo",
                "number": 7
            }),
            true
        ))
        .is_ok());
        assert!(validate_payload(&payload(json!({ "platform": "github" }), true)).is_err());
    }

    #[test]
    fn non_actionable_notification_does_not_require_a_target() {
        assert!(validate_payload(&payload(json!({}), false)).is_ok());
    }

    #[test]
    fn notification_requires_a_group() {
        let mut payload = payload(json!({}), false);
        payload.group = "  ".to_string();
        assert!(validate_payload(&payload).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn action_response_slots_are_bounded_and_reusable() {
        let slots = Arc::new(Semaphore::new(1));
        let permit = reserve_action_response_slot(&slots).expect("first slot should be available");
        assert!(reserve_action_response_slot(&slots).is_err());

        drop(permit);
        assert!(reserve_action_response_slot(&slots).is_ok());
    }
}
