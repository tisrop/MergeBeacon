use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};

#[derive(Debug, Serialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

fn check_result(
    current_version: String,
    update: Option<(String, Option<String>, Option<String>)>,
) -> UpdateCheckResult {
    match update {
        Some((version, notes, published_at)) => {
            UpdateCheckResult { current_version, available: true, version: Some(version), notes, published_at }
        }
        None => UpdateCheckResult { current_version, available: false, version: None, notes: None, published_at: None },
    }
}

fn update_error(error: UpdaterError) -> String {
    match error {
        UpdaterError::ReleaseNotFound => {
            "更新源暂未提供有效的发布元数据，请确认已发布包含 latest.json 的正式版本后重试".into()
        }
        error => format!("检查更新失败：{error}"),
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let updater = app.updater().map_err(|error| format!("初始化更新检查失败：{error}"))?;
    let update = updater.check().await.map_err(update_error)?;
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    Ok(check_result(
        current_version,
        update.map(|update| (update.version, update.body, update.date.map(|date| date.to_string()))),
    ))
}

#[cfg(test)]
mod tests {
    use super::{check_result, update_error};
    use tauri_plugin_updater::Error as UpdaterError;

    #[test]
    fn reports_up_to_date_without_remote_fields() {
        let result = check_result("0.3.0".into(), None);
        assert!(!result.available);
        assert!(result.version.is_none());
        assert!(result.notes.is_none());
    }

    #[test]
    fn preserves_available_update_metadata_as_untrusted_text() {
        let result = check_result(
            "0.3.0".into(),
            Some(("0.4.0".into(), Some("<script>不可信说明</script>".into()), Some("2026-07-13".into()))),
        );
        assert!(result.available);
        assert_eq!(result.version.as_deref(), Some("0.4.0"));
        assert_eq!(result.notes.as_deref(), Some("<script>不可信说明</script>"));
    }
    #[test]
    fn explains_missing_or_invalid_release_metadata() {
        assert_eq!(
            update_error(UpdaterError::ReleaseNotFound),
            "更新源暂未提供有效的发布元数据，请确认已发布包含 latest.json 的正式版本后重试"
        );
    }
}
