use crate::error::CommandResult;
use crate::platform::{capabilities_for, PlatformCapabilities};

/// 返回平台的静态协议能力；不包含登录状态、Token 权限或当前仓库状态。
#[tauri::command]
pub fn platform_capabilities(platform: String) -> CommandResult<PlatformCapabilities> {
    capabilities_for(&platform).ok_or_else(|| format!("不支持的平台：{platform}").into())
}
