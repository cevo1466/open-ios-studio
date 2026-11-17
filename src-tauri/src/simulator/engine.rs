use crate::{fs_engine::Workspace, runner, xtool};
use serde::Serialize;
use serde_json::{json, Value};
use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const SHIM: &str = super::SWIFT_UI_SOURCE;
const MAX_LINE: u64 = 1024 * 1024;
type Emit = Arc<dyn Fn(Value) + Send + Sync>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub ok: bool,
    pub output: Vec<String>,
}

struct Session {
    child: Arc<Mutex<Child>>,
    input: mpsc::SyncSender<String>,
    tree: Arc<crate::process_tree::ProcessTree>,
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            kill(&mut child, &self.tree);
        }
    }
}
#[derive(Default)]
struct Inner {
    session: Option<Session>,
    build: Option<runner::CancelToken>,
}
#[derive(Default)]
pub struct Engine {
    inner: Mutex<Inner>,
}

fn kill(child: &mut Child, tree: &crate::process_tree::ProcessTree) {
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    tree.terminate(child, true);
    let _ = child.kill();
    let _ = child.wait();
}

/// Compile direct sibling Swift files only; no package manifests or package plugins execute.
pub fn sources(ws: &Workspace, selected: &str) -> Result<Vec<PathBuf>, String> {
    let path = ws.resolve(selected).map_err(|e| e.to_string())?;
    if path.extension() != Some(OsStr::new("swift")) || !path.is_file() {
        return Err("Select an existing .swift file containing an App entry point.".into());
    }
    let parent = Path::new(selected).parent().unwrap_or(Path::new(""));
    let mut files = Vec::new();
    for entry in ws
        .list_dir(&parent.to_string_lossy())
        .map_err(|e| e.to_string())?
    {
        if !entry.is_dir && entry.name.ends_with(".swift") && entry.name != "Package.swift" {
            files.push(ws.resolve(&entry.path).map_err(|e| e.to_string())?);
        }
    }
    if files.len() > 64 {
        return Err("Simulator supports at most 64 sibling Swift files.".into());
    }
    files.sort();
    Ok(files)
}

impl Engine {
    pub fn stop(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
        if let Some(cancel) = &inner.build {
            cancel.cancel();
        }
        inner.session = None;
        Ok(())
    }

    pub fn input(&self, event: Value) -> Result<(), String> {
        if !event.get("id").is_some_and(Value::is_string) {
            return Err("Input requires a node id.".into());
        }
        let line = serde_json::to_string(&event).map_err(|e| e.to_string())?;
        if line.len() > 8192 {
            return Err("Input exceeds 8 KiB.".into());
        }
        let inner = self.inner.lock().map_err(|e| e.to_string())?;
        let session = inner.session.as_ref().ok_or("Simulator is stopped.")?;
        session
            .input
            .try_send(line)
            .map_err(|_| "Application input queue is busy or closed.".into())
    }

    pub fn start(
        &self,
        ws: Workspace,
        selected: String,
        path: &OsStr,
        emit: Emit,
    ) -> Result<BuildResult, String> {
        let cancel = runner::CancelToken::new();
        {
            let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
            if inner.build.is_some() {
                return Err("A simulator build is already running.".into());
            }
            inner.build = Some(cancel.clone());
        }
        let result = self.build(&ws, &selected, path, &cancel, emit);
        if let Ok(mut inner) = self.inner.lock() {
            inner.build = None;
        }
        result
    }

    fn build(
        &self,
        ws: &Workspace,
        selected: &str,
        path: &OsStr,
        cancel: &runner::CancelToken,
        emit: Emit,
    ) -> Result<BuildResult, String> {
        {
            let files = sources(ws, selected)?;
            let compiler = xtool::find_in_path("swiftc", path)
                .ok_or("swiftc was not found. Install the Swift toolchain for your platform.")?;
            // Atomic random creation owns only this build's directory. A clock-based
            // name can collide across parallel engines on Windows, and a failed
            // creation must never delete another build's directory.
            let dir = tempfile::Builder::new()
                .prefix("ois-simulator-")
                .tempdir()
                .map_err(|e| e.to_string())?;
            let shim = dir.path().join("SwiftUI.swift");
            std::fs::write(&shim, SHIM).map_err(|e| e.to_string())?;
            let library = if cfg!(windows) {
                "SwiftUI.dll"
            } else if cfg!(target_os = "macos") {
                "libSwiftUI.dylib"
            } else {
                "libSwiftUI.so"
            };
            let module = dir.path().join("SwiftUI.swiftmodule");
            let executable = dir.path().join(if cfg!(windows) {
                "application.exe"
            } else {
                "application"
            });
            let s = |p: &Path| {
                let value = p.to_string_lossy().into_owned();
                #[cfg(windows)]
                let value = if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
                    format!(r"\\{unc}")
                } else {
                    value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
                };
                value
            };
            let mut output = Vec::new();
            let commands = [
                vec![
                    "-swift-version".into(),
                    "5".into(),
                    "-emit-library".into(),
                    "-emit-module".into(),
                    "-module-name".into(),
                    "SwiftUI".into(),
                    s(&shim),
                    "-o".into(),
                    s(&dir.path().join(library)),
                    "-emit-module-path".into(),
                    s(&module),
                ],
                {
                    let mut args = vec![
                        "-swift-version".into(),
                        "5".into(),
                        "-parse-as-library".into(),
                        "-I".into(),
                        s(dir.path()),
                        "-L".into(),
                        s(dir.path()),
                        "-lSwiftUI".into(),
                    ];
                    if !cfg!(windows) {
                        args.extend([
                            "-Xlinker".into(),
                            "-rpath".into(),
                            "-Xlinker".into(),
                            s(dir.path()),
                        ]);
                    }
                    args.extend(files.iter().map(|p| s(p)));
                    args.extend(["-o".into(), s(&executable)]);
                    args
                },
            ];
            for args in commands {
                if cancel.is_cancelled() {
                    return Err("Simulator build cancelled.".into());
                }
                let spec = runner::Spec {
                    program: compiler.clone(),
                    args,
                    cwd: ws.root().into(),
                    env: vec![("PATH".into(), path.to_string_lossy().into_owned())],
                    timeout: Duration::from_secs(120),
                };
                let info = runner::run(&spec, cancel, |_, line| {
                    if output.len() < 300 {
                        output.push(line);
                    }
                })
                .map_err(|e| e.to_string())?;
                if info.cancelled || info.timed_out {
                    return Err(if info.timed_out {
                        "Swift compilation timed out."
                    } else {
                        "Simulator build cancelled."
                    }
                    .into());
                }
                if info.code != Some(0) {
                    return Ok(BuildResult { ok: false, output });
                }
            }
            if cancel.is_cancelled() {
                return Err("Simulator build cancelled.".into());
            }
            let mut command = Command::new(&executable);
            command
                .current_dir(ws.root())
                .env_clear()
                .env("PATH", path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            for key in ["HOME", "LANG", "LC_ALL", "TMPDIR"] {
                if let Some(value) = std::env::var_os(key) {
                    command.env(key, value);
                }
            }
            for (key, value) in crate::process_env::platform_pairs() {
                command.env(key, value);
            }
            crate::process_tree::prepare(&mut command);
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            let tree = Arc::new(
                crate::process_tree::ProcessTree::attach(&mut child).map_err(|e| e.to_string())?,
            );
            let stdout = child.stdout.take().ok_or("Missing runtime stdout")?;
            let stderr = child.stderr.take().ok_or("Missing runtime stderr")?;
            let mut stdin = child.stdin.take().ok_or("Missing runtime stdin")?;
            let child = Arc::new(Mutex::new(child));
            let (tx, rx) = mpsc::sync_channel::<String>(64);
            thread::spawn(move || {
                while let Ok(line) = rx.recv() {
                    if writeln!(stdin, "{line}").is_err() {
                        break;
                    }
                }
            });
            // Wait for a real initial frame before replacing the latest successful application.
            let (ready_tx, ready_rx) = mpsc::sync_channel(1);
            let frame_emit = emit.clone();
            let reader_child = child.clone();
            let reader_tree = tree.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut total = 0;
                let mut first = true;
                loop {
                    let mut bytes = Vec::new();
                    let count = reader
                        .by_ref()
                        .take(MAX_LINE + 1)
                        .read_until(b'\n', &mut bytes)
                        .unwrap_or(0);
                    if count == 0 {
                        break;
                    }
                    total += count;
                    if count as u64 > MAX_LINE || total > 32 * 1024 * 1024 {
                        frame_emit(
                            json!({"kind":"log","text":"Runtime output limit exceeded; session terminated."}),
                        );
                        if let Ok(mut c) = reader_child.lock() {
                            kill(&mut c, &reader_tree);
                        }
                        break;
                    }
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(json) = line.strip_prefix("OIS:") {
                        if let Ok(frame) = serde_json::from_str::<Value>(json) {
                            if frame.get("root").is_some() {
                                if first {
                                    let _ = ready_tx.send(());
                                    first = false;
                                }
                                frame_emit(json!({"kind":"frame","frame":frame}));
                            }
                        }
                    } else {
                        frame_emit(json!({"kind":"log","text":line.trim_end()}));
                    }
                }
            });
            let err_emit = emit.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stderr);
                for _ in 0..200 {
                    let mut bytes = Vec::new();
                    if reader
                        .by_ref()
                        .take(8192)
                        .read_until(b'\n', &mut bytes)
                        .unwrap_or(0)
                        == 0
                    {
                        return;
                    }
                    err_emit(
                        json!({"kind":"log","text":String::from_utf8_lossy(&bytes).trim_end()}),
                    );
                }
                // Keep draining so a verbose child cannot block on stderr.
                let _ = std::io::copy(&mut reader, &mut std::io::sink());
            });
            if ready_rx.recv_timeout(Duration::from_secs(10)).is_err() {
                if let Ok(mut c) = child.lock() {
                    kill(&mut c, &tree);
                }
                return Err("Application did not produce a UI frame within 10 seconds. Last session retained.".into());
            }
            {
                let mut inner = self.inner.lock().map_err(|e| e.to_string())?;
                if cancel.is_cancelled() {
                    if let Ok(mut c) = child.lock() {
                        kill(&mut c, &tree);
                    }
                    return Err("Simulator build cancelled.".into());
                }
                inner.session = Some(Session {
                    child: child.clone(),
                    input: tx,
                    tree: tree.clone(),
                });
            }
            thread::spawn(move || {
                let _dir = dir;
                let started = Instant::now();
                loop {
                    thread::sleep(Duration::from_millis(100));
                    let Ok(mut c) = child.lock() else {
                        return;
                    };
                    if started.elapsed() > Duration::from_secs(3600) {
                        kill(&mut c, &tree);
                    }
                    match c.try_wait() {
                        Ok(Some(status)) => {
                            emit(json!({"kind":"exit","code":status.code()}));
                            return;
                        }
                        Err(_) => return,
                        _ => {}
                    }
                }
            });
            Ok(BuildResult { ok: true, output })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_selection_rejects_escape_and_does_not_execute_package_manifests() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("App.swift"), "import SwiftUI").unwrap();
        std::fs::write(dir.path().join("Package.swift"), "fatalError()").unwrap();
        let ws = Workspace::open(dir.path()).unwrap();
        assert!(sources(&ws, "../App.swift").is_err());
        assert_eq!(sources(&ws, "App.swift").unwrap().len(), 1);
    }
    #[test]
    fn input_without_session_is_an_error() {
        let engine = Engine::default();
        assert!(engine.input(json!({"id":"node"})).is_err());
        assert!(engine.input(json!({"value":1})).is_err());
        assert!(engine.stop().is_ok());
    }
}
