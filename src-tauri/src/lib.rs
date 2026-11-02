mod ai;
mod appstore;
mod cli_ai;
mod fs_engine;
mod ipa_pack;
mod pty;
mod release;
mod reveal;
mod runner;
mod secrets;
mod signing;
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

// ---- App Store release (ADR-0013 / ADR-0014). Logic lives in `release`/`appstore`/`ipa_pack`;
// these commands only resolve workspace paths, talk to the keyring and forward events.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AscStatus {
    configured: bool,
    issuer_id: Option<String>,
    key_id: Option<String>,
}

/// Whether an App Store Connect key is stored. The `.p8` contents are never returned.
#[tauri::command]
async fn asc_credentials_status() -> Result<AscStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = secrets::KeyringStore;
        let issuer_id = store.get(secrets::ASC_ISSUER)?;
        let key_id = store.get(secrets::ASC_KEY_ID)?;
        let has_key = store.get(secrets::ASC_PRIVATE_KEY)?.is_some();
        Ok(AscStatus {
            configured: issuer_id.is_some() && key_id.is_some() && has_key,
            issuer_id,
            key_id,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn asc_credentials_set(
    issuer_id: String,
    key_id: String,
    private_key: String,
) -> Result<(), String> {
    let creds = appstore::Credentials {
        issuer_id: issuer_id.trim().to_owned(),
        key_id: key_id.trim().to_owned(),
        private_key_pem: private_key,
    };
    appstore::validate_credentials(&creds)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = secrets::KeyringStore;
        store.set(secrets::ASC_ISSUER, &creds.issuer_id)?;
        store.set(secrets::ASC_KEY_ID, &creds.key_id)?;
        store.set(secrets::ASC_PRIVATE_KEY, &creds.private_key_pem)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn asc_credentials_delete() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = secrets::KeyringStore;
        store.delete(secrets::ASC_ISSUER)?;
        store.delete(secrets::ASC_KEY_ID)?;
        store.delete(secrets::ASC_PRIVATE_KEY)
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn asc_client() -> Result<appstore::AscClient, String> {
    let creds = tauri::async_runtime::spawn_blocking(|| {
        let store = secrets::KeyringStore;
        match (
            store.get(secrets::ASC_ISSUER)?,
            store.get(secrets::ASC_KEY_ID)?,
            store.get(secrets::ASC_PRIVATE_KEY)?,
        ) {
            (Some(issuer_id), Some(key_id), Some(private_key_pem)) => Ok(appstore::Credentials {
                issuer_id,
                key_id,
                private_key_pem,
            }),
            _ => Err("No App Store Connect key is stored. Add one in Settings.".to_owned()),
        }
    })
    .await
    .map_err(|e| e.to_string())??;
    appstore::AscClient::new(creds).map_err(|e| e.to_string())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The `.p12` password of a bundle id: read from the keyring, created on first use.
async fn p12_password(bundle_id: &str, create: bool) -> Result<Option<String>, String> {
    let account = secrets::p12_account(bundle_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = secrets::KeyringStore;
        if let Some(existing) = store.get(&account)? {
            return Ok(Some(existing));
        }
        if !create {
            return Ok(None);
        }
        let fresh = release::random_hex(16).map_err(|e| e.to_string())?;
        store.set(&account, &fresh)?;
        Ok(Some(fresh))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn asc_test() -> Result<(), String> {
    asc_client().await?.ping().await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepackSummary {
    app_name: String,
    icons_written: usize,
    ipad_orientations_removed: bool,
    privacy_manifest_added: bool,
    build_number_set: Option<String>,
    warnings: Vec<String>,
}

/// Repack an IPA inside the workspace (icons, privacy manifest, plist edits). Unsigned output.
#[tauri::command]
async fn release_repack(
    state: State<'_, AppState>,
    project: String,
    input: String,
    output: String,
    build_number: Option<String>,
) -> Result<RepackSummary, String> {
    let manifest_path = if project.trim_matches('/').is_empty() {
        "PrivacyInfo.xcprivacy".to_owned()
    } else {
        format!("{}/PrivacyInfo.xcprivacy", project.trim_end_matches('/'))
    };
    let (src, dst, privacy) = with_workspace(&state, |ws| {
        Ok((
            ws.resolve(&input)?,
            ws.resolve(&output)?,
            ws.read_file_if_exists(&manifest_path)?,
        ))
    })?;
    let opts = ipa_pack::RepackOptions {
        privacy_manifest: privacy.map(String::into_bytes),
        build_number,
        provisioning_profile: None,
    };
    let report = tauri::async_runtime::spawn_blocking(move || ipa_pack::repack(&src, &dst, &opts))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    Ok(RepackSummary {
        app_name: report.app_name,
        icons_written: report.icons_written.len(),
        ipad_orientations_removed: report.ipad_orientations_removed,
        privacy_manifest_added: report.privacy_manifest_added,
        build_number_set: report.build_number_set,
        warnings: report.warnings,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareSummary {
    certificate_created: bool,
    profile_name: String,
    profile_uuid: String,
    profile_expires: Option<String>,
}

/// Distribution certificate + App Store profile for a bundle id. Re-uses what exists; never
/// revokes or deletes anything on Apple's side.
#[tauri::command]
async fn release_prepare(
    app: tauri::AppHandle,
    bundle_id: String,
    app_name: String,
    email: String,
) -> Result<PrepareSummary, String> {
    let data = app_data_dir(&app)?;
    let client = asc_client().await?;
    let openssl = xtool::find_in_path("openssl", &tool_path())
        .ok_or_else(|| "openssl was not found on PATH.".to_owned())?;
    let password = p12_password(&bundle_id, true)
        .await?
        .ok_or_else(|| "could not create the p12 password".to_owned())?;
    let cert = release::ensure_certificate(
        &client,
        &openssl,
        &data,
        &bundle_id,
        "Open iOS Studio",
        &email,
        &password,
    )
    .await
    .map_err(|e| e.to_string())?;
    let (bytes, info) =
        release::ensure_profile(&client, &bundle_id, &app_name, &cert.certificate_id)
            .await
            .map_err(|e| e.to_string())?;
    let dir = release::bundle_dir(&data, &bundle_id).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("profile.mobileprovision"), bytes).map_err(|e| e.to_string())?;
    Ok(PrepareSummary {
        certificate_created: cert.created,
        profile_name: info.name,
        profile_uuid: info.uuid,
        profile_expires: info.expiration,
    })
}

/// Sign an IPA with the stored distribution certificate (rcodesign, pinned and verified).
#[tauri::command]
async fn release_sign(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    bundle_id: String,
    input: String,
    output: String,
) -> Result<(), String> {
    let data = app_data_dir(&app)?;
    let (src, dst) = with_workspace(&state, |ws| Ok((ws.resolve(&input)?, ws.resolve(&output)?)))?;
    let dir = release::bundle_dir(&data, &bundle_id).map_err(|e| e.to_string())?;
    let p12 = dir.join("distribution.p12");
    let profile = std::fs::read(dir.join("profile.mobileprovision"))
        .map_err(|_| "Run the prepare step first (no profile stored).".to_owned())?;
    if !p12.is_file() {
        return Err("Run the prepare step first (no certificate stored).".to_owned());
    }
    let password = p12_password(&bundle_id, false)
        .await?
        .ok_or_else(|| "The p12 password is missing from the keyring.".to_owned())?;
    let rcodesign = release::ensure_rcodesign(&data, &tool_path())
        .await
        .map_err(|e| e.to_string())?;
    release::sign_ipa(&rcodesign, &data, &src, &dst, &profile, &p12, &password)
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum UploadEvent {
    Created { upload_id: String },
    Part { done: usize, total: usize },
    Committed,
    State { state: String },
}

/// Upload a signed IPA to App Store Connect (Build Uploads) and wait for processing.
#[tauri::command]
async fn release_upload(
    state: State<'_, AppState>,
    bundle_id: String,
    ipa: String,
    short_version: String,
    build_version: String,
    on_event: Channel<UploadEvent>,
) -> Result<(), String> {
    let path = with_workspace(&state, |ws| ws.resolve(&ipa))?;
    let client = asc_client().await?;
    let app_info = client
        .find_app(&bundle_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No app with this bundle id exists in App Store Connect. Create the app there first (the API cannot)."
                .to_owned()
        })?;
    let sender = on_event.clone();
    let outcome = client
        .upload_ipa(
            &path,
            &app_info.id,
            &short_version,
            &build_version,
            900,
            move |p| {
                let event = match p {
                    appstore::Progress::Created { upload_id } => UploadEvent::Created { upload_id },
                    appstore::Progress::Part { done, total } => UploadEvent::Part { done, total },
                    appstore::Progress::Committed => UploadEvent::Committed,
                    appstore::Progress::State(state) => UploadEvent::State { state },
                };
                let _ = sender.send(event);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    match outcome {
        appstore::UploadState::Failed(message) => {
            Err(format!("Apple rejected the build: {message}"))
        }
        _ => Ok(()),
    }
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
            pty_close,
            asc_credentials_status,
            asc_credentials_set,
            asc_credentials_delete,
            asc_test,
            release_repack,
            release_prepare,
            release_sign,
            release_upload
        ])
        .run(tauri::generate_context!())
        .expect("error while running Open iOS Studio");
}
