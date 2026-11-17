use ois_simulator_harness::{fs_engine::Workspace, simulator::Engine};
use serde_json::{json, Value};
use std::sync::{mpsc, Arc};
use std::time::Duration;

fn frame(rx: &mpsc::Receiver<Value>) -> Value {
    loop {
        let event = rx
            .recv_timeout(Duration::from_secs(15))
            .expect("runtime frame within 15s");
        if event["kind"] == "frame" {
            return event["frame"].clone();
        }
    }
}
fn walk<'a>(node: &'a Value, out: &mut Vec<&'a Value>) {
    out.push(node);
    if let Some(children) = node["children"].as_array() {
        for child in children {
            walk(child, out);
        }
    }
}
fn nodes(frame: &Value) -> Vec<&Value> {
    let mut out = Vec::new();
    walk(&frame["root"], &mut out);
    out
}
fn texts(frame: &Value) -> String {
    nodes(frame)
        .iter()
        .filter_map(|n| n["props"]["text"].as_str())
        .collect::<Vec<_>>()
        .join("|")
}
fn button(frame: &Value, label: &str) -> String {
    nodes(frame)
        .into_iter()
        .find(|n| {
            n["kind"] == "button" && {
                let mut children = Vec::new();
                walk(n, &mut children);
                children.iter().any(|c| c["props"]["text"] == label)
            }
        })
        .unwrap_or_else(|| panic!("button {label} present"))
        .get("id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned()
}
fn kind(frame: &Value, kind: &str) -> String {
    nodes(frame)
        .into_iter()
        .find(|n| n["kind"] == kind)
        .expect("node kind present")["id"]
        .as_str()
        .unwrap()
        .into()
}

#[test]
fn compiled_swift_callbacks_binding_navigation_modals_rebuild_and_failure_retention() {
    let dir = tempfile::Builder::new()
        .prefix("ois space ü ")
        .tempdir()
        .unwrap();
    let source = include_str!("../../../examples/LocalSimulator/Counter.swift");
    std::fs::write(dir.path().join("Counter.swift"), source).unwrap();
    let engine = Engine::default();
    let path = std::env::var_os("PATH").unwrap();
    let (tx, rx) = mpsc::channel();
    let result = engine
        .start(
            Workspace::open(dir.path()).unwrap(),
            "Counter.swift".into(),
            &path,
            Arc::new(move |v| {
                let _ = tx.send(v);
            }),
        )
        .unwrap();
    assert!(result.ok, "compiler diagnostics: {:?}", result.output);
    let mut current = frame(&rx);
    assert!(texts(&current).contains("Count: 0"));
    for expected in [1, 2, 3] {
        engine
            .input(json!({"id":button(&current,"Increase")}))
            .unwrap();
        current = frame(&rx);
        assert!(texts(&current).contains(&format!("Count: {expected}")));
    }
    engine
        .input(json!({"id":kind(&current,"textfield"),"value":"Çağrı 🦀"}))
        .unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Hello, Çağrı 🦀!"));
    engine
        .input(json!({"id":kind(&current,"toggle"),"value":false}))
        .unwrap();
    current = frame(&rx);
    engine
        .input(json!({"id":button(&current,"Increase")}))
        .unwrap();
    current = frame(&rx);
    assert!(
        texts(&current).contains("Count: 3"),
        "Swift conditional application logic must run"
    );
    engine
        .input(json!({"id":kind(&current,"slider"),"value":0.75}))
        .unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Level: 75"));
    engine
        .input(json!({"id":button(&current,"Open details")}))
        .unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Navigation executed by Swift"));
    engine.input(json!({"id":button(&current,"Back")})).unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Count: 3"));
    for (label, modal) in [("Show sheet", "sheet"), ("Show alert", "alert")] {
        engine.input(json!({"id":button(&current,label)})).unwrap();
        current = frame(&rx);
        assert!(nodes(&current).iter().any(|n| n["kind"] == modal));
        engine
            .input(json!({"id":button(&current,"Close")}))
            .unwrap();
        current = frame(&rx);
        assert!(!nodes(&current).iter().any(|n| n["kind"] == modal));
    }
    std::fs::write(
        dir.path().join("Counter.swift"),
        "import SwiftUI\nthis is invalid Swift",
    )
    .unwrap();
    let failed = engine
        .start(
            Workspace::open(dir.path()).unwrap(),
            "Counter.swift".into(),
            &path,
            Arc::new(|_| {}),
        )
        .unwrap();
    assert!(!failed.ok);
    assert!(failed
        .output
        .iter()
        .any(|line| line.contains("Counter.swift:") && line.contains("error:")));
    engine
        .input(json!({"id":kind(&current,"textfield"),"value":"Still alive"}))
        .unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Hello, Still alive!"));
    let changed = source
        .replace("count = 0", "count = 40")
        .replace("count += enabled ? 1 : 0", "count += enabled ? 7 : 0");
    std::fs::write(dir.path().join("Counter.swift"), changed).unwrap();
    let (tx2, rx2) = mpsc::channel();
    let rebuilt = engine
        .start(
            Workspace::open(dir.path()).unwrap(),
            "Counter.swift".into(),
            &path,
            Arc::new(move |v| {
                let _ = tx2.send(v);
            }),
        )
        .unwrap();
    assert!(rebuilt.ok, "{:?}", rebuilt.output);
    current = frame(&rx2);
    assert!(texts(&current).contains("Count: 40"));
    engine
        .input(json!({"id":button(&current,"Increase")}))
        .unwrap();
    current = frame(&rx2);
    assert!(
        texts(&current).contains("Count: 47"),
        "changed Swift callback, no fixed counter behavior"
    );
    engine.stop().unwrap();
    assert!(engine.input(json!({"id":"root"})).is_err());
}

#[test]
fn child_binding_secure_input_and_tab_selection_execute_in_swift() {
    let dir = tempfile::Builder::new()
        .prefix("ois space ü ")
        .tempdir()
        .unwrap();
    std::fs::write(
        dir.path().join("Demo.swift"),
        include_str!("../../../examples/BindingAndTabs/Demo.swift"),
    )
    .unwrap();
    let engine = Engine::default();
    let (tx, rx) = mpsc::channel();
    let result = engine
        .start(
            Workspace::open(dir.path()).unwrap(),
            "Demo.swift".into(),
            &std::env::var_os("PATH").unwrap(),
            Arc::new(move |v| {
                let _ = tx.send(v);
            }),
        )
        .unwrap();
    assert!(result.ok, "{:?}", result.output);
    let mut current = frame(&rx);
    assert!(texts(&current).contains("Selected: 10, count: 5"));
    engine
        .input(json!({"id":button(&current,"Child add two")}))
        .unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Selected: 10, count: 7"));
    engine
        .input(json!({"id":kind(&current,"securefield"),"value":"a🔐"}))
        .unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Password length: 2"));
    engine
        .input(json!({"id":kind(&current,"tabs"),"value":20}))
        .unwrap();
    current = frame(&rx);
    assert!(texts(&current).contains("Selected: 20, count: 7"));
    let tabs = nodes(&current)
        .into_iter()
        .find(|n| n["kind"] == "tabs")
        .unwrap();
    assert_eq!(tabs["props"]["selection"], "20");
    assert_eq!(tabs["children"][0]["props"]["tabTitle"], "First");
    assert_eq!(tabs["children"][1]["props"]["tag"], "20");
    engine.stop().unwrap();
}

#[test]
fn bundled_executable_contract_compiles_and_runs_embedded_example() {
    let info = ois_simulator_harness::simulator::info(std::ffi::OsStr::new(""));
    assert!(info.compiler_path.is_none());
    assert_eq!(info.bundle_id, "open-ios-studio.local-swift.v1");
    let result =
        ois_simulator_harness::simulator::smoke_test(&std::env::var_os("PATH").unwrap()).unwrap();
    assert_eq!(result["compiled"], true);
    assert_eq!(result["afterClick"], "Count: 1");
}
