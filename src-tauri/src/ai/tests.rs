//! Tests for the AI engine; shared helpers live at the top.

use super::endpoints::*;
use super::http::*;
use super::stream::*;
use super::types::*;
use crate::runner::CancelToken;
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
