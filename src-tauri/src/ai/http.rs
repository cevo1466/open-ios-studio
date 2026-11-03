//! The async HTTP runtime: streaming chat and model listing with cancellation and bounded bodies.

use std::future::Future;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde_json::Value;

use crate::runner::CancelToken;

use super::endpoints::*;
use super::stream::*;
use super::types::*;

pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const IDLE_TIMEOUT: Duration = Duration::from_secs(120);
pub(super) const LIST_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const CANCEL_SLICE: Duration = Duration::from_millis(250);
pub(super) const MAX_RESPONSE_TEXT: usize = 2 * 1024 * 1024;
pub(super) const MAX_LIST_BODY: usize = 4 * 1024 * 1024;
pub(super) const MAX_MODELS: usize = 500;

pub(super) enum Wait<T> {
    Ready(T),
    Cancelled,
    Stalled,
}

/// Awaits `fut` in short slices so cancellation is noticed promptly; gives up after the idle
/// timeout.
pub(super) async fn wait_cancellable<F>(fut: &mut F, cancel: &CancelToken) -> Wait<F::Output>
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

pub(super) fn client_error(err: reqwest::Error) -> String {
    format!("request failed: {}", err.without_url())
}

pub(super) fn build_client(timeout: Option<Duration>) -> Result<reqwest::Client, String> {
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
