//! Development/test transport for the same Engine used by Tauri; JSON lines over stdio.
use ois_simulator_harness::{fs_engine::Workspace, simulator::Engine};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex};

fn main() {
    let root = std::env::args_os()
        .nth(1)
        .expect("usage: ois-simulator-harness WORKSPACE");
    let output = Arc::new(Mutex::new(std::io::stdout()));
    let send = move |value: Value| {
        if let Ok(mut stdout) = output.lock() {
            let _ = writeln!(stdout, "{value}");
            let _ = stdout.flush();
        }
    };
    let send = Arc::new(send);
    let engine = Engine::default();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else {
            break;
        };
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = request["id"].as_u64().unwrap_or(0);
        let result: Result<Value, String> = match request["op"].as_str() {
            Some("start") => Workspace::open(std::path::Path::new(&root))
                .map_err(|e| e.to_string())
                .and_then(|ws| {
                    let emitter = send.clone();
                    engine
                        .start(
                            ws,
                            request["path"].as_str().unwrap_or_default().into(),
                            &std::env::var_os("PATH").unwrap_or_default(),
                            Arc::new(move |event| emitter(json!({"stream":id,"event":event}))),
                        )
                        .and_then(|value| serde_json::to_value(value).map_err(|e| e.to_string()))
                }),
            Some("info") => serde_json::to_value(ois_simulator_harness::simulator::info(
                &std::env::var_os("PATH").unwrap_or_default(),
            ))
            .map_err(|e| e.to_string()),
            Some("input") => engine.input(request["event"].clone()).map(|_| Value::Null),
            Some("stop") => engine.stop().map(|_| Value::Null),
            _ => Err("Unknown operation".into()),
        };
        match result {
            Ok(value) => send(json!({"reply":id,"result":value})),
            Err(error) => send(json!({"reply":id,"error":error})),
        }
    }
    let _ = engine.stop();
}
