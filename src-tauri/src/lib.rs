mod fs_engine;

use std::sync::Mutex;

use fs_engine::{Entry, FsError, Workspace};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct AppState {
    workspace: Mutex<Option<Workspace>>,
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            pick_workspace,
            list_dir,
            read_file,
            write_file,
            create_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open iOS Studio");
}
