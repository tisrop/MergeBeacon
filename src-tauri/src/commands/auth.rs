use crate::error::{CommandError, CommandResult};
use crate::models::*;
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn auth_login(
    state: State<'_, AppState>,
    platform: String,
    token: String,
    custom_url: Option<String>,
) -> CommandResult<AuthLoginResult> {
    use crate::platform::{gitee::GiteeAdapter, github::GitHubAdapter, gitlab::GitLabAdapter, GitPlatform};

    let client = state.http_client.as_ref().clone();
    let custom_url = custom_url.map(|url| crate::platform::normalize_api_base(&platform, &url));

    // Build adapter with custom URL if provided
    let p: Box<dyn GitPlatform> = match platform.as_str() {
        "github" => {
            let adapter = GitHubAdapter::new(client.clone(), token.clone());
            if let Some(ref url) = custom_url {
                Box::new(adapter.with_base_url(url.clone()))
            } else {
                Box::new(adapter)
            }
        }
        "gitlab" => {
            let adapter = GitLabAdapter::new(client.clone(), token.clone());
            if let Some(ref url) = custom_url {
                Box::new(adapter.with_base_url(url.clone()))
            } else {
                Box::new(adapter)
            }
        }
        "gitee" => {
            let adapter = GiteeAdapter::new(client.clone(), token.clone());
            if let Some(ref url) = custom_url {
                Box::new(adapter.with_base_url(url.clone()))
            } else {
                Box::new(adapter)
            }
        }
        _ => return Err(crate::error::AppError::InvalidPlatform(platform).into()),
    };

    // Verify token by fetching current user
    let user = p.current_user().await.map_err(CommandError::from)?;

    let vault = Arc::clone(&state.token_vault);
    let storage_platform = platform.clone();
    let credential_storage = tokio::task::spawn_blocking(move || {
        let credential_storage = vault.store_token(&storage_platform, &token)?;
        if let Some(url) = custom_url {
            vault.store_custom_url(&storage_platform, &url)?;
        }
        Ok::<_, crate::error::AppError>(credential_storage)
    })
    .await
    .map_err(|_| CommandError::from("凭证写入后台任务失败"))?
    .map_err(CommandError::from)?;

    Ok(AuthLoginResult { user, credential_storage })
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>, platform: String) -> CommandResult<()> {
    let vault = Arc::clone(&state.token_vault);
    tokio::task::spawn_blocking(move || {
        vault.delete_token(&platform)?;
        vault.delete_custom_url(&platform)
    })
    .await
    .map_err(|_| CommandError::from("凭证删除后台任务失败"))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_has_any_token(state: State<'_, AppState>) -> CommandResult<bool> {
    let vault = Arc::clone(&state.token_vault);
    tokio::task::spawn_blocking(move || {
        for platform in ["github", "gitlab", "gitee"] {
            if vault.get_token(platform)?.is_some() {
                return Ok::<_, crate::error::AppError>(true);
            }
        }
        Ok::<_, crate::error::AppError>(false)
    })
    .await
    .map_err(|_| CommandError::from("凭证读取后台任务失败"))?
    .map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_has_token(state: State<'_, AppState>, platform: String) -> CommandResult<bool> {
    let vault = Arc::clone(&state.token_vault);
    tokio::task::spawn_blocking(move || vault.get_token(&platform).map(|token| token.is_some()))
        .await
        .map_err(|_| CommandError::from("凭证读取后台任务失败"))?
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn auth_check(state: State<'_, AppState>, platform: String) -> CommandResult<Option<User>> {
    let p = match build_platform(&platform, &state).await {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    match p.current_user().await {
        Ok(user) => Ok(Some(user)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn repo_list(
    state: State<'_, AppState>,
    platform: String,
    page: u32,
) -> CommandResult<Paginated<RepoSummary>> {
    let p = build_adapter(&platform, &state).await?;
    p.list_repos(page).await.map_err(CommandError::from)
}

/// Build a platform adapter from state + token.
/// Reads custom URL from vault if one was configured for this platform.
pub(crate) async fn build_platform(
    platform: &str,
    state: &AppState,
) -> Result<Box<dyn crate::platform::GitPlatform>, crate::error::AppError> {
    use crate::platform::{gitee::GiteeAdapter, github::GitHubAdapter, gitlab::GitLabAdapter};

    if !matches!(platform, "github" | "gitlab" | "gitee") {
        return Err(crate::error::AppError::InvalidPlatform(platform.to_string()));
    }

    let vault = Arc::clone(&state.token_vault);
    let credential_platform = platform.to_string();
    let (token, custom_url) = tokio::task::spawn_blocking(move || {
        let token = vault
            .get_token(&credential_platform)?
            .ok_or_else(|| crate::error::AppError::NotAuthenticated(credential_platform.clone()))?;
        Ok::<_, crate::error::AppError>((token, vault.get_custom_url(&credential_platform)))
    })
    .await
    .map_err(|_| crate::error::AppError::Unknown("凭证读取后台任务失败".to_string()))??;
    let client = state.http_client.as_ref().clone();

    match platform {
        "github" => {
            let adapter = GitHubAdapter::new(client, token);
            Ok(Box::new(if let Some(url) = custom_url { adapter.with_base_url(url) } else { adapter }))
        }
        "gitlab" => {
            let adapter = GitLabAdapter::new(client, token);
            Ok(Box::new(if let Some(url) = custom_url { adapter.with_base_url(url) } else { adapter }))
        }
        "gitee" => {
            let adapter = GiteeAdapter::new(client, token);
            Ok(Box::new(if let Some(url) = custom_url { adapter.with_base_url(url) } else { adapter }))
        }
        _ => Err(crate::error::AppError::InvalidPlatform(platform.to_string())),
    }
}

/// Build a platform adapter in command contexts, mapping errors to `CommandError`.
///
/// 命令层获取 adapter 的统一入口；与 `build_platform` 的差异仅在错误转换。
/// `auth_check` 等需要吞掉鉴权失败的调用仍使用 `build_platform` 原版。
pub(crate) async fn build_adapter(
    platform: &str,
    state: &AppState,
) -> CommandResult<Box<dyn crate::platform::GitPlatform>> {
    build_platform(platform, state).await.map_err(CommandError::from)
}
