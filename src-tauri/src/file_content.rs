use crate::error::AppError;
use crate::models::PrFileContent;
use base64::Engine;
use serde_json::Value;

/// Context expansion only needs a bounded text window. Refuse to materialize very
/// large blobs in the renderer even when a provider returns them successfully.
pub const MAX_PR_FILE_CONTENT_BYTES: u64 = 1024 * 1024;
/// Media previews are opt-in and remain bounded because base64 IPC payloads
/// temporarily amplify memory usage in both the Rust process and the webview.
pub const MAX_PR_MEDIA_CONTENT_BYTES: u64 = 16 * 1024 * 1024;

const PREVIEWABLE_MEDIA_EXTENSIONS: &[&str] =
    &["svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "mp4", "m4v", "mov", "webm", "ogv", "ogg"];

pub fn preview_content_limit(path: &str, media_preview: bool) -> u64 {
    let extension = path.rsplit_once('.').map(|(_, extension)| extension).unwrap_or("");
    if media_preview && PREVIEWABLE_MEDIA_EXTENSIONS.iter().any(|candidate| extension.eq_ignore_ascii_case(candidate)) {
        MAX_PR_MEDIA_CONTENT_BYTES
    } else {
        MAX_PR_FILE_CONTENT_BYTES
    }
}

pub fn encode_path_segments(path: &str) -> String {
    path.split('/').map(|segment| urlencoding::encode(segment)).collect::<Vec<_>>().join("/")
}

pub fn validate_request(path: &str, revision: &str) -> Result<(), AppError> {
    if path.trim().is_empty() {
        return Err(AppError::Api("文件路径不能为空".into()));
    }
    if revision.trim().is_empty() {
        return Err(AppError::Api("文件 revision 不能为空".into()));
    }
    if path.contains('\0') || revision.contains('\0') {
        return Err(AppError::Api("文件路径或 revision 包含非法字符".into()));
    }
    Ok(())
}

pub fn decode_response(platform: &str, path: &str, revision: &str, json: &Value) -> Result<PrFileContent, AppError> {
    decode_response_with_limit(platform, path, revision, json, MAX_PR_FILE_CONTENT_BYTES)
}

pub fn decode_response_with_limit(
    platform: &str,
    path: &str,
    revision: &str,
    json: &Value,
    maximum_content_bytes: u64,
) -> Result<PrFileContent, AppError> {
    let reported_size = json["size"].as_u64().unwrap_or(0);
    if reported_size > maximum_content_bytes {
        return Ok(PrFileContent {
            path: path.to_string(),
            revision: revision.to_string(),
            content: String::new(),
            content_base64: None,
            truncated: true,
            binary: false,
        });
    }

    let encoding = json["encoding"].as_str().unwrap_or("");
    let encoded = json["content"].as_str().unwrap_or("");
    if encoding != "base64" {
        return Err(AppError::Api(format!("{platform} 文件内容编码不可用")));
    }

    // GitHub wraps the base64 payload with newlines; other providers may do the
    // same. Whitespace is not part of the payload and is safe to remove here.
    let maximum_encoded_length = maximum_content_bytes as usize * 4 / 3 + 8;
    if encoded.len() > maximum_encoded_length.saturating_mul(2) {
        return Ok(PrFileContent {
            path: path.to_string(),
            revision: revision.to_string(),
            content: String::new(),
            content_base64: None,
            truncated: true,
            binary: false,
        });
    }
    let compact = encoded.chars().filter(|character| !character.is_ascii_whitespace()).collect::<String>();
    if compact.len() > maximum_encoded_length {
        return Ok(PrFileContent {
            path: path.to_string(),
            revision: revision.to_string(),
            content: String::new(),
            content_base64: None,
            truncated: true,
            binary: false,
        });
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(compact)
        .map_err(|error| AppError::Api(format!("{platform} 文件内容不是有效的 base64：{error}")))?;
    if bytes.len() as u64 > maximum_content_bytes {
        return Ok(PrFileContent {
            path: path.to_string(),
            revision: revision.to_string(),
            content: String::new(),
            content_base64: None,
            truncated: true,
            binary: false,
        });
    }

    match String::from_utf8(bytes) {
        Ok(content) => Ok(PrFileContent {
            path: path.to_string(),
            revision: revision.to_string(),
            content,
            content_base64: None,
            truncated: false,
            binary: false,
        }),
        Err(error) => Ok(PrFileContent {
            path: path.to_string(),
            revision: revision.to_string(),
            content: String::new(),
            content_base64: Some(base64::engine::general_purpose::STANDARD.encode(error.into_bytes())),
            truncated: false,
            binary: true,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_wrapped_utf8_base64() {
        let result = decode_response(
            "GitHub",
            "src/lib.rs",
            "head",
            &json!({
                "encoding": "base64",
                "content": "aGVs\n bG8=",
                "size": 5,
            }),
        )
        .expect("content");

        assert_eq!(result.content, "hello");
        assert!(!result.truncated);
        assert!(!result.binary);
    }

    #[test]
    fn marks_non_utf8_content_as_binary() {
        let result = decode_response(
            "GitLab",
            "image.png",
            "base",
            &json!({
                "encoding": "base64",
                "content": "/wAB",
                "size": 3,
            }),
        )
        .expect("content");

        assert!(result.binary);
        assert!(result.content.is_empty());
        assert_eq!(result.content_base64.as_deref(), Some("/wAB"));
    }

    #[test]
    fn marks_large_content_as_truncated_before_decoding() {
        let result = decode_response(
            "Gitee",
            "large.txt",
            "head",
            &json!({
                "encoding": "base64",
                "content": "not-a-payload",
                "size": MAX_PR_FILE_CONTENT_BYTES + 1,
            }),
        )
        .expect("content");

        assert!(result.truncated);
        assert!(result.content.is_empty());
    }

    #[test]
    fn grants_the_larger_limit_only_to_supported_media_previews() {
        assert_eq!(preview_content_limit("demo.MP4", true), MAX_PR_MEDIA_CONTENT_BYTES);
        assert_eq!(preview_content_limit("demo.webm", true), MAX_PR_MEDIA_CONTENT_BYTES);
        assert_eq!(preview_content_limit("src/large.rs", true), MAX_PR_FILE_CONTENT_BYTES);
        assert_eq!(preview_content_limit("demo.mp4", false), MAX_PR_FILE_CONTENT_BYTES);
    }

    #[test]
    fn rejects_invalid_requests() {
        assert!(validate_request("", "head").is_err());
        assert!(validate_request("file.txt", "").is_err());
        assert!(validate_request("file\0.txt", "head").is_err());
    }
}
