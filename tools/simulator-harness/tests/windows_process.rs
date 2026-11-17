#![cfg(windows)]
use ois_simulator_harness::runner::{self, CancelToken, Spec};
use std::time::Duration;

#[test]
fn timeout_kills_windows_descendants_and_lookup_finds_exe() {
    let dir = tempfile::tempdir().unwrap();
    let marker = dir.path().join("escaped.txt");
    let binary = std::path::PathBuf::from(env!("CARGO_BIN_EXE_ois-process-fixture"));
    let path = std::env::join_paths([binary.parent().unwrap()]).unwrap();
    assert_eq!(
        ois_simulator_harness::xtool::find_in_path("ois-process-fixture", &path),
        Some(binary.clone())
    );
    let spec = Spec {
        program: binary,
        args: vec!["parent".into(), marker.to_string_lossy().into_owned()],
        cwd: dir.path().into(),
        env: vec![],
        timeout: Duration::from_millis(400),
    };
    let mut lines = Vec::new();
    let result = runner::run(&spec, &CancelToken::new(), |_, line| lines.push(line)).unwrap();
    assert!(result.timed_out);
    assert!(lines.iter().any(|line| line.starts_with("child:")));
    std::thread::sleep(Duration::from_secs(3));
    assert!(
        !marker.exists(),
        "Job Object must terminate descendants as well as their parent"
    );
}
