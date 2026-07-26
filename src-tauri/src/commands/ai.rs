use crate::ai::client::AiClient;
use crate::error::{AppError, CommandError, CommandResult};
use crate::error_log::ErrorLogStore;
use crate::models::{AiConfig, AiPrDraftRequest, AiPrDraftResult, AiReviewRequest, AiReviewResult, AiStreamEvent};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn ai_get_config(state: State<'_, AppState>) -> CommandResult<AiConfig> {
    let mut config = state.ai_config.get_config().map_err(CommandError::from)?;
    // Never expose encrypted key to frontend
    config.api_key_encrypted = None;
    Ok(config)
}

#[tauri::command]
pub async fn ai_save_config(state: State<'_, AppState>, config: AiConfig) -> CommandResult<()> {
    // Merge: preserve encrypted key from existing config
    let existing = state.ai_config.get_config().unwrap_or_default();
    let mut merged = config;
    if merged.api_key_encrypted.is_none() {
        let encrypted_key = existing.api_key_encrypted.clone();
        merged.api_key_encrypted = encrypted_key.clone();
        merged.api_key_configured = encrypted_key.is_some();
    }
    state.ai_config.save_config(&merged).map_err(CommandError::from)
}

#[tauri::command]
pub async fn ai_save_api_key(state: State<'_, AppState>, api_key: String) -> CommandResult<()> {
    state.ai_config.save_api_key(&api_key).map_err(CommandError::from).map(|_| ())
}

fn configured_ai_client(state: &AppState) -> Result<(AiConfig, AiClient), CommandError> {
    let config = state.ai_config.get_config().map_err(CommandError::from)?;
    let api_key = state.ai_config.get_api_key().map_err(CommandError::from)?;
    let client = AiClient::new(config.endpoint.clone(), config.model.clone(), api_key);
    Ok((config, client))
}

fn validate_ai_request_id(request_id: String) -> Result<String, String> {
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() || request_id.chars().count() > 128 || request_id.chars().any(char::is_control) {
        return Err("AI 请求 ID 为空、过长或包含非法字符".into());
    }
    Ok(request_id)
}

fn validate_pr_draft_request(mut request: AiPrDraftRequest) -> Result<AiPrDraftRequest, String> {
    request.source_branch = request.source_branch.trim().to_string();
    request.target_branch = request.target_branch.trim().to_string();
    for (value, label) in [(&request.source_branch, "源分支"), (&request.target_branch, "目标分支")] {
        if value.is_empty() || value.chars().count() > 512 || value.contains(['\0', '\n', '\r']) {
            return Err(format!("{label}为空、过长或包含非法字符"));
        }
    }
    if request.commits.is_empty() {
        return Err("没有可用于生成草稿的提交".into());
    }
    if request.commits.len() > 100 {
        return Err("用于生成草稿的提交不能超过 100 个".into());
    }
    for commit in &request.commits {
        if commit.sha.is_empty()
            || commit.sha.chars().count() > 256
            || commit.sha.contains(['\0', '\n', '\r'])
            || commit.title.chars().count() > 4096
            || commit.title.contains('\0')
            || commit.author_name.chars().count() > 512
            || commit.author_name.contains('\0')
            || commit.authored_at.chars().count() > 128
            || commit.authored_at.contains('\0')
        {
            return Err("提交摘要包含无效内容".into());
        }
    }
    if request.diff.len() > 1_048_576 || request.diff.contains('\0') {
        return Err("用于生成草稿的 Diff 过长或包含非法字符".into());
    }
    if request.template_body.len() > 262_144 || request.template_body.contains('\0') {
        return Err("PR / MR 模板过长或包含非法字符".into());
    }
    Ok(request)
}

#[tauri::command]
pub async fn ai_pr_draft(
    state: State<'_, AppState>,
    request_id: String,
    request: AiPrDraftRequest,
) -> CommandResult<Option<AiPrDraftResult>> {
    let request_id = validate_ai_request_id(request_id)?;
    let request = validate_pr_draft_request(request)?;
    // PR / MR 草稿与 AI 评审共用同一份模型、端点和凭证配置。
    let (config, client) = configured_ai_client(&state)?;
    let operation = state.operations.begin_ai().await?;
    let registry = state.ai_tasks.clone();
    let generation = registry.next_generation();
    let task_request_id = request_id.clone();
    let (start_tx, start_rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let _operation = operation;
        if start_rx.await.is_err() {
            return None;
        }
        Some(
            client
                .draft_pull_request(
                    &request,
                    config.temperature.unwrap_or(0.2).clamp(0.0, 1.0),
                    config.max_tokens.unwrap_or(4096).clamp(512, 4096),
                )
                .await,
        )
    });

    registry.replace(request_id, generation, task.abort_handle()).await;
    let _ = start_tx.send(());
    let result = task.await;
    registry.remove_if_current(&task_request_id, generation).await;

    match result {
        Ok(Some(result)) => result.map(Some).map_err(CommandError::from),
        Ok(None) => Ok(None),
        Err(error) if error.is_cancelled() => Ok(None),
        Err(_) => Err(CommandError::from(AppError::Ai("AI 草稿任务异常终止".into()))),
    }
}

#[tauri::command]
pub async fn ai_pr_draft_cancel(state: State<'_, AppState>, request_id: String) -> CommandResult<()> {
    let request_id = validate_ai_request_id(request_id)?;
    state.ai_tasks.cancel(&request_id).await;
    Ok(())
}

#[tauri::command]
pub async fn ai_review(state: State<'_, AppState>, request: AiReviewRequest) -> CommandResult<AiReviewResult> {
    let (config, client) = configured_ai_client(&state)?;
    let _operation = state.operations.begin_ai().await?;

    client
        .review(
            &request.diff,
            request.context.as_ref(),
            request.focus.as_ref(),
            config.system_prompt.as_deref(),
            config.temperature.unwrap_or(0.3),
            config.max_tokens.unwrap_or(8192),
        )
        .await
        .map_err(CommandError::from)
}

/// Streaming AI review — registers a cancellable background task and emits request-scoped events.
#[tauri::command]
pub async fn ai_review_stream(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    error_logs: State<'_, ErrorLogStore>,
    request_id: String,
    request: AiReviewRequest,
) -> CommandResult<()> {
    let request_id = validate_ai_request_id(request_id)?;
    let (config, client) = configured_ai_client(&state)?;
    let system_prompt = config.system_prompt.clone();
    let temperature = config.temperature.unwrap_or(0.3);
    let max_tokens = config.max_tokens.unwrap_or(8192);
    let operation = state.operations.begin_ai().await?;
    let registry = state.ai_tasks.clone();
    let generation = registry.next_generation();
    let task_request_id = request_id.clone();
    let task_registry = registry.clone();
    let task_error_logs = error_logs.inner().clone();
    let (start_tx, start_rx) = tokio::sync::oneshot::channel();

    let task = tokio::spawn(async move {
        let _operation = operation;
        if start_rx.await.is_err() {
            return;
        }
        let chunk_request_id = task_request_id.clone();
        let chunk_handle = app_handle.clone();
        let result = client
            .review_stream(
                &request.diff,
                request.context.as_ref(),
                request.focus.as_ref(),
                system_prompt.as_deref(),
                temperature,
                max_tokens,
                move |token| {
                    chunk_handle
                        .emit(
                            "ai-review-chunk",
                            AiStreamEvent { request_id: chunk_request_id.clone(), payload: token.to_string() },
                        )
                        .map_err(|error| AppError::Ai(format!("发送 AI 流事件失败: {error}")))
                },
            )
            .await;

        match result {
            Ok(review_result) => {
                let _ = app_handle.emit(
                    "ai-review-done",
                    AiStreamEvent { request_id: task_request_id.clone(), payload: review_result },
                );
            }
            Err(error) => {
                let error = CommandError::from(error);
                let log_store = task_error_logs.clone();
                let log_error = error.clone();
                let log_failed = !matches!(
                    tokio::task::spawn_blocking(move || log_store.record_command_error("ai_review_stream", &log_error))
                        .await,
                    Ok(Ok(()))
                );
                if log_failed {
                    let event = serde_json::json!({
                        "event": "error_log_write_failed",
                        "command": "ai_review_stream",
                    });
                    eprintln!("{event}");
                }
                let _ = app_handle
                    .emit("ai-review-error", AiStreamEvent { request_id: task_request_id.clone(), payload: error });
            }
        }
        task_registry.remove_if_current(&task_request_id, generation).await;
    });

    registry.replace(request_id, generation, task.abort_handle()).await;
    let _ = start_tx.send(());
    Ok(())
}

#[tauri::command]
pub async fn ai_review_cancel(state: State<'_, AppState>, request_id: String) -> CommandResult<()> {
    let request_id = validate_ai_request_id(request_id)?;
    state.ai_tasks.cancel(&request_id).await;
    Ok(())
}
#[tauri::command]
pub async fn ai_list_models(state: State<'_, AppState>, endpoint: String) -> CommandResult<Vec<String>> {
    let api_key = state.ai_config.get_api_key().map_err(CommandError::from)?;

    // Use a dummy model name — list_models doesn't need a model
    let client = AiClient::new(endpoint, "".to_string(), api_key);

    client.list_models().await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn ai_test_connection(state: State<'_, AppState>) -> CommandResult<bool> {
    let config = state.ai_config.get_config().map_err(CommandError::from)?;
    let api_key = state.ai_config.get_api_key().map_err(CommandError::from)?;

    let client = AiClient::new(config.endpoint, config.model, api_key);

    client.test_connection().await.map_err(CommandError::from)
}
