//! Provider base URLs and pure request builders (no I/O).

use serde_json::{json, Map, Value};

use super::types::*;

pub(super) const DEFAULT_MAX_TOKENS: u32 = 4096;
pub(super) const ANTHROPIC_VERSION: &str = "2023-06-01";

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

    pub(super) fn base(&self, provider: Provider) -> &str {
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

pub(super) fn join_url(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

pub(super) fn temperature_value(t: f32) -> Value {
    let rounded = (f64::from(t) * 10_000.0).round() / 10_000.0;
    json!(rounded)
}

pub(super) fn require_key(provider: Provider, api_key: Option<&str>) -> Result<String, String> {
    api_key
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{} API key is not set", provider.label()))
}

pub(super) fn validate_request(req: &ChatRequest) -> Result<(), String> {
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

pub(super) fn message_json(message: &Message) -> Value {
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
