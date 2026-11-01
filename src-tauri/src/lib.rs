mod ai;
mod cli_ai;
mod fs_engine;
mod pty;
mod reveal;
mod runner;
mod secrets;
mod xtool;

use std::sync::Mutex;

use fs_engine::{Entry, FsError, ScanResult, Workspace};
use secrets::SecretStore;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct AppState {
    workspace: Mutex<Option<Workspace>>,
    /// Cancel handle of the xtool run in progress, if any (one run at a time).
    run: Mutex<Option<runner::CancelToken>>,
    /// Cancel handle of the AI request in progress, if any (one at a time).
    ai_run: Mutex<Option<runner::CancelToken>>,
    /// Embedded terminal sessions (ADR-0009).
    pty: pty::PtyState,
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

/// `PATH` plus the per-user tool directories (swiftly, ~/.local/bin, ...), so tools installed
/// outside the desktop session's PATH are found.
fn tool_path() -> std::ffi::OsString {
    cli_ai::child_path().unwrap_or_else(|| std::env::var_os("PATH").unwrap_or_default())
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

/// `None` when the file does not exist (used to tell new files from edits in the review).
#[tauri::command]
fn read_file_if_exists(state: State<'_, AppState>, path: String) -> Result<Option<String>, String> {
    with_workspace(&state, |ws| ws.read_file_if_exists(&path))
}

/// Used by the change review: writes an approved file, creating parent folders in the workspace.
#[tauri::command]
fn apply_file(state: State<'_, AppState>, path: String, content: String) -> Result<(), String> {
    with_workspace(&state, |ws| ws.write_file_creating_dirs(&path, &content))
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
        let path = tool_path();
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
    let path = tool_path();
    let program = xtool::find_in_path("xtool", &path)
        .ok_or_else(|| "xtool was not found on PATH.".to_owned())?;
    let mut spec = with_workspace(&state, |ws| Ok(xtool::build_spec(&op, &args, &program, ws)))??;
    // xtool calls `swift`; give it the same widened PATH used for detection.
    spec.env
        .push(("PATH".to_owned(), path.to_string_lossy().into_owned()));

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

fn provider_name(provider: ai::Provider) -> Option<&'static str> {
    match provider {
        ai::Provider::Anthropic => Some("anthropic"),
        ai::Provider::OpenAI => Some("openai"),
        ai::Provider::Ollama => None,
    }
}

/// The stored key for a provider, read from the OS keyring (never sent to the webview).
async fn key_for(provider: ai::Provider) -> Result<Option<String>, String> {
    let Some(name) = provider_name(provider) else {
        return Ok(None);
    };
    let account = secrets::account_for(name)?;
    let stored = tauri::async_runtime::spawn_blocking(move || secrets::KeyringStore.get(&account))
        .await
        .map_err(|e| e.to_string())??;
    stored
        .map(Some)
        .ok_or_else(|| format!("No API key is stored for {name}. Add one in the AI panel."))
}

#[tauri::command]
async fn secret_set(provider: String, key: String) -> Result<(), String> {
    let account = secrets::account_for(&provider)?;
    secrets::validate_key(&key)?;
    tauri::async_runtime::spawn_blocking(move || secrets::KeyringStore.set(&account, &key))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn secret_delete(provider: String) -> Result<(), String> {
    let account = secrets::account_for(&provider)?;
    tauri::async_runtime::spawn_blocking(move || secrets::KeyringStore.delete(&account))
        .await
        .map_err(|e| e.to_string())?
}

/// Whether a key is stored. The key itself is never returned.
#[tauri::command]
async fn secret_status(provider: String) -> Result<bool, String> {
    let account = secrets::account_for(&provider)?;
    let stored = tauri::async_runtime::spawn_blocking(move || secrets::KeyringStore.get(&account))
        .await
        .map_err(|e| e.to_string())??;
    Ok(stored.is_some())
}

#[tauri::command]
async fn ai_list_models(provider: ai::Provider) -> Result<Vec<ai::ModelInfo>, String> {
    let key = key_for(provider).await?;
    ai::list_models(&ai::Endpoints::default(), provider, key).await
}

#[tauri::command]
async fn ai_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: ai::ChatRequest,
    on_event: Channel<ai::AiEvent>,
) -> Result<(), String> {
    let key = key_for(request.provider).await?;
    let cancel = runner::CancelToken::new();
    {
        let mut slot = state
            .ai_run
            .lock()
            .map_err(|_| "internal state error".to_owned())?;
        if slot.is_some() {
            return Err("Another AI request is still active.".to_owned());
        }
        *slot = Some(cancel.clone());
    }

    let sender = on_event.clone();
    let result = ai::stream_chat(&ai::Endpoints::default(), &request, key, &cancel, |event| {
        let _ = sender.send(event);
    })
    .await;

    if let Ok(mut slot) = app.state::<AppState>().ai_run.lock() {
        *slot = None;
    }
    if let Err(message) = result {
        let _ = on_event.send(ai::AiEvent::Error {
            message,
            status: None,
        });
    }
    Ok(())
}

#[tauri::command]
fn ai_cancel(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state
        .ai_run
        .lock()
        .map_err(|_| "internal state error".to_owned())?
        .as_ref()
    {
        token.cancel();
    }
    Ok(())
}

/// Opens the item's folder (or its containing folder) in the system file manager.
#[tauri::command]
fn reveal_path(state: State<'_, AppState>, path: String, parent: bool) -> Result<(), String> {
    let abs = with_workspace(&state, |ws| ws.resolve(&path))?;
    let dir = reveal::reveal_target(&abs, parent)?;
    reveal::open_in_file_manager(&dir)
}

#[tauri::command]
async fn cli_status(provider: cli_ai::CliKind) -> Result<cli_ai::CliStatus, String> {
    Ok(cli_ai::status(provider).await)
}

/// Opens the system terminal on the CLI's fixed login command. Returns the terminal's name.
#[tauri::command]
fn cli_login_terminal(provider: cli_ai::CliKind) -> Result<String, String> {
    cli_ai::open_login_terminal(provider)
}

#[tauri::command]
async fn cli_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: cli_ai::CliChatRequest,
    on_event: Channel<ai::AiEvent>,
) -> Result<(), String> {
    let cancel = runner::CancelToken::new();
    {
        let mut slot = state
            .ai_run
            .lock()
            .map_err(|_| "internal state error".to_owned())?;
        if slot.is_some() {
            return Err("Another AI request is still active.".to_owned());
        }
        *slot = Some(cancel.clone());
    }

    let sender = on_event.clone();
    let result = cli_ai::stream_cli(&request, &cancel, |event| {
        let _ = sender.send(event);
    })
    .await;

    if let Ok(mut slot) = app.state::<AppState>().ai_run.lock() {
        *slot = None;
    }
    if let Err(message) = result {
        let _ = on_event.send(ai::AiEvent::Error {
            message,
            status: None,
        });
    }
    Ok(())
}

#[tauri::command]
fn pty_open(
    state: State<'_, AppState>,
    kind: pty::PtyKind,
    options: Option<pty::PtyOptions>,
    rows: u16,
    cols: u16,
    on_event: Channel<pty::PtyEvent>,
) -> Result<u32, String> {
    let cwd = {
        let guard = state
            .workspace
            .lock()
            .map_err(|_| "internal state error".to_owned())?;
        guard
            .as_ref()
            .map(|ws| ws.root().to_path_buf())
            .or_else(|| std::env::var_os("HOME").map(std::path::PathBuf::from))
            .unwrap_or_else(std::env::temp_dir)
    };
    let options = options.unwrap_or_default();
    state
        .pty
        .open(kind, &options, rows, cols, cwd, move |event| {
            let _ = on_event.send(event);
        })
}

#[tauri::command]
fn pty_write(state: State<'_, AppState>, id: u32, data: String) -> Result<(), String> {
    state.pty.write(id, &data)
}

#[tauri::command]
fn pty_resize(state: State<'_, AppState>, id: u32, rows: u16, cols: u16) -> Result<(), String> {
    state.pty.resize(id, rows, cols)
}

#[tauri::command]
fn pty_close(state: State<'_, AppState>, id: u32) -> Result<(), String> {
    state.pty.close(id)
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
            xtool_cancel,
            read_file_if_exists,
            apply_file,
            secret_set,
            secret_delete,
            secret_status,
            ai_list_models,
            ai_stream,
            ai_cancel,
            reveal_path,
            cli_status,
            cli_login_terminal,
            cli_stream,
            pty_open,
            pty_write,
            pty_resize,
            pty_close
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open iOS Studio");
}
