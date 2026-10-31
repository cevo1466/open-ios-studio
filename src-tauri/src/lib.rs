mod fs_engine;
mod runner;
mod xtool;

use std::sync::Mutex;

use fs_engine::{Entry, FsError, ScanResult, Workspace};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct AppState {
    workspace: Mutex<Option<Workspace>>,
    /// Cancel handle of the xtool run in progress, if any (one run at a time).
    run: Mutex<Option<runner::CancelToken>>,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum RunEvent {
    Line {
        stream: runner::Stream,
        text: String,
    },
    Exit {
        code: Option<i32>,
        cancelled: bool,
        timed_out: bool,
        dropped_lines: u64,
    },
}

fn with_workspace<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&Workspace) -> Result<T, FsError>,
) -> Result<T, String> {
    let guard = state
        .workspace
        .lock()
        .map_err(|_| "internal state error".to_owned())?;
    let ws = guard
        .as_ref()
        .ok_or_else(|| "no workspace is open".to_owned())?;
    f(ws).map_err(|e| e.to_string())
}

/// The native folder picker runs in Rust so the webview can never choose an arbitrary root.
#[tauri::command]
async fn pick_workspace(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let ws = Workspace::open(&path).map_err(|e| e.to_string())?;
    let root = ws.root().to_string_lossy().into_owned();
    *state
        .workspace
        .lock()
        .map_err(|_| "internal state error".to_owned())? = Some(ws);
    Ok(Some(root))
}

#[tauri::command]
fn list_dir(state: State<'_, AppState>, path: String) -> Result<Vec<Entry>, String> {
    with_workspace(&state, |ws| ws.list_dir(&path))
}

#[tauri::command]
fn read_file(state: State<'_, AppState>, path: String) -> Result<String, String> {
    with_workspace(&state, |ws| ws.read_file(&path))
}

#[tauri::command]
fn write_file(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    with_workspace(&state, |ws| ws.write_file(&path, &content))
}

#[tauri::command]
fn create_file(state: State<'_, AppState>, path: String) -> Result<(), String> {
    with_workspace(&state, |ws| ws.create_file(&path))
}

/// Text files of the open workspace, for the static policy analysis in the webview.
#[tauri::command]
fn scan_workspace(state: State<'_, AppState>) -> Result<ScanResult, String> {
    with_workspace(&state, |ws| Ok(ws.scan_text_files()))
}

#[tauri::command]
async fn xtool_detect(state: State<'_, AppState>) -> Result<xtool::XtoolInfo, String> {
    let cwd = with_workspace(&state, |ws| Ok(ws.root().to_path_buf()))
        .unwrap_or_else(|_| std::env::temp_dir());
    tauri::async_runtime::spawn_blocking(move || {
        let path = std::env::var_os("PATH").unwrap_or_default();
        xtool::detect(&path, &cwd)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn xtool_run(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    op: String,
    args: xtool::RunArgs,
    on_event: Channel<RunEvent>,
) -> Result<(), String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let program = xtool::find_in_path("xtool", &path)
        .ok_or_else(|| "xtool was not found on PATH.".to_owned())?;
    let spec = with_workspace(&state, |ws| Ok(xtool::build_spec(&op, &args, &program, ws)))??;

    let cancel = runner::CancelToken::new();
    {
        let mut slot = state
            .run
            .lock()
            .map_err(|_| "internal state error".to_owned())?;
        if slot.is_some() {
            return Err("Another xtool run is still active.".to_owned());
        }
        *slot = Some(cancel.clone());
    }

    let sender = on_event.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        runner::run(&spec, &cancel, |stream, text| {
            let _ = sender.send(RunEvent::Line { stream, text });
        })
    })
    .await;

    if let Ok(mut slot) = app.state::<AppState>().run.lock() {
        *slot = None;
    }
    match result {
        Ok(Ok(info)) => {
            let _ = on_event.send(RunEvent::Exit {
                code: info.code,
                cancelled: info.cancelled,
                timed_out: info.timed_out,
                dropped_lines: info.dropped_lines,
            });
            Ok(())
        }
        Ok(Err(e)) => Err(format!("Could not start xtool: {e}")),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn xtool_cancel(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state
        .run
        .lock()
        .map_err(|_| "internal state error".to_owned())?
        .as_ref()
    {
        token.cancel();
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pick_workspace,
            list_dir,
            read_file,
            write_file,
            create_file,
            scan_workspace,
            xtool_detect,
            xtool_run,
            xtool_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open iOS Studio");
}
