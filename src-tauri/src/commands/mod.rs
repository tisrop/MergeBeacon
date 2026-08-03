pub mod ai;
pub mod auth;
pub mod capabilities;
pub mod error_log;
pub mod inbox;
pub mod issue;
pub mod native_menu;
pub mod notification;
pub mod pr;
pub mod review;
pub mod support;
pub mod update;

/// 校验仓库 owner/name 非空；CommandResult 上下文可用 `?` 直接传播（String → CommandError）。
pub(crate) fn validate_repo(owner: &str, repo: &str) -> Result<(), String> {
    if owner.trim().is_empty() || repo.trim().is_empty() {
        return Err("仓库 owner 和名称不能为空".into());
    }
    Ok(())
}

/// 校验请求 ID 非空、长度受限且无控制字符，返回规范化后的值。
pub(crate) fn validate_request_id(request_id: String, label: &str) -> Result<String, String> {
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() || request_id.chars().count() > 128 || request_id.chars().any(char::is_control) {
        return Err(format!("{label} 请求 ID 为空、过长或包含非法字符"));
    }
    Ok(request_id)
}

#[cfg(test)]
mod tests {
    use super::{validate_repo, validate_request_id};

    #[test]
    fn validate_repo_accepts_non_empty_names() {
        assert!(validate_repo("owner", "repo").is_ok());
    }

    #[test]
    fn validate_repo_rejects_empty_names() {
        assert!(validate_repo("", "repo").is_err());
        assert!(validate_repo("owner", "").is_err());
        assert!(validate_repo("", "").is_err());
    }

    #[test]
    fn validate_repo_trims_whitespace_before_checking() {
        assert!(validate_repo("  ", "repo").is_err());
        assert!(validate_repo("owner", "   ").is_err());
        // 纯空白在 trim 后视为空，与内联校验语义保持一致。
        assert!(validate_repo("  ", "  ").is_err());
    }

    #[test]
    fn validate_request_id_accepts_a_normalized_value() {
        let normalized = validate_request_id("  task-42  ".into(), "测试").unwrap();
        assert_eq!(normalized, "task-42");
    }

    #[test]
    fn validate_request_id_rejects_empty_ids() {
        assert!(validate_request_id(String::new(), "测试").is_err());
        assert!(validate_request_id("   ".into(), "测试").is_err());
    }

    #[test]
    fn validate_request_id_rejects_ids_over_128_characters() {
        let too_long = "x".repeat(129);
        assert!(validate_request_id(too_long, "测试").is_err());
        let boundary = "x".repeat(128);
        assert!(validate_request_id(boundary, "测试").is_ok());
    }

    #[test]
    fn validate_request_id_rejects_control_characters() {
        assert!(validate_request_id("task\u{0000}42".into(), "测试").is_err());
        assert!(validate_request_id("task\n42".into(), "测试").is_err());
    }
}
