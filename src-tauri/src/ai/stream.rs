//! Streaming response parsers (SSE / NDJSON) and error mapping; never includes request headers.

use serde_json::Value;

use super::types::*;

pub(super) const MAX_ERROR_BODY: usize = 64 * 1024;
pub(super) const MAX_LINE: usize = 4 * 1024 * 1024;
pub(super) const MAX_MESSAGE_CHARS: usize = 500;

/// Splits raw bytes into lines. Only `\n` bytes split, so multi-byte UTF-8 sequences that are
/// cut between chunks are reassembled before decoding.
#[derive(Debug, Default)]
pub(super) struct LineBuffer {
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

pub(super) fn error_event(message: &str) -> AiEvent {
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
pub(super) fn sse_data(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("data:")?;
    let data = rest.trim();
    if data.is_empty() {
        None
    } else {
        Some(data)
    }
}

pub(super) fn truncate_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// Masks anything that looks like an API key (`sk-...`) in provider-supplied text.
pub(super) fn redact_secrets(text: &str) -> String {
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

pub(super) fn error_detail(body: &str) -> Option<String> {
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
