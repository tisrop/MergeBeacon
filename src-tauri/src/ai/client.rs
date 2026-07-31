use eventsource_stream::Eventsource;
use futures::{Stream, StreamExt};
use serde_json::Value;

use crate::ai::prompt;
use crate::error::AppError;
use crate::models::{
    AiPrDraftRequest, AiPrDraftResult, AiReviewFocus, AiReviewLanguage, AiReviewResult, PrContext, MAX_PR_TITLE_CHARS,
};

#[derive(Debug, PartialEq, Eq)]
struct ChatCompletion {
    content: String,
    finish_reason: Option<String>,
    did_fallback_from_json_mode: bool,
}

/// OpenAI-compatible chat client
pub struct AiClient {
    endpoint: String,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

pub struct AiReviewOptions<'a> {
    pub focus: Option<&'a AiReviewFocus>,
    pub language: &'a AiReviewLanguage,
    pub custom_prompt: Option<&'a str>,
    pub temperature: f32,
    pub max_tokens: u32,
}

async fn consume_sse_stream<S, F>(stream: S, mut on_token: F) -> Result<ChatCompletion, AppError>
where
    S: Stream<Item = Result<Vec<u8>, String>>,
    F: FnMut(&str) -> Result<(), AppError>,
{
    // Appending an empty event terminator makes providers that omit the final blank line flush safely.
    let stream = stream.chain(futures::stream::once(async { Ok::<Vec<u8>, String>(b"\n\n".to_vec()) }));
    let events = stream.eventsource();
    futures::pin_mut!(events);
    let mut accumulated = String::new();
    let mut finish_reason = None;

    while let Some(event) = events.next().await {
        let event = event.map_err(|error| AppError::Ai(format!("SSE 解析失败: {error}")))?;
        let data = event.data.trim();
        if data.is_empty() {
            continue;
        }
        if data == "[DONE]" {
            break;
        }
        let json: Value = serde_json::from_str(data)
            .map_err(|error| AppError::Ai(format!("AI SSE 数据不是有效 JSON: {error}; data={data}")))?;
        let choice = &json["choices"][0];
        if let Some(reason) = choice["finish_reason"].as_str() {
            finish_reason = Some(reason.to_string());
        }
        if let Some(content) = choice["delta"]["content"].as_str() {
            accumulated.push_str(content);
            on_token(content)?;
        }
    }
    Ok(ChatCompletion { content: accumulated, finish_reason, did_fallback_from_json_mode: false })
}

fn chat_request_body(
    model: &str,
    messages: &[Value],
    temperature: f32,
    max_tokens: u32,
    stream: bool,
    json_mode: bool,
) -> Value {
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    if stream {
        body["stream"] = Value::Bool(true);
    }
    if json_mode {
        body["response_format"] = serde_json::json!({ "type": "json_object" });
    }
    body
}

fn json_mode_is_unsupported(error_body: &str) -> bool {
    let message = error_body.to_ascii_lowercase();
    message.contains("response_format") || message.contains("json_object") || message.contains("json mode")
}

fn missing_review_json_error(did_fallback_from_json_mode: bool) -> AppError {
    if did_fallback_from_json_mode {
        AppError::Ai("AI 端点不支持 JSON 模式，已自动降级，但模型仍未返回有效的评审 JSON。请更换模型后重试".to_string())
    } else {
        AppError::Ai("AI 未返回评审 JSON。请确认当前模型支持按要求输出 JSON 后重试".to_string())
    }
}

fn map_review_json_error(error: serde_json::Error, did_fallback_from_json_mode: bool) -> AppError {
    if error.is_eof() {
        if did_fallback_from_json_mode {
            AppError::Ai(
                "AI 端点不支持 JSON 模式，已自动降级，但模型返回的评审 JSON 不完整。请提高 Max Tokens 或更换模型后重试"
                    .to_string(),
            )
        } else {
            AppError::Ai(
                "AI 返回的评审 JSON 不完整，可能已达到 Max Tokens 上限。请提高 AI 设置中的 Max Tokens，或缩小评审范围后重试"
                    .to_string(),
            )
        }
    } else if did_fallback_from_json_mode {
        AppError::Ai(format!(
            "AI 端点不支持 JSON 模式，已自动降级，但模型仍返回非 JSON 内容（{error}）。请更换模型后重试"
        ))
    } else {
        AppError::Ai(format!("AI 返回的评审结果不是有效 JSON（{error}）。请确认当前模型支持按要求输出 JSON 后重试"))
    }
}

fn contains_complete_review_json(trailing: &str) -> bool {
    trailing.char_indices().any(|(index, character)| {
        if character != '{' {
            return false;
        }
        serde_json::Deserializer::from_str(&trailing[index..])
            .into_iter::<AiReviewResult>()
            .next()
            .is_some_and(|result| result.is_ok())
    })
}

fn contains_complete_pr_draft_json(trailing: &str) -> bool {
    trailing.char_indices().any(|(index, character)| {
        if character != '{' {
            return false;
        }
        serde_json::Deserializer::from_str(&trailing[index..])
            .into_iter::<AiPrDraftResult>()
            .next()
            .is_some_and(|result| result.is_ok())
    })
}

impl AiClient {
    pub fn new(endpoint: String, model: String, api_key: String) -> Self {
        Self { endpoint: endpoint.trim_end_matches('/').to_string(), model, api_key, client: reqwest::Client::new() }
    }

    /// Send a chat request, retrying once without JSON mode when a compatible endpoint rejects it.
    async fn send_chat_request(
        &self,
        messages: &[Value],
        temperature: f32,
        max_tokens: u32,
        stream: bool,
        json_mode: bool,
    ) -> Result<(reqwest::Response, bool), AppError> {
        let url = format!("{}/chat/completions", self.endpoint);
        let mut use_json_mode = json_mode;
        let mut did_fallback_from_json_mode = false;
        loop {
            let body = chat_request_body(&self.model, messages, temperature, max_tokens, stream, use_json_mode);
            let mut request = self
                .client
                .post(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .header("User-Agent", "mergebeacon")
                .json(&body);
            if stream {
                request = request.header("Accept", "text/event-stream");
            }
            let resp = request.send().await?;
            if resp.status().is_success() {
                return Ok((resp, did_fallback_from_json_mode));
            }
            let status = resp.status();
            let error_body = resp.text().await.unwrap_or_default();
            if use_json_mode && json_mode_is_unsupported(&error_body) {
                use_json_mode = false;
                did_fallback_from_json_mode = true;
                continue;
            }
            return Err(AppError::Ai(format!("AI API error ({}): {}", status, error_body)));
        }
    }

    /// Send a chat completion request (non-streaming)
    async fn chat(
        &self,
        messages: &[Value],
        temperature: f32,
        max_tokens: u32,
        json_mode: bool,
    ) -> Result<ChatCompletion, AppError> {
        let (resp, did_fallback_from_json_mode) =
            self.send_chat_request(messages, temperature, max_tokens, false, json_mode).await?;

        let json: Value = resp.json().await?;
        let content = json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
        let finish_reason = json["choices"][0]["finish_reason"].as_str().map(str::to_string);
        Ok(ChatCompletion { content, finish_reason, did_fallback_from_json_mode })
    }

    /// Send a streaming chat completion request.
    /// Calls `on_token` with each text delta as it arrives.
    /// Returns the complete accumulated content.
    async fn chat_stream<F>(
        &self,
        messages: &[Value],
        temperature: f32,
        max_tokens: u32,
        json_mode: bool,
        on_token: F,
    ) -> Result<ChatCompletion, AppError>
    where
        F: FnMut(&str) -> Result<(), AppError> + Send,
    {
        let (resp, did_fallback_from_json_mode) =
            self.send_chat_request(messages, temperature, max_tokens, true, json_mode).await?;

        let stream =
            resp.bytes_stream().map(|chunk| chunk.map(|bytes| bytes.to_vec()).map_err(|error| error.to_string()));
        let mut completion = consume_sse_stream(stream, on_token).await?;
        completion.did_fallback_from_json_mode = did_fallback_from_json_mode;
        Ok(completion)
    }

    /// Perform a code review using the AI model (non-streaming)
    pub async fn review(
        &self,
        diff: &str,
        context: Option<&PrContext>,
        options: AiReviewOptions<'_>,
    ) -> Result<AiReviewResult, AppError> {
        let system_prompt = prompt::build_system_prompt(options.focus, options.language, options.custom_prompt);
        let user_message = prompt::build_user_message(diff, context, options.language);

        let messages = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
            serde_json::json!({"role": "user", "content": user_message}),
        ];

        let response = self.chat(&messages, options.temperature, options.max_tokens, true).await?;
        self.parse_review_completion(&response)
    }

    pub async fn draft_pull_request(
        &self,
        request: &AiPrDraftRequest,
        temperature: f32,
        max_tokens: u32,
    ) -> Result<AiPrDraftResult, AppError> {
        let messages = vec![
            serde_json::json!({"role": "system", "content": prompt::build_pr_draft_system_prompt()}),
            serde_json::json!({"role": "user", "content": prompt::build_pr_draft_user_message(request)}),
        ];
        let response = self.chat(&messages, temperature, max_tokens, false).await?;
        Self::parse_pr_draft_response(&response.content)
    }

    /// Perform a streaming code review.
    /// Calls `on_token` with each text delta, and returns the final parsed result.
    pub async fn review_stream<F>(
        &self,
        diff: &str,
        context: Option<&PrContext>,
        options: AiReviewOptions<'_>,
        on_token: F,
    ) -> Result<AiReviewResult, AppError>
    where
        F: FnMut(&str) -> Result<(), AppError> + Send,
    {
        let system_prompt = prompt::build_system_prompt(options.focus, options.language, options.custom_prompt);
        let user_message = prompt::build_user_message(diff, context, options.language);

        let messages = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
            serde_json::json!({"role": "user", "content": user_message}),
        ];

        let response = self.chat_stream(&messages, options.temperature, options.max_tokens, true, on_token).await?;

        self.parse_review_completion(&response)
    }

    fn parse_review_completion(&self, completion: &ChatCompletion) -> Result<AiReviewResult, AppError> {
        if completion.content.trim().is_empty() {
            return match completion.finish_reason.as_deref() {
                Some("length") => Err(AppError::Ai(
                    if completion.did_fallback_from_json_mode {
                        "AI 端点不支持 JSON 模式，已自动降级，但模型在生成评审 JSON 前达到 Max Tokens 上限。请提高 Max Tokens 或更换模型后重试"
                    } else {
                        "AI 在生成评审 JSON 前已达到 Max Tokens 上限。推理模型可能已耗尽输出预算；请提高 Max Tokens、改用非推理模型或缩小评审范围后重试"
                    }
                    .to_string(),
                )),
                Some("content_filter") => {
                    Err(AppError::Ai("AI 服务拦截了本次评审内容，未返回可用结果。请缩小评审范围后重试".to_string()))
                }
                _ if completion.did_fallback_from_json_mode => Err(missing_review_json_error(true)),
                _ => Err(AppError::Ai(
                    "AI 服务返回了空的评审内容。请重试；若持续发生，请改用支持 JSON 输出的非推理模型"
                        .to_string(),
                )),
            };
        }
        self.parse_review_response_with_context(&completion.content, completion.did_fallback_from_json_mode)
    }

    /// Parse the first complete review JSON object from the model response.
    /// Providers sometimes wrap JSON in Markdown or append a short explanation. A second complete
    /// JSON object is rejected because choosing one silently could apply conflicting suggestions.
    fn parse_review_response_with_context(
        &self,
        response: &str,
        did_fallback_from_json_mode: bool,
    ) -> Result<AiReviewResult, AppError> {
        let candidate = response.find('{').map_or(response.trim(), |start| &response[start..]);
        if candidate.trim().is_empty() {
            return Err(missing_review_json_error(did_fallback_from_json_mode));
        }

        let mut values = serde_json::Deserializer::from_str(candidate).into_iter::<AiReviewResult>();
        let result = values
            .next()
            .ok_or_else(|| missing_review_json_error(did_fallback_from_json_mode))?
            .map_err(|error| map_review_json_error(error, did_fallback_from_json_mode))?;
        let trailing = &candidate[values.byte_offset()..];
        if contains_complete_review_json(trailing) {
            return Err(AppError::Ai("AI 返回了多个评审 JSON，无法确定应使用哪一份结果。请重试本次评审".to_string()));
        }

        Ok(result)
    }

    fn parse_pr_draft_response(response: &str) -> Result<AiPrDraftResult, AppError> {
        let candidate = response.find('{').map_or(response.trim(), |start| &response[start..]);
        if candidate.trim().is_empty() {
            return Err(AppError::Ai("AI 未返回 PR / MR 草稿 JSON，请重试".to_string()));
        }

        let mut values = serde_json::Deserializer::from_str(candidate).into_iter::<AiPrDraftResult>();
        let mut result = values
            .next()
            .ok_or_else(|| AppError::Ai("AI 未返回 PR / MR 草稿 JSON，请重试".to_string()))?
            .map_err(|error| {
                if error.is_eof() {
                    AppError::Ai("AI 返回的 PR / MR 草稿 JSON 不完整，请提高 Max Tokens 后重试".to_string())
                } else {
                    AppError::Ai(format!("AI 返回的 PR / MR 草稿不是有效 JSON（{error}）"))
                }
            })?;
        let trailing = &candidate[values.byte_offset()..];
        if contains_complete_pr_draft_json(trailing) {
            return Err(AppError::Ai("AI 返回了多个 PR / MR 草稿，无法确定应使用哪一份".to_string()));
        }

        result.title = result.title.trim().to_string();
        if result.title.is_empty()
            || result.title.chars().count() > MAX_PR_TITLE_CHARS
            || result.title.contains(['\0', '\n', '\r'])
        {
            return Err(AppError::Ai("AI 返回的 PR / MR 标题为空、过长或包含换行".to_string()));
        }
        if result.body.len() > 1_048_576 || result.body.contains('\0') {
            return Err(AppError::Ai("AI 返回的 PR / MR 描述过长或包含非法字符".to_string()));
        }
        // 保留模板可能需要的前导空白，只清理模型常附带的尾部空行。
        result.body = result.body.trim_end().to_string();
        Ok(result)
    }

    /// List available models from the API endpoint.
    /// Calls GET /v1/models (OpenAI-compatible).
    pub async fn list_models(&self) -> Result<Vec<String>, AppError> {
        let url = format!("{}/models", self.endpoint);

        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("User-Agent", "mergebeacon")
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let error_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("Failed to list models ({}): {}", status, error_body)));
        }

        let json: Value = resp.json().await?;

        // OpenAI format: { "object": "list", "data": [{ "id": "...", ... }] }
        let models: Vec<String> = json["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().map(String::from))
                    .filter(|id| {
                        !id.contains("dall-e")
                            && !id.contains("whisper")
                            && !id.contains("tts")
                            && !id.contains("embedding")
                            && !id.contains("moderation")
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(models)
    }

    /// Test the API connection with a simple request
    pub async fn test_connection(&self) -> Result<bool, AppError> {
        let messages = vec![serde_json::json!({"role": "user", "content": "Hello, respond with just 'ok'."})];

        match self.chat(&messages, 0.0, 50, false).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use futures::stream;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    use super::{chat_request_body, consume_sse_stream, json_mode_is_unsupported, AiClient, ChatCompletion};
    use crate::models::MAX_PR_TITLE_CHARS;

    fn delta(content: &str) -> String {
        format!(r#"{{"choices":[{{"delta":{{"content":"{content}"}}}}]}}"#)
    }

    fn request_uses_json_mode(request: &Request) -> bool {
        request.body_json::<serde_json::Value>().ok().and_then(|body| body.get("response_format").cloned()).is_some()
    }

    fn request_omits_json_mode(request: &Request) -> bool {
        !request_uses_json_mode(request)
    }

    #[tokio::test]
    async fn parses_lf_crlf_chunks_multiline_and_done() {
        let first = delta("你");
        let second = delta("好");
        let body = format!(
            ": keepalive\r\ndata: {first}\r\n\r\ndata: {}\ndata: {}\n\ndata: [DONE]\n\n",
            &second[..second.len() / 2],
            &second[second.len() / 2..]
        );
        let chunks = body.as_bytes().chunks(7).map(|chunk| Ok::<_, String>(chunk.to_vec())).collect::<Vec<_>>();
        let mut received = String::new();
        let result = consume_sse_stream(stream::iter(chunks), |token| {
            received.push_str(token);
            Ok(())
        })
        .await
        .unwrap();
        assert_eq!(result.content, "你好");
        assert_eq!(result.finish_reason, None);
        assert_eq!(received, "你好");
    }

    #[tokio::test]
    async fn flushes_final_event_without_blank_line() {
        let body = format!("data: {}", delta("尾"));
        let result = consume_sse_stream(stream::iter(vec![Ok(body.into_bytes())]), |_| Ok(())).await.unwrap();
        assert_eq!(result.content, "尾");
    }

    #[tokio::test]
    async fn preserves_stream_finish_reason_when_content_is_empty() {
        let body = "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n";
        let result = consume_sse_stream(stream::iter(vec![Ok(body.as_bytes().to_vec())]), |_| Ok(())).await.unwrap();

        assert_eq!(result.content, "");
        assert_eq!(result.finish_reason.as_deref(), Some("length"));
    }

    #[tokio::test]
    async fn rejects_invalid_nonempty_json() {
        let error =
            consume_sse_stream(stream::iter(vec![Ok(b"data: not-json\n\n".to_vec())]), |_| Ok(())).await.unwrap_err();
        assert!(error.to_string().contains("not-json"));
    }

    #[test]
    fn parses_review_wrapped_in_generic_markdown_fence() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let result = client
            .parse_review_response_with_context(
                "以下是评审结果：\n```\n{\"suggestions\":[],\"summary\":\"完成\"}\n```\n请查收。",
                false,
            )
            .unwrap();
        assert_eq!(result.summary, "完成");
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn parses_complete_review_with_trailing_explanation() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let result = client
            .parse_review_response_with_context(
                r#"{"suggestions":[],"summary":"完成"}
以上为本次评审结果。"#,
                false,
            )
            .unwrap();
        assert_eq!(result.summary, "完成");
    }

    #[test]
    fn rejects_multiple_complete_review_objects() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let error = client
            .parse_review_response_with_context(
                r#"{"suggestions":[],"summary":"第一份"}
{"suggestions":[],"summary":"第二份"}"#,
                false,
            )
            .unwrap_err();
        let message = error.to_string();
        assert!(message.contains("多个评审 JSON"));
        assert!(!message.contains("第一份"));
        assert!(!message.contains("第二份"));
    }

    #[test]
    fn reports_truncated_review_without_echoing_model_output() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let error = client
            .parse_review_response_with_context(r#"{"suggestions":[],"summary":"评审结果尚未完成"#, false)
            .unwrap_err();
        let message = error.to_string();
        assert!(message.contains("Max Tokens"));
        assert!(!message.contains("评审结果尚未完成"));
    }

    #[test]
    fn reports_empty_length_limited_review_as_exhausted_output_budget() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let error = client
            .parse_review_completion(&ChatCompletion {
                content: String::new(),
                finish_reason: Some("length".to_string()),
                did_fallback_from_json_mode: false,
            })
            .unwrap_err();

        let message = error.to_string();
        assert!(message.contains("Max Tokens"));
        assert!(message.contains("推理模型"));
        assert!(!message.contains("不支持按要求输出 JSON"));
    }

    #[test]
    fn reports_empty_completed_review_as_empty_provider_response() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let error = client
            .parse_review_completion(&ChatCompletion {
                content: String::new(),
                finish_reason: Some("stop".to_string()),
                did_fallback_from_json_mode: false,
            })
            .unwrap_err();

        let message = error.to_string();
        assert!(message.contains("空的评审内容"));
        assert!(!message.contains("未返回评审 JSON"));
    }

    #[test]
    fn reports_invalid_review_after_json_mode_fallback_with_degradation_context() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let error = client
            .parse_review_completion(&ChatCompletion {
                content: "Here is the review, but not as JSON.".to_string(),
                finish_reason: Some("stop".to_string()),
                did_fallback_from_json_mode: true,
            })
            .unwrap_err();

        let message = error.to_string();
        assert!(message.contains("端点不支持 JSON 模式，已自动降级"));
        assert!(message.contains("仍返回非 JSON 内容"));
        assert!(!message.contains("请确认当前模型支持"));
    }

    #[test]
    fn parses_markdown_wrapped_review_after_json_mode_fallback() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let result = client
            .parse_review_completion(&ChatCompletion {
                content: "评审如下：\n```json\n{\"suggestions\":[],\"summary\":\"完成\"}\n```".to_string(),
                finish_reason: Some("stop".to_string()),
                did_fallback_from_json_mode: true,
            })
            .unwrap();

        assert_eq!(result.summary, "完成");
    }

    #[test]
    fn reports_truncated_review_after_json_mode_fallback_with_both_causes() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let error = client
            .parse_review_completion(&ChatCompletion {
                content: r#"{"suggestions":[],"summary":"unfinished"#.to_string(),
                finish_reason: Some("length".to_string()),
                did_fallback_from_json_mode: true,
            })
            .unwrap_err();

        let message = error.to_string();
        assert!(message.contains("端点不支持 JSON 模式，已自动降级"));
        assert!(message.contains("评审 JSON 不完整"));
        assert!(message.contains("Max Tokens"));
        assert!(!message.contains("unfinished"));
    }

    #[test]
    fn review_request_enables_json_mode_without_changing_plain_chat_requests() {
        let messages = vec![serde_json::json!({ "role": "user", "content": "Return JSON" })];
        let review = chat_request_body("test", &messages, 0.3, 2048, true, true);
        let plain = chat_request_body("test", &messages, 0.3, 50, false, false);

        assert_eq!(review["response_format"]["type"], "json_object");
        assert_eq!(review["stream"], true);
        assert!(plain.get("response_format").is_none());
        assert!(plain.get("stream").is_none());
    }

    #[test]
    fn falls_back_for_any_status_when_error_identifies_json_mode_as_unsupported() {
        assert!(json_mode_is_unsupported(r#"{\"error\":{\"message\":\"response_format is not supported\"}}"#,));
        assert!(json_mode_is_unsupported("upstream 500: response_format failed"));
        assert!(!json_mode_is_unsupported(r#"{\"error\":{\"message\":\"invalid api key\"}}"#));
        assert!(!json_mode_is_unsupported("internal server error"));
    }

    #[tokio::test]
    async fn non_streaming_chat_retries_once_without_json_mode_and_returns_fallback_completion() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .and(request_uses_json_mode)
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": { "message": "response_format is not supported" }
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .and(request_omits_json_mode)
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "choices": [{
                    "message": { "content": "{\"suggestions\":[],\"summary\":\"fallback\"}" },
                    "finish_reason": "stop"
                }]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = AiClient::new(server.uri(), "test".to_string(), "secret".to_string());
        let messages = vec![serde_json::json!({ "role": "user", "content": "Return JSON" })];
        let completion = client.chat(&messages, 0.3, 2048, true).await.unwrap();

        assert_eq!(completion.content, "{\"suggestions\":[],\"summary\":\"fallback\"}");
        assert_eq!(completion.finish_reason.as_deref(), Some("stop"));
        assert!(completion.did_fallback_from_json_mode);
        let requests = server.received_requests().await.expect("request recording should be enabled");
        assert_eq!(requests.len(), 2);
        assert!(request_uses_json_mode(&requests[0]));
        assert!(request_omits_json_mode(&requests[1]));
        server.verify().await;
    }

    #[tokio::test]
    async fn non_streaming_chat_does_not_retry_unrelated_bad_request() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/chat/completions"))
            .and(request_uses_json_mode)
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": { "message": "invalid max_tokens" }
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = AiClient::new(server.uri(), "test".to_string(), "secret".to_string());
        let messages = vec![serde_json::json!({ "role": "user", "content": "Return JSON" })];
        let error = client.chat(&messages, 0.3, 2048, true).await.unwrap_err();

        let message = error.to_string();
        assert!(message.contains("400 Bad Request"));
        assert!(message.contains("invalid max_tokens"));
        let requests = server.received_requests().await.expect("request recording should be enabled");
        assert_eq!(requests.len(), 1);
        assert!(request_uses_json_mode(&requests[0]));
        server.verify().await;
    }

    #[test]
    fn parses_pr_draft_wrapped_in_markdown() {
        let result = AiClient::parse_pr_draft_response(
            "草稿如下：\n```json\n{\"title\":\"feat: add template\",\"body\":\"## 说明\"}\n```",
        )
        .unwrap();

        assert_eq!(result.title, "feat: add template");
        assert_eq!(result.body, "## 说明");
    }

    #[test]
    fn trims_pr_draft_trailing_whitespace_without_removing_leading_content() {
        let response = serde_json::json!({
            "title": "  feat: add template  ",
            "body": "\n## 说明\n\n  ",
        })
        .to_string();
        let result = AiClient::parse_pr_draft_response(&response).unwrap();

        assert_eq!(result.title, "feat: add template");
        assert_eq!(result.body, "\n## 说明");
    }

    #[test]
    fn rejects_multiple_pr_draft_objects_without_echoing_content() {
        let error = AiClient::parse_pr_draft_response(
            "{\"title\":\"first\",\"body\":\"one\"}\n{\"title\":\"second\",\"body\":\"two\"}",
        )
        .unwrap_err();
        let message = error.to_string();

        assert!(message.contains("多个 PR / MR 草稿"));
        assert!(!message.contains("first"));
        assert!(!message.contains("second"));
    }

    #[test]
    fn rejects_incomplete_pr_draft_without_echoing_content() {
        let error = AiClient::parse_pr_draft_response("{\"title\":\"unfinished\",\"body\":").unwrap_err();
        let message = error.to_string();

        assert!(message.contains("不完整"));
        assert!(!message.contains("unfinished"));
    }

    #[test]
    fn rejects_invalid_pr_draft_title() {
        let error =
            AiClient::parse_pr_draft_response("{\"title\":\"line one\\nline two\",\"body\":\"ok\"}").unwrap_err();

        assert!(error.to_string().contains("标题为空、过长或包含换行"));

        let oversized = serde_json::json!({
            "title": "界".repeat(MAX_PR_TITLE_CHARS + 1),
            "body": "ok",
        })
        .to_string();
        assert!(AiClient::parse_pr_draft_response(&oversized).is_err());

        let maximum = serde_json::json!({
            "title": "界".repeat(MAX_PR_TITLE_CHARS),
            "body": "ok",
        })
        .to_string();
        assert!(AiClient::parse_pr_draft_response(&maximum).is_ok());
    }
}
