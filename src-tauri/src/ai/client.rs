use eventsource_stream::Eventsource;
use futures::{Stream, StreamExt};
use serde_json::Value;

use crate::ai::prompt;
use crate::error::AppError;
use crate::models::{AiReviewFocus, AiReviewResult, PrContext};

/// OpenAI-compatible chat client
pub struct AiClient {
    endpoint: String,
    model: String,
    api_key: String,
    client: reqwest::Client,
}

async fn consume_sse_stream<S, F>(stream: S, mut on_token: F) -> Result<String, AppError>
where
    S: Stream<Item = Result<Vec<u8>, String>>,
    F: FnMut(&str) -> Result<(), AppError>,
{
    // Appending an empty event terminator makes providers that omit the final blank line flush safely.
    let stream = stream.chain(futures::stream::once(async { Ok::<Vec<u8>, String>(b"\n\n".to_vec()) }));
    let events = stream.eventsource();
    futures::pin_mut!(events);
    let mut accumulated = String::new();

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
        if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
            accumulated.push_str(content);
            on_token(content)?;
        }
    }
    Ok(accumulated)
}

fn map_review_json_error(error: serde_json::Error) -> AppError {
    if error.is_eof() {
        AppError::Ai(
            "AI 返回的评审 JSON 不完整，可能已达到 Max Tokens 上限。请提高 AI 设置中的 Max Tokens，或缩小评审范围后重试"
                .to_string(),
        )
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

impl AiClient {
    pub fn new(endpoint: String, model: String, api_key: String) -> Self {
        Self { endpoint: endpoint.trim_end_matches('/').to_string(), model, api_key, client: reqwest::Client::new() }
    }

    /// Send a chat completion request (non-streaming)
    async fn chat(&self, messages: &[Value], temperature: f32, max_tokens: u32) -> Result<String, AppError> {
        let url = format!("{}/chat/completions", self.endpoint);
        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        });

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("User-Agent", "mergebeacon")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let error_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("AI API error ({}): {}", status, error_body)));
        }

        let json: Value = resp.json().await?;
        let content = json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();

        Ok(content)
    }

    /// Send a streaming chat completion request.
    /// Calls `on_token` with each text delta as it arrives.
    /// Returns the complete accumulated content.
    async fn chat_stream<F>(
        &self,
        messages: &[Value],
        temperature: f32,
        max_tokens: u32,
        on_token: F,
    ) -> Result<String, AppError>
    where
        F: FnMut(&str) -> Result<(), AppError> + Send,
    {
        let url = format!("{}/chat/completions", self.endpoint);
        let body = serde_json::json!({
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": true,
        });

        let resp = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("User-Agent", "mergebeacon")
            .header("Accept", "text/event-stream")
            .json(&body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let error_body = resp.text().await.unwrap_or_default();
            return Err(AppError::Ai(format!("AI API error ({}): {}", status, error_body)));
        }

        let stream =
            resp.bytes_stream().map(|chunk| chunk.map(|bytes| bytes.to_vec()).map_err(|error| error.to_string()));
        consume_sse_stream(stream, on_token).await
    }

    /// Perform a code review using the AI model (non-streaming)
    pub async fn review(
        &self,
        diff: &str,
        context: Option<&PrContext>,
        focus: Option<&AiReviewFocus>,
        custom_prompt: Option<&str>,
        temperature: f32,
        max_tokens: u32,
    ) -> Result<AiReviewResult, AppError> {
        let system_prompt = prompt::build_system_prompt(focus, custom_prompt);
        let user_message = prompt::build_user_message(diff, context);

        let messages = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
            serde_json::json!({"role": "user", "content": user_message}),
        ];

        let response = self.chat(&messages, temperature, max_tokens).await?;
        self.parse_review_response(&response)
    }

    /// Perform a streaming code review.
    /// Calls `on_token` with each text delta, and returns the final parsed result.
    #[allow(clippy::too_many_arguments)]
    pub async fn review_stream<F>(
        &self,
        diff: &str,
        context: Option<&PrContext>,
        focus: Option<&AiReviewFocus>,
        custom_prompt: Option<&str>,
        temperature: f32,
        max_tokens: u32,
        on_token: F,
    ) -> Result<AiReviewResult, AppError>
    where
        F: FnMut(&str) -> Result<(), AppError> + Send,
    {
        let system_prompt = prompt::build_system_prompt(focus, custom_prompt);
        let user_message = prompt::build_user_message(diff, context);

        let messages = vec![
            serde_json::json!({"role": "system", "content": system_prompt}),
            serde_json::json!({"role": "user", "content": user_message}),
        ];

        let response = self.chat_stream(&messages, temperature, max_tokens, on_token).await?;

        self.parse_review_response(&response)
    }

    /// Parse the first complete review JSON object from the model response.
    /// Providers sometimes wrap JSON in Markdown or append a short explanation. A second complete
    /// JSON object is rejected because choosing one silently could apply conflicting suggestions.
    fn parse_review_response(&self, response: &str) -> Result<AiReviewResult, AppError> {
        let candidate = response.find('{').map_or(response.trim(), |start| &response[start..]);
        if candidate.trim().is_empty() {
            return Err(AppError::Ai("AI 未返回评审 JSON。请确认当前模型支持按要求输出 JSON 后重试".to_string()));
        }

        let mut values = serde_json::Deserializer::from_str(candidate).into_iter::<AiReviewResult>();
        let result = values
            .next()
            .ok_or_else(|| AppError::Ai("AI 未返回评审 JSON。请确认当前模型支持按要求输出 JSON 后重试".to_string()))?
            .map_err(map_review_json_error)?;
        let trailing = &candidate[values.byte_offset()..];
        if contains_complete_review_json(trailing) {
            return Err(AppError::Ai("AI 返回了多个评审 JSON，无法确定应使用哪一份结果。请重试本次评审".to_string()));
        }

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

        match self.chat(&messages, 0.0, 50).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}

#[cfg(test)]
mod tests {
    use futures::stream;

    use super::{consume_sse_stream, AiClient};

    fn delta(content: &str) -> String {
        format!(r#"{{"choices":[{{"delta":{{"content":"{content}"}}}}]}}"#)
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
        assert_eq!(result, "你好");
        assert_eq!(received, "你好");
    }

    #[tokio::test]
    async fn flushes_final_event_without_blank_line() {
        let body = format!("data: {}", delta("尾"));
        let result = consume_sse_stream(stream::iter(vec![Ok(body.into_bytes())]), |_| Ok(())).await.unwrap();
        assert_eq!(result, "尾");
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
            .parse_review_response("以下是评审结果：\n```\n{\"suggestions\":[],\"summary\":\"完成\"}\n```\n请查收。")
            .unwrap();
        assert_eq!(result.summary, "完成");
        assert!(result.suggestions.is_empty());
    }

    #[test]
    fn parses_complete_review_with_trailing_explanation() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let result = client
            .parse_review_response(
                r#"{"suggestions":[],"summary":"完成"}
以上为本次评审结果。"#,
            )
            .unwrap();
        assert_eq!(result.summary, "完成");
    }

    #[test]
    fn rejects_multiple_complete_review_objects() {
        let client = AiClient::new("https://example.test/v1".to_string(), "test".to_string(), "secret".to_string());
        let error = client
            .parse_review_response(
                r#"{"suggestions":[],"summary":"第一份"}
{"suggestions":[],"summary":"第二份"}"#,
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
        let error = client.parse_review_response(r#"{"suggestions":[],"summary":"评审结果尚未完成"#).unwrap_err();
        let message = error.to_string();
        assert!(message.contains("Max Tokens"));
        assert!(!message.contains("评审结果尚未完成"));
    }
}
