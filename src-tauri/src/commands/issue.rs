use crate::error::{CommandError, CommandResult};
use crate::models::*;
use crate::state::AppState;
use tauri::State;

use super::auth::build_platform;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum IssueMetadataField {
    TitleBody,
    State,
    Labels,
}

fn normalize_labels(labels: Vec<String>) -> Result<Vec<String>, String> {
    if labels.len() > 100 {
        return Err("标签数量不能超过 100 个".into());
    }
    let mut normalized = Vec::new();
    for label in labels {
        let label = label.trim();
        if label.is_empty() || normalized.iter().any(|existing: &String| existing.eq_ignore_ascii_case(label)) {
            continue;
        }
        if label.chars().count() > 256 || label.contains(['\0', '\n', '\r']) {
            return Err("标签包含无效内容".into());
        }
        normalized.push(label.to_string());
    }
    Ok(normalized)
}

fn validate_metadata_update(mut update: IssueMetadataUpdate) -> Result<IssueMetadataUpdate, String> {
    update.title = update.title.trim().to_string();
    update.expected_updated_at = update.expected_updated_at.trim().to_string();
    if update.title.is_empty() {
        return Err("Issue 标题不能为空".into());
    }
    if update.title.chars().count() > MAX_PR_TITLE_CHARS || update.title.contains(['\0', '\n', '\r']) {
        return Err(format!("Issue 标题不能超过 {MAX_PR_TITLE_CHARS} 个字符或包含非法字符"));
    }
    if update.body.len() > 1_048_576 || update.body.contains('\0') {
        return Err("Issue 描述过长或包含非法字符".into());
    }
    if matches!(update.state, IssueState::All) {
        return Err("Issue 状态无效".into());
    }
    if update.expected_updated_at.is_empty() {
        return Err("缺少 Issue 远端更新时间，请刷新详情后重试".into());
    }
    update.labels = normalize_labels(update.labels)?;
    Ok(update)
}

fn normalized_label_set(labels: &[String]) -> std::collections::BTreeSet<String> {
    labels.iter().map(|label| label.trim().to_lowercase()).filter(|label| !label.is_empty()).collect()
}

fn changed_metadata_fields(current: &Issue, update: &IssueMetadataUpdate) -> Vec<IssueMetadataField> {
    let mut fields = Vec::new();
    if current.title != update.title || current.body != update.body {
        fields.push(IssueMetadataField::TitleBody);
    }
    if current.state != update.state {
        fields.push(IssueMetadataField::State);
    }
    if normalized_label_set(&current.labels) != normalized_label_set(&update.labels) {
        fields.push(IssueMetadataField::Labels);
    }
    fields
}

fn ensure_metadata_field_available(
    field: IssueMetadataField,
    permissions: &IssueMetadataPermissions,
) -> Result<(), String> {
    let (permission, label) = match field {
        IssueMetadataField::TitleBody => (permissions.can_edit_title_body, "修改 Issue 标题和描述"),
        IssueMetadataField::State => (permissions.can_change_state, "修改 Issue 状态"),
        IssueMetadataField::Labels => (permissions.can_manage_labels, "管理 Issue 标签"),
    };
    if permission == Some(false) || permission.is_none() {
        return Err(format!("当前 Token 或账号没有权限{label}"));
    }
    Ok(())
}

fn ensure_issue_not_stale(current: &Issue, expected_updated_at: &str) -> Result<(), String> {
    if current.updated_at != expected_updated_at {
        return Err("Issue 元数据已在远端更新，请刷新详情后重试".into());
    }
    Ok(())
}

fn validate_comment_body(body: String) -> Result<String, String> {
    let body = body.trim().to_string();
    if body.is_empty() {
        return Err("评论内容不能为空".into());
    }
    if body.len() > 1_048_576 || body.contains('\0') {
        return Err("评论内容过长或包含非法字符".into());
    }
    Ok(body)
}

#[tauri::command]
pub async fn issue_list(
    state: State<'_, AppState>,
    platform: String,
    owner: String,
    repo: String,
    state_filter: Option<String>,
    page: Option<u32>,
) -> CommandResult<Paginated<IssueSummary>> {
    let p = build_platform(&platform, &state).map_err(CommandError::from)?;
    let issue_state = match state_filter.as_deref() {
        Some("closed") => IssueState::Closed,
        Some("all") => IssueState::All,
        _ => IssueState::Open,
    };
    p.list_issues(&owner, &repo, &issue_state, page.unwrap_or(1)).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn issue_detail(
    state: State<'_, AppState>,
    platform: String,
    owner: String,
    repo: String,
    number: u64,
) -> CommandResult<Issue> {
    let p = build_platform(&platform, &state).map_err(CommandError::from)?;
    p.get_issue(&owner, &repo, number).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn issue_create(
    state: State<'_, AppState>,
    platform: String,
    owner: String,
    repo: String,
    title: String,
    body: String,
    labels: Vec<String>,
) -> CommandResult<Issue> {
    let p = build_platform(&platform, &state).map_err(CommandError::from)?;
    p.create_issue(&owner, &repo, &title, &body, &labels).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn issue_metadata_update(
    state: State<'_, AppState>,
    platform: String,
    owner: String,
    repo: String,
    number: u64,
    update: IssueMetadataUpdate,
) -> CommandResult<Issue> {
    if owner.trim().is_empty() || repo.trim().is_empty() {
        return Err("仓库 owner 和名称不能为空".into());
    }
    let update = validate_metadata_update(update)?;
    let p = build_platform(&platform, &state).map_err(CommandError::from)?;
    let current = p.get_issue(&owner, &repo, number).await.map_err(CommandError::from)?;
    ensure_issue_not_stale(&current, &update.expected_updated_at)?;
    let changed_fields = changed_metadata_fields(&current, &update);
    for field in &changed_fields {
        ensure_metadata_field_available(*field, &current.metadata_permissions)?;
    }
    if changed_fields.is_empty() {
        return Ok(current);
    }
    p.update_issue_metadata(&owner, &repo, number, &current, &update).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn issue_comments_list(
    state: State<'_, AppState>,
    platform: String,
    owner: String,
    repo: String,
    number: u64,
) -> CommandResult<Vec<IssueComment>> {
    let p = build_platform(&platform, &state).map_err(CommandError::from)?;
    p.list_issue_comments(&owner, &repo, number).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn issue_comment_add(
    state: State<'_, AppState>,
    platform: String,
    owner: String,
    repo: String,
    number: u64,
    body: String,
) -> CommandResult<IssueComment> {
    let body = validate_comment_body(body)?;
    let p = build_platform(&platform, &state).map_err(CommandError::from)?;
    p.create_issue_comment(&owner, &repo, number, &body).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn issue_templates(
    platform: String,
    owner: String,
    repo: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<IssueTemplate>> {
    let p = build_platform(&platform, &state).map_err(CommandError::from)?;
    p.list_issue_templates(&owner, &repo).await.map_err(CommandError::from)
}

#[cfg(test)]
mod tests {
    use super::{
        changed_metadata_fields, ensure_issue_not_stale, ensure_metadata_field_available, validate_comment_body,
        validate_metadata_update, IssueMetadataField,
    };
    use crate::models::{Issue, IssueMetadataPermissions, IssueMetadataUpdate, IssueState, User};

    fn update() -> IssueMetadataUpdate {
        IssueMetadataUpdate {
            title: "Issue title".into(),
            body: "Description".into(),
            state: IssueState::Open,
            labels: vec!["bug".into()],
            expected_updated_at: "2026-07-26T10:00:00Z".into(),
        }
    }

    fn issue() -> Issue {
        Issue {
            number: 12,
            title: "Issue title".into(),
            body: "Description".into(),
            author: User {
                id: serde_json::json!(1),
                login: "reporter".into(),
                name: "Reporter".into(),
                avatar_url: String::new(),
            },
            state: IssueState::Open,
            labels: vec!["bug".into()],
            label_colors: Default::default(),
            created_at: "2026-07-25T10:00:00Z".into(),
            updated_at: "2026-07-26T10:00:00Z".into(),
            metadata_permissions: IssueMetadataPermissions::default(),
        }
    }

    #[test]
    fn metadata_update_normalizes_title_and_labels() {
        let mut candidate = update();
        candidate.title = "  Updated title  ".into();
        candidate.labels = vec![" bug ".into(), "BUG".into(), String::new(), "frontend".into()];

        let normalized = validate_metadata_update(candidate).expect("metadata should be valid");

        assert_eq!(normalized.title, "Updated title");
        assert_eq!(normalized.labels, vec!["bug", "frontend"]);
    }

    #[test]
    fn metadata_update_rejects_all_state() {
        let mut candidate = update();
        candidate.state = IssueState::All;

        assert_eq!(validate_metadata_update(candidate).unwrap_err(), "Issue 状态无效");
    }

    #[test]
    fn metadata_update_requires_expected_updated_at() {
        let mut candidate = update();
        candidate.expected_updated_at = "  ".into();

        assert_eq!(validate_metadata_update(candidate).unwrap_err(), "缺少 Issue 远端更新时间，请刷新详情后重试");
    }

    #[test]
    fn metadata_update_rejects_stale_remote_version() {
        let current = issue();

        assert!(ensure_issue_not_stale(&current, "2026-07-26T10:00:00Z").is_ok());
        assert_eq!(
            ensure_issue_not_stale(&current, "2026-07-26T09:00:00Z").unwrap_err(),
            "Issue 元数据已在远端更新，请刷新详情后重试"
        );
    }

    #[test]
    fn metadata_change_detection_ignores_label_case_and_order() {
        let current = issue();
        let mut candidate = update();
        candidate.labels = vec!["BUG".into()];

        assert!(changed_metadata_fields(&current, &candidate).is_empty());

        candidate.state = IssueState::Closed;
        candidate.labels.push("frontend".into());
        assert_eq!(
            changed_metadata_fields(&current, &candidate),
            vec![IssueMetadataField::State, IssueMetadataField::Labels]
        );
    }

    #[test]
    fn metadata_field_availability_requires_explicit_permission() {
        let unknown_permissions = IssueMetadataPermissions::default();
        assert!(ensure_metadata_field_available(IssueMetadataField::TitleBody, &unknown_permissions)
            .unwrap_err()
            .contains("没有权限"));

        let denied_permissions =
            IssueMetadataPermissions { can_manage_labels: Some(false), ..IssueMetadataPermissions::default() };
        assert!(ensure_metadata_field_available(IssueMetadataField::Labels, &denied_permissions)
            .unwrap_err()
            .contains("没有权限"));

        let allowed_permissions =
            IssueMetadataPermissions { can_edit_title_body: Some(true), ..IssueMetadataPermissions::default() };
        assert!(ensure_metadata_field_available(IssueMetadataField::TitleBody, &allowed_permissions).is_ok());
    }

    #[test]
    fn comment_body_is_trimmed_and_must_not_be_empty() {
        assert_eq!(validate_comment_body("  Looks good  ".into()).unwrap(), "Looks good");
        assert_eq!(validate_comment_body(" \n ".into()).unwrap_err(), "评论内容不能为空");
    }
}
