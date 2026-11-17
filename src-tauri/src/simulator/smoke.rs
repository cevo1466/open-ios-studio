//! Headless installed-package check: compile the embedded app and invoke its actual callback.
use super::{Engine, BUNDLE_ID, EXAMPLE_SOURCE};
use crate::fs_engine::Workspace;
use serde_json::{json, Value};
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn frame(rx: &mpsc::Receiver<Value>) -> Result<Value, String> {
    loop {
        let event = rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|e| e.to_string())?;
        if event["kind"] == "frame" {
            return Ok(event["frame"].clone());
        }
    }
}
fn contains_text(node: &Value, expected: &str) -> bool {
    node["props"]["text"] == expected
        || node["children"]
            .as_array()
            .is_some_and(|children| children.iter().any(|child| contains_text(child, expected)))
}
fn button_id(node: &Value, text: &str) -> Option<String> {
    if node["kind"] == "button" && contains_text(node, text) {
        return node["id"].as_str().map(str::to_owned);
    }
    node["children"]
        .as_array()?
        .iter()
        .find_map(|child| button_id(child, text))
}

pub fn smoke_test(path: &std::ffi::OsStr) -> Result<Value, String> {
    let dir = tempfile::Builder::new()
        .prefix("ois-installed-check-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    std::fs::write(dir.path().join("Counter.swift"), EXAMPLE_SOURCE).map_err(|e| e.to_string())?;
    let engine = Engine::default();
    let (tx, rx) = mpsc::channel();
    let build = engine.start(
        Workspace::open(dir.path()).map_err(|e| e.to_string())?,
        "Counter.swift".into(),
        path,
        Arc::new(move |event| {
            let _ = tx.send(event);
        }),
    )?;
    if !build.ok {
        return Err(build.output.join("\n"));
    }
    let initial = frame(&rx)?;
    if !contains_text(&initial["root"], "Count: 0") {
        return Err("Embedded application initial state differs.".into());
    }
    let id = button_id(&initial["root"], "Increase")
        .ok_or("Embedded Increase callback was not registered.")?;
    engine.input(json!({"id":id}))?;
    let updated = frame(&rx)?;
    if !contains_text(&updated["root"], "Count: 1") {
        return Err("Compiled Swift callback did not update the counter.".into());
    }
    engine.stop()?;
    Ok(json!({"bundleId":BUNDLE_ID,"compiled":true,"initial":"Count: 0","afterClick":"Count: 1"}))
}
