//! AI engine: provider-neutral chat request builders, streaming response parsers and the async
//! HTTP runtime. API keys are passed in by the caller and are never logged or put in errors.

use std::future::Future;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::runner::CancelToken;

const DEFAULT_MAX_TOKENS: u32 = 4096;
const ANTHROPIC_VERSION: &str = "2023-06-01";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const IDLE_TIMEOUT: Duration = Duration::from_secs(120);
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const CANCEL_SLICE: Duration = Duration::from_millis(250);
const MAX_RESPONSE_TEXT: usize = 2 * 1024 * 1024;
const MAX_ERROR_BODY: usize = 64 * 1024;
const MAX_LIST_BODY: usize = 4 * 1024 * 1024;
const MAX_LINE: usize = 4 * 1024 * 1024;
const MAX_MESSAGE_CHARS: usize = 500;
const MAX_MODELS: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    #[serde(rename = "openai")]
    OpenAI,
    Ollama,
}

impl Provider {
    fn label(self) -> &'static str {
        match self {
            Provider::Anthropic => "Anthropic",
            Provider::OpenAI => "OpenAI",
            Provider::Ollama => "Ollama",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub provider: Provider,
    pub model: String,
    pub messages: Vec<Message>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AiEvent {
    Delta {
        text: String,
    },
    Done {
        stop_reason: Option<String>,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    },
    Error {
        message: String,
        status: Option<u16>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ModelInfo {
    pub id: String,
}

/// Base URLs of the providers. Fields are public so tests can point at a local server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub anthropic: String,
    pub openai: String,
    pub ollama: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            anthropic: "https://api.anthropic.com".to_string(),
            openai: "https://api.openai.com".to_string(),
            ollama: "http://127.0.0.1:11434".to_string(),
        }
    }
}

impl Endpoints {
    /// Default endpoints with one provider's base URL replaced.
    #[cfg(test)]
    pub fn with_base(provider: Provider, url: &str) -> Self {
        let mut endpoints = Self::default();
        let url = url.to_string();
        match provider {
            Provider::Anthropic => endpoints.anthropic = url,
            Provider::OpenAI => endpoints.openai = url,
            Provider::Ollama => endpoints.ollama = url,
        }
        endpoints
    }

    fn base(&self, provider: Provider) -> &str {
        match provider {
            Provider::Anthropic => &self.anthropic,
            Provider::OpenAI => &self.openai,
            Provider::Ollama => &self.ollama,
        }
    }
}

/// Only local Ollama is allowed in M3: http/https and host 127.0.0.1, localhost or [::1].
pub fn validate_ollama_base(url: &str) -> Result<(), String> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .ok_or("Ollama URL must start with http:// or https://")?;
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return Err("Ollama URL must not contain credentials".to_string());
    }
    let (host, port) = if let Some(after) = authority.strip_prefix('[') {
        let end = after.find(']').ok_or("invalid Ollama URL host")?;
        let host = &authority[..end + 2];
        let tail = &after[end + 1..];
        let port = if tail.is_empty() {
            None
        } else {
            Some(tail.strip_prefix(':').ok_or("invalid Ollama URL port")?)
        };
        (host, port)
    } else {
        match authority.split_once(':') {
            Some((host, port)) => (host, Some(port)),
            None => (authority, None),
        }
    };
    if let Some(port) = port {
        if port.parse::<u16>().is_err() {
            return Err("invalid Ollama URL port".to_string());
        }
    }
    match host.to_ascii_lowercase().as_str() {
        "127.0.0.1" | "localhost" | "[::1]" => Ok(()),
        _ => Err("Ollama must run locally (127.0.0.1, localhost or [::1])".to_string()),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HttpRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

fn join_url(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn temperature_value(t: f32) -> Value {
    let rounded = (f64::from(t) * 10_000.0).round() / 10_000.0;
    json!(rounded)
}

fn require_key(provider: Provider, api_key: Option<&str>) -> Result<String, String> {
    api_key
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{} API key is not set", provider.label()))
}

fn validate_request(req: &ChatRequest) -> Result<(), String> {
    if req.model.trim().is_empty() {
        return Err("model must not be empty".to_string());
    }
    if req.messages.is_empty() {
        return Err("messages must not be empty".to_string());
    }
    for message in &req.messages {
        match message.role.as_str() {
            "system" | "user" | "assistant" => {}
            other => return Err(format!("unsupported message role: {other}")),
        }
    }
    Ok(())
}

fn message_json(message: &Message) -> Value {
    json!({ "role": message.role, "content": message.content })
}

/// Builds the provider-specific streaming chat request. Pure; does no I/O.
pub fn build_request(
    endpoints: &Endpoints,
    req: &ChatRequest,
    api_key: Option<&str>,
) -> Result<HttpRequest, String> {
    validate_request(req)?;
    let content_type = ("content-type".to_string(), "application/json".to_string());
    match req.provider {
        Provider::Anthropic => {
            let key = require_key(req.provider, api_key)?;
            let system: Vec<&str> = req
                .messages
                .iter()
                .filter(|m| m.role == "system")
                .map(|m| m.content.as_str())
                .collect();
            let messages: Vec<Value> = req
                .messages
                .iter()
                .filter(|m| m.role != "system")
                .map(message_json)
                .collect();
            let mut body = json!({
                "model": req.model,
                "max_tokens": req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
                "stream": true,
                "messages": messages,
            });
            if !system.is_empty() {
                body["system"] = Value::String(system.join("\n\n"));
            }
            if let Some(t) = req.temperature {
                body["temperature"] = temperature_value(t);
            }
            Ok(HttpRequest {
                url: join_url(&endpoints.anthropic, "/v1/messages"),
                headers: vec![
                    ("x-api-key".to_string(), key),
                    (
                        "anthropic-version".to_string(),
                        ANTHROPIC_VERSION.to_string(),
                    ),
                    content_type,
                ],
                body,
            })
        }
        Provider::OpenAI => {
            let key = require_key(req.provider, api_key)?;
            let messages: Vec<Value> = req.messages.iter().map(message_json).collect();
            let mut body = json!({
                "model": req.model,
                "messages": messages,
                "stream": true,
                "stream_options": { "include_usage": true },
            });
            if let Some(max) = req.max_tokens {
                body["max_completion_tokens"] = json!(max);
            }
            if let Some(t) = req.temperature {
                body["temperature"] = temperature_value(t);
            }
            Ok(HttpRequest {
                url: join_url(&endpoints.openai, "/v1/chat/completions"),
                headers: vec![
                    ("Authorization".to_string(), format!("Bearer {key}")),
                    content_type,
                ],
                body,
            })
        }
        Provider::Ollama => {
            validate_ollama_base(&endpoints.ollama)?;
            let messages: Vec<Value> = req.messages.iter().map(message_json).collect();
            let mut body = json!({
                "model": req.model,
                "messages": messages,
                "stream": true,
            });
            let mut options = Map::new();
            if let Some(max) = req.max_tokens {
                options.insert("num_predict".to_string(), json!(max));
            }
            if let Some(t) = req.temperature {
                options.insert("temperature".to_string(), temperature_value(t));
            }
            if !options.is_empty() {
                body["options"] = Value::Object(options);
            }
            Ok(HttpRequest {
                url: join_url(&endpoints.ollama, "/api/chat"),
                headers: vec![content_type],
                body,
            })
        }
    }
}

/// Splits raw bytes into lines. Only `\n` bytes split, so multi-byte UTF-8 sequences that are
/// cut between chunks are reassembled before decoding.
#[derive(Debug, Default)]
struct LineBuffer {
    buf: Vec<u8>,
}

impl LineBuffer {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        for &byte in chunk {
            if byte == b'\n' {
                let mut raw = std::mem::take(&mut self.buf);
                if raw.last() == Some(&b'\r') {
                    raw.pop();
                }
                lines.push(String::from_utf8_lossy(&raw).into_owned());
            } else if self.buf.len() < MAX_LINE {
                self.buf.push(byte);
            }
        }
        lines
    }

    fn take_rest(&mut self) -> Option<String> {
        if self.buf.is_empty() {
            return None;
        }
        let raw = std::mem::take(&mut self.buf);
        Some(String::from_utf8_lossy(&raw).into_owned())
    }
}

fn error_event(message: &str) -> AiEvent {
    AiEvent::Error {
        message: truncate_chars(message, MAX_MESSAGE_CHARS),
        status: None,
    }
}

/// Incremental parser for one provider's streaming response body.
#[derive(Debug)]
pub struct StreamParser {
    kind: Provider,
    lines: LineBuffer,
    done: bool,
    saw_delta: bool,
    stop_reason: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

impl StreamParser {
    pub fn new(kind: Provider) -> Self {
        Self {
            kind,
            lines: LineBuffer::default(),
            done: false,
            saw_delta: false,
            stop_reason: None,
            input_tokens: None,
            output_tokens: None,
        }
    }

    pub fn feed(&mut self, chunk: &[u8]) -> Vec<AiEvent> {
        let mut out = Vec::new();
        for line in self.lines.push(chunk) {
            if self.done {
                break;
            }
            self.handle_line(&line, &mut out);
        }
        out
    }

    /// Call when the byte stream ended. Emits Done only when no terminal event was seen and at
    /// least one delta arrived.
    pub fn finish(&mut self) -> Vec<AiEvent> {
        let mut out = Vec::new();
        if let Some(line) = self.lines.take_rest() {
            if !self.done {
                self.handle_line(&line, &mut out);
            }
        }
        if !self.done && self.saw_delta {
            self.done = true;
            out.push(self.done_event());
        }
        out
    }

    fn done_event(&self) -> AiEvent {
        AiEvent::Done {
            stop_reason: self.stop_reason.clone(),
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
        }
    }

    fn push_delta(&mut self, text: &str, out: &mut Vec<AiEvent>) {
        if text.is_empty() {
            return;
        }
        self.saw_delta = true;
        out.push(AiEvent::Delta {
            text: text.to_string(),
        });
    }

    fn push_done(&mut self, out: &mut Vec<AiEvent>) {
        self.done = true;
        out.push(self.done_event());
    }

    fn push_error(&mut self, message: &str, out: &mut Vec<AiEvent>) {
        self.done = true;
        out.push(error_event(message));
    }

    fn handle_line(&mut self, line: &str, out: &mut Vec<AiEvent>) {
        match self.kind {
            Provider::Anthropic => {
                if let Some(data) = sse_data(line) {
                    self.handle_anthropic(data, out);
                }
            }
            Provider::OpenAI => {
                if let Some(data) = sse_data(line) {
                    self.handle_openai(data, out);
                }
            }
            Provider::Ollama => self.handle_ollama(line, out),
        }
    }

    fn handle_anthropic(&mut self, data: &str, out: &mut Vec<AiEvent>) {
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return;
        };
        match value["type"].as_str() {
            Some("content_block_delta") => {
                if value["delta"]["type"].as_str() == Some("text_delta") {
                    if let Some(text) = value["delta"]["text"].as_str() {
                        self.push_delta(text, out);
                    }
                }
            }
            Some("message_start") => {
                if let Some(n) = value["message"]["usage"]["input_tokens"].as_u64() {
                    self.input_tokens = Some(n);
                }
            }
            Some("message_delta") => {
                if let Some(reason) = value["delta"]["stop_reason"].as_str() {
                    self.stop_reason = Some(reason.to_string());
                }
                if let Some(n) = value["usage"]["output_tokens"].as_u64() {
                    self.output_tokens = Some(n);
                }
            }
            Some("message_stop") => self.push_done(out),
            Some("error") => {
                let message = value["error"]["message"]
                    .as_str()
                    .unwrap_or("provider error");
                self.push_error(message, out);
            }
            _ => {}
        }
    }

    fn handle_openai(&mut self, data: &str, out: &mut Vec<AiEvent>) {
        if data == "[DONE]" {
            self.push_done(out);
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(data) else {
            return;
        };
        let error = &value["error"];
        if !error.is_null() {
            let message = error["message"]
                .as_str()
                .or_else(|| error.as_str())
                .unwrap_or("provider error");
            self.push_error(message, out);
            return;
        }
        if let Some(choice) = value["choices"].as_array().and_then(|c| c.first()) {
            if let Some(text) = choice["delta"]["content"].as_str() {
                self.push_delta(text, out);
            }
            if let Some(reason) = choice["finish_reason"].as_str() {
                self.stop_reason = Some(reason.to_string());
            }
        }
        if let Some(n) = value["usage"]["prompt_tokens"].as_u64() {
            self.input_tokens = Some(n);
        }
        if let Some(n) = value["usage"]["completion_tokens"].as_u64() {
            self.output_tokens = Some(n);
        }
    }

    fn handle_ollama(&mut self, line: &str, out: &mut Vec<AiEvent>) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return;
        };
        if let Some(message) = value["error"].as_str() {
            self.push_error(message, out);
            return;
        }
        if let Some(text) = value["message"]["content"].as_str() {
            self.push_delta(text, out);
        }
        if value["done"].as_bool() == Some(true) {
            if let Some(reason) = value["done_reason"].as_str() {
                self.stop_reason = Some(reason.to_string());
            }
            if let Some(n) = value["prompt_eval_count"].as_u64() {
                self.input_tokens = Some(n);
            }
            if let Some(n) = value["eval_count"].as_u64() {
                self.output_tokens = Some(n);
            }
            self.push_done(out);
        }
    }
}

/// Returns the payload of an SSE `data:` line; ignores `event:`, comments and blank lines.
fn sse_data(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("data:")?;
    let data = rest.trim();
    if data.is_empty() {
        None
    } else {
        Some(data)
    }
}

fn truncate_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// Masks anything that looks like an API key (`sk-...`) in provider-supplied text.
fn redact_secrets(text: &str) -> String {
    text.split_whitespace()
        .map(|word| {
            if word
                .trim_start_matches(|c: char| !c.is_alphanumeric())
                .starts_with("sk-")
            {
                "[redacted]"
            } else {
                word
            }
        })
        .collect::<Vec<&str>>()
        .join(" ")
}

fn error_detail(body: &str) -> Option<String> {
    let value: Value = serde_json::from_str(body).ok()?;
    let error = &value["error"];
    error["message"]
        .as_str()
        .or_else(|| error.as_str())
        .or_else(|| value["message"].as_str())
        .map(str::to_string)
}

/// Maps a non-2xx response to a user-facing error event. Never includes request headers.
pub fn http_error(status: u16, body: &str) -> AiEvent {
    let base = match status {
        401 | 403 => "authentication failed — check the API key".to_string(),
        404 => "model or endpoint not found".to_string(),
        429 => "rate limited".to_string(),
        500..=599 => "provider error".to_string(),
        other => format!("request failed (HTTP {other})"),
    };
    let message = match error_detail(body) {
        Some(detail) if !detail.trim().is_empty() => {
            format!("{base}: {}", redact_secrets(detail.trim()))
        }
        _ => base,
    };
    AiEvent::Error {
        message: truncate_chars(&message, MAX_MESSAGE_CHARS),
        status: Some(status),
    }
}

enum Wait<T> {
    Ready(T),
    Cancelled,
    Stalled,
}

/// Awaits `fut` in short slices so cancellation is noticed promptly; gives up after the idle
/// timeout.
async fn wait_cancellable<F>(fut: &mut F, cancel: &CancelToken) -> Wait<F::Output>
where
    F: Future + Unpin,
{
    let start = Instant::now();
    loop {
        if cancel.is_cancelled() {
            return Wait::Cancelled;
        }
        if start.elapsed() >= IDLE_TIMEOUT {
            return Wait::Stalled;
        }
        if let Ok(value) = tokio::time::timeout(CANCEL_SLICE, &mut *fut).await {
            return Wait::Ready(value);
        }
    }
}

fn client_error(err: reqwest::Error) -> String {
    format!("request failed: {}", err.without_url())
}

fn build_client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none());
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    builder.build().map_err(client_error)
}

/// Streams a chat completion, calling `emit` for every event. Returns `Err` only when the
/// request could not be built or sent; provider errors are delivered as `AiEvent::Error`.
/// On cancellation nothing further is emitted.
pub async fn stream_chat(
    endpoints: &Endpoints,
    req: &ChatRequest,
    api_key: Option<String>,
    cancel: &CancelToken,
    mut emit: impl FnMut(AiEvent),
) -> Result<(), String> {
    let http = build_request(endpoints, req, api_key.as_deref())?;
    let client = build_client(None)?;
    let mut builder = client.post(&http.url);
    for (name, value) in &http.headers {
        builder = builder.header(name.as_str(), value.as_str());
    }
    let mut send = Box::pin(builder.body(http.body.to_string()).send());
    let response = match wait_cancellable(&mut send, cancel).await {
        Wait::Cancelled => return Ok(()),
        Wait::Stalled => {
            emit(error_event("provider stalled"));
            return Ok(());
        }
        Wait::Ready(Ok(response)) => response,
        Wait::Ready(Err(err)) => return Err(client_error(err)),
    };

    let status = response.status();
    let mut stream = Box::pin(response.bytes_stream());

    if !status.is_success() {
        let mut body: Vec<u8> = Vec::new();
        while body.len() < MAX_ERROR_BODY {
            let mut next = stream.next();
            match wait_cancellable(&mut next, cancel).await {
                Wait::Cancelled => return Ok(()),
                Wait::Stalled | Wait::Ready(None) | Wait::Ready(Some(Err(_))) => break,
                Wait::Ready(Some(Ok(bytes))) => body.extend_from_slice(&bytes),
            }
        }
        body.truncate(MAX_ERROR_BODY);
        emit(http_error(status.as_u16(), &String::from_utf8_lossy(&body)));
        return Ok(());
    }

    let mut parser = StreamParser::new(req.provider);
    let mut total: usize = 0;
    loop {
        let mut next = stream.next();
        match wait_cancellable(&mut next, cancel).await {
            Wait::Cancelled => return Ok(()),
            Wait::Stalled => {
                emit(error_event("provider stalled"));
                return Ok(());
            }
            Wait::Ready(None) => break,
            Wait::Ready(Some(Err(err))) => {
                emit(error_event(&format!(
                    "stream interrupted: {}",
                    err.without_url()
                )));
                return Ok(());
            }
            Wait::Ready(Some(Ok(bytes))) => {
                for event in parser.feed(&bytes) {
                    if let AiEvent::Delta { text } = &event {
                        total += text.len();
                        if total > MAX_RESPONSE_TEXT {
                            emit(error_event("response too large"));
                            return Ok(());
                        }
                    }
                    let terminal = matches!(event, AiEvent::Done { .. } | AiEvent::Error { .. });
                    emit(event);
                    if terminal {
                        return Ok(());
                    }
                }
            }
        }
    }
    for event in parser.finish() {
        emit(event);
    }
    Ok(())
}

/// Extracts model ids from a provider's model-list response. Sorted, deduplicated, capped.
pub fn parse_models(provider: Provider, body: &str) -> Vec<ModelInfo> {
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = match provider {
        Provider::Ollama => value["models"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|m| m["name"].as_str().or_else(|| m["model"].as_str()))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        Provider::Anthropic | Provider::OpenAI => value["data"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|m| m["id"].as_str())
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
    };
    ids.retain(|id| !id.is_empty());
    ids.sort();
    ids.dedup();
    ids.truncate(MAX_MODELS);
    ids.into_iter().map(|id| ModelInfo { id }).collect()
}

/// Lists the models a provider offers.
pub async fn list_models(
    endpoints: &Endpoints,
    provider: Provider,
    api_key: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    let base = endpoints.base(provider);
    let client = build_client(Some(LIST_TIMEOUT))?;
    let builder = match provider {
        Provider::Anthropic => {
            let key = require_key(provider, api_key.as_deref())?;
            client
                .get(join_url(base, "/v1/models?limit=1000"))
                .header("x-api-key", key)
                .header("anthropic-version", ANTHROPIC_VERSION)
        }
        Provider::OpenAI => {
            let key = require_key(provider, api_key.as_deref())?;
            client
                .get(join_url(base, "/v1/models"))
                .header("Authorization", format!("Bearer {key}"))
        }
        Provider::Ollama => {
            validate_ollama_base(base)?;
            client.get(join_url(base, "/api/tags"))
        }
    };
    let response = builder.send().await.map_err(client_error)?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(client_error)?;
    if bytes.len() > MAX_LIST_BODY {
        return Err("model list response too large".to_string());
    }
    let body = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        return match http_error(status.as_u16(), &body) {
            AiEvent::Error { message, .. } => Err(message),
            _ => Err("request failed".to_string()),
        };
    }
    Ok(parse_models(provider, &body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn request(provider: Provider) -> ChatRequest {
        ChatRequest {
            provider,
            model: "test-model".to_string(),
            messages: vec![
                Message {
                    role: "system".to_string(),
                    content: "Be brief.".to_string(),
                },
                Message {
                    role: "user".to_string(),
                    content: "Hi".to_string(),
                },
                Message {
                    role: "system".to_string(),
                    content: "Use English.".to_string(),
                },
            ],
            max_tokens: None,
            temperature: None,
        }
    }

    fn header<'a>(req: &'a HttpRequest, name: &str) -> Option<&'a str> {
        req.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    fn delta(text: &str) -> AiEvent {
        AiEvent::Delta {
            text: text.to_string(),
        }
    }

    fn parse_all(kind: Provider, input: &str) -> Vec<AiEvent> {
        let mut parser = StreamParser::new(kind);
        let mut events = parser.feed(input.as_bytes());
        events.extend(parser.finish());
        events
    }

    fn parse_bytewise(kind: Provider, input: &str) -> Vec<AiEvent> {
        let mut parser = StreamParser::new(kind);
        let mut events = Vec::new();
        for byte in input.as_bytes() {
            events.extend(parser.feed(std::slice::from_ref(byte)));
        }
        events.extend(parser.finish());
        events
    }

    // ---- builders ----

    #[test]
    fn anthropic_request_extracts_system_and_sets_headers() {
        let mut req = request(Provider::Anthropic);
        req.temperature = Some(0.5);
        let http = build_request(&Endpoints::default(), &req, Some("sk-ant-secret")).expect("ok");
        assert_eq!(http.url, "https://api.anthropic.com/v1/messages");
        assert_eq!(header(&http, "x-api-key"), Some("sk-ant-secret"));
        assert_eq!(header(&http, "anthropic-version"), Some("2023-06-01"));
        assert_eq!(header(&http, "content-type"), Some("application/json"));
        assert_eq!(http.body["system"], "Be brief.\n\nUse English.");
        assert_eq!(http.body["max_tokens"], 4096);
        assert_eq!(http.body["stream"], true);
        assert_eq!(http.body["messages"].as_array().map(Vec::len), Some(1));
        assert_eq!(http.body["messages"][0]["role"], "user");
        assert_eq!(http.body["temperature"].as_f64(), Some(0.5));
        assert!(!http.body.to_string().contains("sk-ant-secret"));
    }

    #[test]
    fn anthropic_without_system_omits_field_and_honors_max_tokens() {
        let mut req = request(Provider::Anthropic);
        req.messages.retain(|m| m.role != "system");
        req.max_tokens = Some(128);
        let http = build_request(&Endpoints::default(), &req, Some("k")).expect("ok");
        assert!(http.body.get("system").is_none());
        assert!(http.body.get("temperature").is_none());
        assert_eq!(http.body["max_tokens"], 128);
    }

    #[test]
    fn openai_request_uses_bearer_and_usage_options() {
        let mut req = request(Provider::OpenAI);
        req.max_tokens = Some(256);
        let http = build_request(&Endpoints::default(), &req, Some("sk-test")).expect("ok");
        assert_eq!(http.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(header(&http, "authorization"), Some("Bearer sk-test"));
        assert_eq!(http.body["stream"], true);
        assert_eq!(http.body["stream_options"]["include_usage"], true);
        assert_eq!(http.body["max_completion_tokens"], 256);
        assert_eq!(http.body["messages"].as_array().map(Vec::len), Some(3));
        assert!(http.body.get("temperature").is_none());
    }

    #[test]
    fn ollama_request_has_options_only_when_set() {
        let mut req = request(Provider::Ollama);
        let http = build_request(&Endpoints::default(), &req, None).expect("ok");
        assert_eq!(http.url, "http://127.0.0.1:11434/api/chat");
        assert!(http.body.get("options").is_none());
        assert!(header(&http, "authorization").is_none());
        req.max_tokens = Some(64);
        req.temperature = Some(0.25);
        let http = build_request(&Endpoints::default(), &req, None).expect("ok");
        assert_eq!(http.body["options"]["num_predict"], 64);
        assert_eq!(http.body["options"]["temperature"].as_f64(), Some(0.25));
    }

    #[test]
    fn missing_key_is_an_error() {
        let endpoints = Endpoints::default();
        for provider in [Provider::Anthropic, Provider::OpenAI] {
            let req = request(provider);
            assert!(build_request(&endpoints, &req, None).is_err());
            assert!(build_request(&endpoints, &req, Some("  ")).is_err());
        }
    }

    #[test]
    fn invalid_requests_are_rejected() {
        let endpoints = Endpoints::default();
        let mut req = request(Provider::Ollama);
        req.model = "  ".to_string();
        assert!(build_request(&endpoints, &req, None).is_err());

        let mut req = request(Provider::Ollama);
        req.messages.clear();
        assert!(build_request(&endpoints, &req, None).is_err());

        let mut req = request(Provider::Ollama);
        req.messages[1].role = "tool".to_string();
        assert!(build_request(&endpoints, &req, None).is_err());
    }

    #[test]
    fn remote_ollama_endpoint_is_rejected_by_builder() {
        let endpoints = Endpoints::with_base(Provider::Ollama, "https://evil.com");
        let req = request(Provider::Ollama);
        assert!(build_request(&endpoints, &req, None).is_err());
    }

    #[test]
    fn base_url_trailing_slash_is_trimmed() {
        let endpoints = Endpoints::with_base(Provider::OpenAI, "http://example.test/");
        let req = request(Provider::OpenAI);
        let http = build_request(&endpoints, &req, Some("k")).expect("ok");
        assert_eq!(http.url, "http://example.test/v1/chat/completions");
    }

    #[test]
    fn validate_ollama_base_accepts_and_rejects() {
        for ok in [
            "http://localhost:11434",
            "http://127.0.0.1:11434",
            "http://[::1]:11434",
            "https://localhost",
            "http://LOCALHOST:11434/",
        ] {
            assert!(validate_ollama_base(ok).is_ok(), "{ok}");
        }
        for bad in [
            "https://evil.com",
            "http://10.0.0.5",
            "http://10.0.0.5:11434",
            "ftp://localhost",
            "localhost:11434",
            "http://localhost@evil.com",
            "http://localhost.evil.com",
            "http://127.0.0.1:abc",
            "http://[::2]:11434",
            "",
        ] {
            assert!(validate_ollama_base(bad).is_err(), "{bad}");
        }
    }

    // ---- parsers ----

    fn anthropic_sample() -> String {
        [
            "event: message_start",
            r#"data: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":25,"output_tokens":1}}}"#,
            "",
            "event: content_block_start",
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            "",
            "event: ping",
            r#"data: {"type": "ping"}"#,
            "",
            ": a comment line",
            "event: content_block_delta",
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}"#,
            "",
            "event: content_block_delta",
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}"#,
            "",
            "event: content_block_delta",
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo é!"}}"#,
            "",
            "event: message_delta",
            r#"data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}"#,
            "",
            "event: message_stop",
            r#"data: {"type":"message_stop"}"#,
            "",
            "",
        ]
        .join("\n")
    }

    fn anthropic_expected() -> Vec<AiEvent> {
        vec![
            delta("Hel"),
            delta("lo é!"),
            AiEvent::Done {
                stop_reason: Some("end_turn".to_string()),
                input_tokens: Some(25),
                output_tokens: Some(15),
            },
        ]
    }

    #[test]
    fn anthropic_stream_parses() {
        assert_eq!(
            parse_all(Provider::Anthropic, &anthropic_sample()),
            anthropic_expected()
        );
    }

    #[test]
    fn anthropic_stream_is_chunk_boundary_safe() {
        assert_eq!(
            parse_bytewise(Provider::Anthropic, &anthropic_sample()),
            anthropic_expected()
        );
    }

    #[test]
    fn multibyte_character_split_across_chunks() {
        let sample = anthropic_sample();
        let bytes = sample.as_bytes();
        let split = bytes.iter().position(|b| *b == 0xC3).expect("multibyte") + 1;
        let mut parser = StreamParser::new(Provider::Anthropic);
        let mut events = parser.feed(&bytes[..split]);
        events.extend(parser.feed(&bytes[split..]));
        events.extend(parser.finish());
        assert_eq!(events, anthropic_expected());
    }

    #[test]
    fn anthropic_error_event_and_crlf() {
        let input = "event: error\r\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\r\n\r\n";
        let events = parse_all(Provider::Anthropic, input);
        assert_eq!(
            events,
            vec![AiEvent::Error {
                message: "Overloaded".to_string(),
                status: None,
            }]
        );
    }

    #[test]
    fn malformed_json_is_skipped() {
        let input = "data: {not json\n\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"ok\"}}\n";
        let events = parse_all(Provider::Anthropic, input);
        assert_eq!(
            events,
            vec![
                delta("ok"),
                AiEvent::Done {
                    stop_reason: None,
                    input_tokens: None,
                    output_tokens: None,
                },
            ]
        );
    }

    #[test]
    fn finish_without_delta_emits_nothing() {
        assert!(parse_all(Provider::Anthropic, "event: ping\n\n").is_empty());
        assert!(parse_all(Provider::Ollama, "").is_empty());
    }

    fn openai_sample() -> String {
        [
            r#"data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}"#,
            "",
            r#"data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}"#,
            "",
            r#"data: {"id":"c1","choices":[{"index":0,"delta":{"content":" ünï"},"finish_reason":null}]}"#,
            "",
            r#"data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#,
            "",
            r#"data: {"id":"c1","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":3,"total_tokens":12}}"#,
            "",
            "data: [DONE]",
            "",
            "",
        ]
        .join("\n")
    }

    fn openai_expected() -> Vec<AiEvent> {
        vec![
            delta("Hi"),
            delta(" ünï"),
            AiEvent::Done {
                stop_reason: Some("stop".to_string()),
                input_tokens: Some(9),
                output_tokens: Some(3),
            },
        ]
    }

    #[test]
    fn openai_stream_parses_including_bytewise() {
        assert_eq!(
            parse_all(Provider::OpenAI, &openai_sample()),
            openai_expected()
        );
        assert_eq!(
            parse_bytewise(Provider::OpenAI, &openai_sample()),
            openai_expected()
        );
    }

    #[test]
    fn openai_error_payload() {
        let input = "data: {\"error\":{\"message\":\"You exceeded your quota\",\"type\":\"insufficient_quota\"}}\n\n";
        assert_eq!(
            parse_all(Provider::OpenAI, input),
            vec![AiEvent::Error {
                message: "You exceeded your quota".to_string(),
                status: None,
            }]
        );
    }

    #[test]
    fn openai_stream_without_done_still_finishes() {
        let input = "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n";
        let events = parse_all(Provider::OpenAI, input);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], delta("a"));
        assert!(matches!(events[1], AiEvent::Done { .. }));
    }

    fn ollama_sample() -> String {
        [
            r#"{"model":"llama3","message":{"role":"assistant","content":"Hel"},"done":false}"#,
            r#"{"model":"llama3","message":{"role":"assistant","content":"lö"},"done":false}"#,
            r#"{"model":"llama3","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":11,"eval_count":7}"#,
            "",
        ]
        .join("\n")
    }

    fn ollama_expected() -> Vec<AiEvent> {
        vec![
            delta("Hel"),
            delta("lö"),
            AiEvent::Done {
                stop_reason: Some("stop".to_string()),
                input_tokens: Some(11),
                output_tokens: Some(7),
            },
        ]
    }

    #[test]
    fn ollama_stream_parses_including_bytewise() {
        assert_eq!(
            parse_all(Provider::Ollama, &ollama_sample()),
            ollama_expected()
        );
        assert_eq!(
            parse_bytewise(Provider::Ollama, &ollama_sample()),
            ollama_expected()
        );
    }

    #[test]
    fn ollama_error_line() {
        let events = parse_all(Provider::Ollama, "{\"error\":\"model 'x' not found\"}\n");
        assert_eq!(
            events,
            vec![AiEvent::Error {
                message: "model 'x' not found".to_string(),
                status: None,
            }]
        );
    }

    #[test]
    fn ollama_last_line_without_newline_is_parsed_on_finish() {
        let input = r#"{"message":{"content":"x"},"done":true,"done_reason":"stop"}"#;
        let events = parse_all(Provider::Ollama, input);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], delta("x"));
    }

    // ---- error mapping ----

    #[test]
    fn http_error_mapping() {
        let cases = [
            (401, "authentication failed"),
            (403, "authentication failed"),
            (404, "model or endpoint not found"),
            (429, "rate limited"),
            (503, "provider error"),
            (418, "HTTP 418"),
        ];
        for (status, expected) in cases {
            match http_error(status, "") {
                AiEvent::Error { message, status: s } => {
                    assert!(message.contains(expected), "{message}");
                    assert_eq!(s, Some(status));
                }
                other => panic!("unexpected event {other:?}"),
            }
        }
    }

    #[test]
    fn http_error_includes_provider_message_but_not_keys() {
        let body = r#"{"error":{"message":"Incorrect API key provided: sk-abc123def. Check it."}}"#;
        match http_error(401, body) {
            AiEvent::Error { message, .. } => {
                assert!(message.contains("authentication failed"));
                assert!(message.contains("Incorrect API key provided"));
                assert!(!message.contains("sk-abc123def"));
                assert!(!message.to_lowercase().contains("x-api-key"));
            }
            other => panic!("unexpected event {other:?}"),
        }
        let plain = r#"{"error":{"message":"model not found"}}"#;
        match http_error(404, plain) {
            AiEvent::Error { message, .. } => assert!(message.contains("model not found")),
            other => panic!("unexpected event {other:?}"),
        }
    }

    #[test]
    fn http_error_message_is_capped() {
        let body = format!(r#"{{"error":{{"message":"{}"}}}}"#, "x".repeat(2000));
        match http_error(500, &body) {
            AiEvent::Error { message, .. } => assert!(message.chars().count() <= 500),
            other => panic!("unexpected event {other:?}"),
        }
    }

    #[test]
    fn ai_event_serializes_camel_case() {
        let value = serde_json::to_value(AiEvent::Done {
            stop_reason: Some("stop".to_string()),
            input_tokens: Some(1),
            output_tokens: None,
        })
        .expect("serialize");
        assert_eq!(value["kind"], "done");
        assert_eq!(value["stopReason"], "stop");
        assert_eq!(value["inputTokens"], 1);
        assert!(value["outputTokens"].is_null());
    }

    #[test]
    fn chat_request_deserializes() {
        let raw = r#"{"provider":"openai","model":"m","messages":[{"role":"user","content":"x"}],"maxTokens":10}"#;
        let req: ChatRequest = serde_json::from_str(raw).expect("parse");
        assert_eq!(req.provider, Provider::OpenAI);
        assert_eq!(req.max_tokens, Some(10));
        assert_eq!(req.temperature, None);
    }

    // ---- models ----

    #[test]
    fn parse_models_per_provider() {
        let openai = r#"{"data":[{"id":"gpt-b"},{"id":"gpt-a"},{"id":"gpt-a"}]}"#;
        let ids: Vec<String> = parse_models(Provider::OpenAI, openai)
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, vec!["gpt-a", "gpt-b"]);

        let ollama = r#"{"models":[{"name":"llama3:8b"},{"name":"codellama"}]}"#;
        let ids: Vec<String> = parse_models(Provider::Ollama, ollama)
            .into_iter()
            .map(|m| m.id)
            .collect();
        assert_eq!(ids, vec!["codellama", "llama3:8b"]);

        assert!(parse_models(Provider::Anthropic, "not json").is_empty());
        assert!(parse_models(Provider::Anthropic, r#"{"data":"x"}"#).is_empty());
    }

    #[test]
    fn parse_models_is_capped() {
        let items: Vec<String> = (0..700).map(|i| format!(r#"{{"id":"m{i:04}"}}"#)).collect();
        let body = format!(r#"{{"data":[{}]}}"#, items.join(","));
        assert_eq!(parse_models(Provider::OpenAI, &body).len(), 500);
    }

    // ---- integration ----

    /// Starts a one-shot HTTP server that reads the full request and replies with `response`.
    async fn serve_once(response: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf: Vec<u8> = Vec::new();
                let mut tmp = [0u8; 1024];
                loop {
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..pos]).to_lowercase();
                        let length = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .and_then(|v| v.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if buf.len() >= pos + 4 + length {
                            break;
                        }
                    }
                    match socket.read(&mut tmp).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => buf.extend_from_slice(&tmp[..n]),
                    }
                }
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn stream_chat_ollama_end_to_end() {
        let body = [
            r#"{"message":{"content":"Hel"},"done":false}"#,
            r#"{"message":{"content":"lo"},"done":false}"#,
            r#"{"message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":3,"eval_count":2}"#,
            "",
        ]
        .join("\n");
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\nconnection: close\r\n\r\n{body}"
        );
        let base = serve_once(response).await;
        let endpoints = Endpoints::with_base(Provider::Ollama, &base);
        let req = request(Provider::Ollama);
        let cancel = CancelToken::new();
        let mut events = Vec::new();
        stream_chat(&endpoints, &req, None, &cancel, |e| events.push(e))
            .await
            .expect("stream");
        assert_eq!(
            events,
            vec![
                delta("Hel"),
                delta("lo"),
                AiEvent::Done {
                    stop_reason: Some("stop".to_string()),
                    input_tokens: Some(3),
                    output_tokens: Some(2),
                },
            ]
        );
    }

    #[tokio::test]
    async fn stream_chat_maps_401_to_error_event() {
        let body = r#"{"error":{"message":"invalid x-api-key"}}"#;
        let response = format!(
            "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n{body}"
        );
        let base = serve_once(response).await;
        let endpoints = Endpoints::with_base(Provider::Anthropic, &base);
        let req = request(Provider::Anthropic);
        let cancel = CancelToken::new();
        let mut events = Vec::new();
        stream_chat(
            &endpoints,
            &req,
            Some("secret-key".to_string()),
            &cancel,
            |e| events.push(e),
        )
        .await
        .expect("stream");
        assert_eq!(events.len(), 1);
        match &events[0] {
            AiEvent::Error { message, status } => {
                assert!(message.contains("authentication failed"), "{message}");
                assert!(!message.contains("secret-key"));
                assert_eq!(*status, Some(401));
            }
            other => panic!("unexpected event {other:?}"),
        }
    }
}
