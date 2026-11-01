//! Subscription-backed AI through the official `claude` and `codex` CLIs (ADR-0008).
//!
//! The CLIs own the login (Claude subscription, ChatGPT plan). Studio never reads their
//! credential files and never sees a token: it only runs the CLI with a fixed argument vector,
//! feeds the prompt on stdin and maps the JSON event stream onto the same `AiEvent`s the API
//! providers use. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are never forwarded, so a stray key
//! cannot silently switch a session to pay-per-token billing.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use crate::ai::{AiEvent, Message};
use crate::runner::CancelToken;

const IDLE_TIMEOUT: Duration = Duration::from_secs(300);
const STATUS_TIMEOUT: Duration = Duration::from_secs(20);
const CANCEL_SLICE: Duration = Duration::from_millis(250);
const MAX_RESPONSE_TEXT: usize = 2 * 1024 * 1024;
const MAX_STDERR: usize = 16 * 1024;
const MAX_MESSAGE_CHARS: usize = 500;
const MAX_MODEL_CHARS: usize = 100;

/// Variables copied from the parent. API keys are deliberately absent.
/// `CODEX_HOME` / `CLAUDE_CONFIG_DIR` only point the CLI at its own login directory.
const ENV_ALLOW_LIST: [&str; 12] = [
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CliKind {
    #[serde(rename = "claude-cli")]
    Claude,
    #[serde(rename = "codex-cli")]
    Codex,
}

impl CliKind {
    pub fn program(self) -> &'static str {
        match self {
            CliKind::Claude => "claude",
            CliKind::Codex => "codex",
        }
    }

    /// Fixed argument vector of the interactive login command.
    pub fn login_args(self) -> Vec<String> {
        match self {
            CliKind::Claude => vec!["auth".to_owned(), "login".to_owned()],
            CliKind::Codex => vec!["login".to_owned()],
        }
    }

    fn status_args(self) -> Vec<String> {
        match self {
            CliKind::Claude => vec!["auth".to_owned(), "status".to_owned(), "--json".to_owned()],
            CliKind::Codex => vec!["login".to_owned(), "status".to_owned()],
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliChatRequest {
    pub provider: CliKind,
    pub model: String,
    /// Reasoning effort ("low" … "max"); empty = CLI default.
    #[serde(default)]
    pub effort: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    /// `None` when the state could not be determined.
    pub logged_in: Option<bool>,
    pub detail: String,
}

// ---------------------------------------------------------------------------------------------
// Program lookup and environment
// ---------------------------------------------------------------------------------------------

/// Directories searched in addition to `PATH`: a desktop-launched app often lacks the user's
/// npm/local bin directories.
fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        dirs.push(home.join(".local/bin"));
        // swiftly (the Swift toolchain installer) keeps its proxies here; a desktop-launched app
        // does not inherit the shell PATH that points at them.
        dirs.push(home.join(".local/share/swiftly/bin"));
        dirs.push(home.join(".swiftly/bin"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".claude/local"));
    }
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extra_bin_dirs() {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

pub fn find_program(name: &str) -> Option<PathBuf> {
    search_dirs()
        .into_iter()
        .map(|d| d.join(name))
        .find(|p| is_executable_file(p))
}

/// `PATH` widened with the usual per-user tool directories.
pub fn child_path() -> Option<OsString> {
    std::env::join_paths(search_dirs()).ok()
}

/// The scrubbed environment: allow-listed variables plus a widened `PATH`.
pub fn env_pairs() -> Vec<(&'static str, OsString)> {
    let mut pairs = Vec::new();
    for name in ENV_ALLOW_LIST {
        if let Some(value) = std::env::var_os(name) {
            pairs.push((name, value));
        }
    }
    if let Some(path) = child_path() {
        pairs.push(("PATH", path));
    }
    pairs
}

fn scrub_env(cmd: &mut Command) {
    cmd.env_clear();
    for (name, value) in env_pairs() {
        cmd.env(name, value);
    }
}

// ---------------------------------------------------------------------------------------------
// Request building (pure)
// ---------------------------------------------------------------------------------------------

/// Model ids go into an argument vector (never a shell); still reject anything that could be
/// read as an option or contains unexpected characters.
pub fn validate_model(model: &str) -> Result<(), String> {
    let m = model.trim();
    if m.is_empty() {
        return Ok(());
    }
    if m.chars().count() > MAX_MODEL_CHARS {
        return Err("Model name is too long.".to_owned());
    }
    if m.starts_with('-') {
        return Err("Model name must not start with '-'.".to_owned());
    }
    let ok = m
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '-' | '[' | ']'));
    if ok {
        Ok(())
    } else {
        Err("Model name contains unsupported characters.".to_owned())
    }
}

/// Effort levels each CLI accepts. Anything else is rejected before it reaches an argument vector.
pub fn validate_effort(kind: CliKind, effort: &str) -> Result<(), String> {
    let e = effort.trim();
    if e.is_empty() {
        return Ok(());
    }
    let allowed: &[&str] = match kind {
        CliKind::Claude => &["low", "medium", "high", "xhigh", "max"],
        CliKind::Codex => &["low", "medium", "high"],
    };
    if allowed.contains(&e) {
        Ok(())
    } else {
        Err(format!(
            "Unsupported effort level `{e}` for {}.",
            kind.program()
        ))
    }
}

/// Arguments that select the reasoning effort; empty when no effort was chosen.
/// The value must have passed [`validate_effort`].
pub fn effort_args(kind: CliKind, effort: &str) -> Vec<String> {
    let e = effort.trim();
    if e.is_empty() {
        return Vec::new();
    }
    match kind {
        CliKind::Claude => vec!["--effort".to_owned(), e.to_owned()],
        CliKind::Codex => vec!["-c".to_owned(), format!("model_reasoning_effort=\"{e}\"")],
    }
}

pub fn build_args(kind: CliKind, model: &str, effort: &str) -> Vec<String> {
    let model = model.trim();
    match kind {
        CliKind::Claude => {
            let mut args: Vec<String> = [
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--tools",
                "",
                "--no-session-persistence",
                "--strict-mcp-config",
            ]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
            if !model.is_empty() {
                args.push("--model".to_owned());
                args.push(model.to_owned());
            }
            args.extend(effort_args(kind, effort));
            args
        }
        CliKind::Codex => {
            let mut args: Vec<String> = [
                "exec",
                "--json",
                "--sandbox",
                "read-only",
                "--ephemeral",
                "--skip-git-repo-check",
                "--color",
                "never",
            ]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
            if !model.is_empty() {
                args.push("-m".to_owned());
                args.push(model.to_owned());
            }
            args.extend(effort_args(kind, effort));
            // "-" makes codex read the prompt from stdin.
            args.push("-".to_owned());
            args
        }
    }
}

/// Flattens the provider-neutral chat into a single prompt for a CLI that takes plain text.
pub fn flatten_prompt(messages: &[Message]) -> String {
    let mut system = Vec::new();
    let mut turns = Vec::new();
    for m in messages {
        match m.role.as_str() {
            "system" => system.push(m.content.as_str()),
            "assistant" => turns.push(format!("Assistant:\n{}", m.content)),
            _ => turns.push(format!("User:\n{}", m.content)),
        }
    }
    let mut out = String::new();
    if !system.is_empty() {
        out.push_str("# Instructions\n");
        out.push_str(&system.join("\n\n"));
        out.push_str("\n\n");
    }
    out.push_str("# Conversation\n");
    out.push_str(&turns.join("\n\n"));
    out.push_str("\n\nReply to the last User message. Do not run commands or use tools; answer in text only.\n");
    out
}

// ---------------------------------------------------------------------------------------------
// Output parsing (pure)
// ---------------------------------------------------------------------------------------------

fn truncate_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn u64_at(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

/// Incremental parser of one CLI's line-delimited JSON output.
#[derive(Debug)]
pub struct CliParser {
    kind: CliKind,
    saw_delta: bool,
    finished: bool,
    last_error: Option<String>,
}

impl CliParser {
    pub fn new(kind: CliKind) -> Self {
        Self {
            kind,
            saw_delta: false,
            finished: false,
            last_error: None,
        }
    }

    pub fn finished(&self) -> bool {
        self.finished
    }

    fn delta(&mut self, text: &str, out: &mut Vec<AiEvent>) {
        if !text.is_empty() {
            self.saw_delta = true;
            out.push(AiEvent::Delta {
                text: text.to_owned(),
            });
        }
    }

    fn fail(&mut self, message: &str, out: &mut Vec<AiEvent>) {
        if self.finished {
            return;
        }
        self.finished = true;
        out.push(AiEvent::Error {
            message: truncate_chars(message, MAX_MESSAGE_CHARS),
            status: None,
        });
    }

    pub fn feed_line(&mut self, line: &str) -> Vec<AiEvent> {
        let mut out = Vec::new();
        if self.finished {
            return out;
        }
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
            return out;
        };
        match self.kind {
            CliKind::Claude => self.handle_claude(&v, &mut out),
            CliKind::Codex => self.handle_codex(&v, &mut out),
        }
        out
    }

    fn handle_claude(&mut self, v: &Value, out: &mut Vec<AiEvent>) {
        match v.get("type").and_then(Value::as_str) {
            Some("stream_event") => {
                let Some(ev) = v.get("event") else { return };
                if ev.get("type").and_then(Value::as_str) != Some("content_block_delta") {
                    return;
                }
                let delta = &ev["delta"];
                if delta.get("type").and_then(Value::as_str) == Some("text_delta") {
                    if let Some(t) = delta.get("text").and_then(Value::as_str) {
                        self.delta(t, out);
                    }
                }
            }
            Some("assistant") if !self.saw_delta => {
                if let Some(blocks) = v["message"]["content"].as_array() {
                    for b in blocks {
                        if b.get("type").and_then(Value::as_str) == Some("text") {
                            if let Some(t) = b.get("text").and_then(Value::as_str) {
                                self.delta(t, out);
                            }
                        }
                    }
                }
            }
            Some("result") => {
                let is_error = v.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                let result = v.get("result").and_then(Value::as_str).unwrap_or("");
                if is_error {
                    let msg = if result.is_empty() {
                        "Claude CLI returned an error."
                    } else {
                        result
                    };
                    self.fail(msg, out);
                    return;
                }
                if !self.saw_delta {
                    self.delta(result, out);
                }
                self.finished = true;
                let usage = &v["usage"];
                out.push(AiEvent::Done {
                    stop_reason: v
                        .get("stop_reason")
                        .and_then(Value::as_str)
                        .map(str::to_owned),
                    input_tokens: u64_at(usage, "input_tokens"),
                    output_tokens: u64_at(usage, "output_tokens"),
                });
            }
            _ => {}
        }
    }

    fn handle_codex(&mut self, v: &Value, out: &mut Vec<AiEvent>) {
        match v.get("type").and_then(Value::as_str) {
            Some("item.completed") => {
                let item = &v["item"];
                if item.get("type").and_then(Value::as_str) == Some("agent_message") {
                    if let Some(t) = item.get("text").and_then(Value::as_str) {
                        if self.saw_delta {
                            self.delta("\n\n", out);
                        }
                        self.delta(t, out);
                    }
                }
            }
            Some("turn.completed") => {
                self.finished = true;
                let usage = &v["usage"];
                out.push(AiEvent::Done {
                    stop_reason: None,
                    input_tokens: u64_at(usage, "input_tokens"),
                    output_tokens: u64_at(usage, "output_tokens"),
                });
            }
            Some("turn.failed") => {
                let msg = v["error"]["message"]
                    .as_str()
                    .unwrap_or("Codex CLI turn failed.");
                self.fail(msg, out);
            }
            Some("error") => {
                // Reconnect notices also arrive as "error"; only report it if the turn never ends.
                if let Some(m) = v.get("message").and_then(Value::as_str) {
                    self.last_error = Some(m.to_owned());
                }
            }
            _ => {}
        }
    }

    /// Called when the process ended without a terminal event.
    pub fn finalize(&mut self, exit_ok: bool, stderr: &str) -> Vec<AiEvent> {
        let mut out = Vec::new();
        if self.finished {
            return out;
        }
        if exit_ok && self.saw_delta {
            self.finished = true;
            out.push(AiEvent::Done {
                stop_reason: None,
                input_tokens: None,
                output_tokens: None,
            });
            return out;
        }
        let detail = self
            .last_error
            .clone()
            .or_else(|| {
                let s = stderr.trim();
                (!s.is_empty()).then(|| s.to_owned())
            })
            .unwrap_or_else(|| {
                "The CLI ended without an answer. Check that you are logged in.".to_owned()
            });
        self.fail(&detail, &mut out);
        out
    }
}

/// Parses `claude auth status --json`.
pub fn parse_claude_status(stdout: &str) -> Option<(bool, String)> {
    let v: Value = serde_json::from_str(stdout.trim()).ok()?;
    let logged_in = v.get("loggedIn").and_then(Value::as_bool)?;
    let mut parts = Vec::new();
    if let Some(m) = v.get("authMethod").and_then(Value::as_str) {
        parts.push(m.to_owned());
    }
    if let Some(s) = v.get("subscriptionType").and_then(Value::as_str) {
        parts.push(s.to_owned());
    }
    let detail = if logged_in {
        if parts.is_empty() {
            "Logged in".to_owned()
        } else {
            format!("Logged in ({})", parts.join(", "))
        }
    } else {
        "Not logged in".to_owned()
    };
    Some((logged_in, detail))
}

/// Parses `codex login status` (exit code 0 and a "Logged in ..." line).
pub fn parse_codex_status(success: bool, output: &str) -> (bool, String) {
    let first = output
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let logged_in = success && first.to_lowercase().contains("logged in");
    let detail = if first.is_empty() {
        if logged_in {
            "Logged in".to_owned()
        } else {
            "Not logged in".to_owned()
        }
    } else {
        truncate_chars(first, 120)
    };
    (logged_in, detail)
}

// ---------------------------------------------------------------------------------------------
// Terminal launch (pure argument building)
// ---------------------------------------------------------------------------------------------

const TERMINALS: [&str; 8] = [
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "mate-terminal",
    "kitty",
    "alacritty",
    "xterm",
];

/// Argument vector that makes `terminal` run `program args...`. Pure; no user input involved.
pub fn terminal_args(terminal: &str, program: &str, args: &[String]) -> Vec<String> {
    let prefix: &[&str] = match terminal {
        "gnome-terminal" => &["--"],
        "xfce4-terminal" | "mate-terminal" => &["-x"],
        "kitty" => &[],
        _ => &["-e"],
    };
    let mut v: Vec<String> = prefix.iter().map(|s| (*s).to_owned()).collect();
    v.push(program.to_owned());
    v.extend(args.iter().cloned());
    v
}

/// Opens the system terminal on the CLI's login command. Returns the terminal name.
pub fn open_login_terminal(kind: CliKind) -> Result<String, String> {
    let program = find_program(kind.program()).ok_or_else(|| {
        format!(
            "The `{}` command is not installed (not found in PATH).",
            kind.program()
        )
    })?;
    let program = program.to_string_lossy().into_owned();
    let command_text = format!("{} {}", kind.program(), kind.login_args().join(" "));
    for term in TERMINALS {
        let Some(term_path) = find_program(term) else {
            continue;
        };
        let args = terminal_args(term, &program, &kind.login_args());
        let mut cmd = std::process::Command::new(term_path);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Ok(mut child) = cmd.spawn() {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(term.to_owned());
        }
    }
    Err(format!(
        "No terminal emulator was found. Run `{command_text}` in your own terminal, then press Refresh."
    ))
}

// ---------------------------------------------------------------------------------------------
// Async runtime
// ---------------------------------------------------------------------------------------------

struct Captured {
    success: bool,
    stdout: String,
    stderr: String,
}

async fn run_capture(program: &Path, args: &[String]) -> Result<Captured, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    scrub_env(&mut cmd);
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let output = tokio::time::timeout(STATUS_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| "The CLI did not answer in time.".to_owned())?
        .map_err(|e| e.to_string())?;
    Ok(Captured {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

pub async fn status(kind: CliKind) -> CliStatus {
    let Some(program) = find_program(kind.program()) else {
        return CliStatus {
            installed: false,
            logged_in: None,
            detail: format!("`{}` is not installed.", kind.program()),
        };
    };
    match run_capture(&program, &kind.status_args()).await {
        Err(e) => CliStatus {
            installed: true,
            logged_in: None,
            detail: truncate_chars(&e, MAX_MESSAGE_CHARS),
        },
        Ok(out) => {
            let (logged_in, detail) = match kind {
                CliKind::Claude => parse_claude_status(&out.stdout).unwrap_or_else(|| {
                    (
                        out.success,
                        if out.success {
                            "Logged in".to_owned()
                        } else {
                            "Not logged in".to_owned()
                        },
                    )
                }),
                CliKind::Codex => {
                    let text = if out.stdout.trim().is_empty() {
                        &out.stderr
                    } else {
                        &out.stdout
                    };
                    parse_codex_status(out.success, text)
                }
            };
            CliStatus {
                installed: true,
                logged_in: Some(logged_in),
                detail,
            }
        }
    }
}

/// Removes the temp working directory when dropped.
struct TempDir(PathBuf);

impl TempDir {
    fn create() -> Result<Self, String> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("ois-cli-{}-{nanos}", std::process::id()));
        std::fs::create_dir(&path).map_err(|e| e.to_string())?;
        Ok(Self(path))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Runs one chat turn through the CLI and forwards events. Returns `Err` for failures that
/// happened before or outside the event stream (not installed, cancelled, timeout).
pub async fn stream_cli(
    req: &CliChatRequest,
    cancel: &CancelToken,
    mut emit: impl FnMut(AiEvent),
) -> Result<(), String> {
    validate_model(&req.model)?;
    validate_effort(req.provider, &req.effort)?;
    if req.messages.is_empty() {
        return Err("No messages to send.".to_owned());
    }
    let kind = req.provider;
    let program = find_program(kind.program()).ok_or_else(|| {
        format!(
            "The `{}` command is not installed. Install it and log in from the AI panel.",
            kind.program()
        )
    })?;
    let prompt = flatten_prompt(&req.messages);
    let workdir = TempDir::create()?;

    let mut cmd = Command::new(&program);
    cmd.args(build_args(kind, &req.model, &req.effort))
        .current_dir(&workdir.0)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    scrub_env(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = (&mut stderr)
            .take(MAX_STDERR as u64)
            .read_to_end(&mut buf)
            .await;
        String::from_utf8_lossy(&buf).into_owned()
    });

    let mut parser = CliParser::new(kind);
    let mut lines = BufReader::new(stdout).lines();
    let mut last_activity = Instant::now();
    let mut total = 0usize;
    loop {
        if cancel.is_cancelled() {
            let _ = child.start_kill();
            return Err("Cancelled.".to_owned());
        }
        if last_activity.elapsed() > IDLE_TIMEOUT {
            let _ = child.start_kill();
            return Err("The CLI produced no output for too long.".to_owned());
        }
        match tokio::time::timeout(CANCEL_SLICE, lines.next_line()).await {
            Err(_) => continue,
            Ok(Ok(Some(line))) => {
                last_activity = Instant::now();
                for ev in parser.feed_line(&line) {
                    if let AiEvent::Delta { text } = &ev {
                        total += text.len();
                        if total > MAX_RESPONSE_TEXT {
                            let _ = child.start_kill();
                            return Err("The answer is too large.".to_owned());
                        }
                    }
                    emit(ev);
                }
                if parser.finished() {
                    break;
                }
            }
            Ok(Ok(None)) => break,
            Ok(Err(e)) => {
                let _ = child.start_kill();
                return Err(e.to_string());
            }
        }
    }

    let exit_ok = match tokio::time::timeout(Duration::from_secs(10), child.wait()).await {
        Ok(Ok(status)) => status.success(),
        _ => {
            let _ = child.start_kill();
            false
        }
    };
    let stderr_text = stderr_task.await.unwrap_or_default();
    for ev in parser.finalize(exit_ok, &stderr_text) {
        emit(ev);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> Message {
        Message {
            role: role.to_owned(),
            content: content.to_owned(),
        }
    }

    #[test]
    fn model_validation() {
        assert!(validate_model("").is_ok());
        assert!(validate_model("opus").is_ok());
        assert!(validate_model("gpt-5.1-codex").is_ok());
        assert!(validate_model("--dangerously-bypass-approvals-and-sandbox").is_err());
        assert!(validate_model("a b").is_err());
        assert!(validate_model("a;rm").is_err());
        assert!(validate_model(&"x".repeat(101)).is_err());
    }

    #[test]
    fn claude_args_disable_tools_and_take_model() {
        let a = build_args(CliKind::Claude, " opus ", "");
        assert!(a.windows(2).any(|w| w == ["--tools", ""]));
        assert!(a.windows(2).any(|w| w == ["--model", "opus"]));
        assert!(a.contains(&"--no-session-persistence".to_owned()));
        let none = build_args(CliKind::Claude, "", "");
        assert!(!none.contains(&"--model".to_owned()));
    }

    #[test]
    fn effort_is_validated_and_passed_per_cli() {
        assert!(validate_effort(CliKind::Claude, "").is_ok());
        assert!(validate_effort(CliKind::Claude, "max").is_ok());
        assert!(validate_effort(CliKind::Codex, "max").is_err());
        assert!(validate_effort(CliKind::Claude, "--x").is_err());
        let c = build_args(CliKind::Claude, "opus", "high");
        assert!(c.windows(2).any(|w| w == ["--effort", "high"]));
        let x = build_args(CliKind::Codex, "", "medium");
        assert!(x
            .windows(2)
            .any(|w| w == ["-c", "model_reasoning_effort=\"medium\""]));
        assert_eq!(x.last().map(String::as_str), Some("-"));
        assert!(!build_args(CliKind::Claude, "", "").contains(&"--effort".to_owned()));
    }

    #[test]
    fn codex_args_are_read_only_and_read_stdin() {
        let a = build_args(CliKind::Codex, "", "");
        assert_eq!(a.last().map(String::as_str), Some("-"));
        assert!(a.windows(2).any(|w| w == ["--sandbox", "read-only"]));
        assert!(a.contains(&"--ephemeral".to_owned()));
        assert!(!a.contains(&"-m".to_owned()));
        let m = build_args(CliKind::Codex, "gpt-x", "");
        assert!(m.windows(2).any(|w| w == ["-m", "gpt-x"]));
    }

    #[test]
    fn prompt_has_system_first_and_roles() {
        let p = flatten_prompt(&[
            msg("system", "RULES"),
            msg("user", "hi"),
            msg("assistant", "yo"),
            msg("user", "go"),
        ]);
        assert!(p.starts_with("# Instructions\nRULES"));
        assert!(p.contains("User:\nhi"));
        assert!(p.contains("Assistant:\nyo"));
        assert!(p.contains("Reply to the last User message"));
    }

    #[test]
    fn claude_stream_deltas_then_result() {
        let mut p = CliParser::new(CliKind::Claude);
        let mut events = Vec::new();
        for line in [
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hel"}}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"lo"}}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#,
            r#"{"type":"result","is_error":false,"result":"Hello","usage":{"input_tokens":5,"output_tokens":2}}"#,
        ] {
            events.extend(p.feed_line(line));
        }
        assert_eq!(
            events,
            vec![
                AiEvent::Delta { text: "Hel".into() },
                AiEvent::Delta { text: "lo".into() },
                AiEvent::Done {
                    stop_reason: None,
                    input_tokens: Some(5),
                    output_tokens: Some(2)
                },
            ]
        );
        assert!(p.finished());
    }

    #[test]
    fn claude_without_partials_uses_result_text() {
        let mut p = CliParser::new(CliKind::Claude);
        let ev = p.feed_line(r#"{"type":"result","is_error":false,"result":"Whole"}"#);
        assert_eq!(
            ev[0],
            AiEvent::Delta {
                text: "Whole".into()
            }
        );
        assert!(matches!(ev[1], AiEvent::Done { .. }));
    }

    #[test]
    fn claude_error_result_is_an_error_event() {
        let mut p = CliParser::new(CliKind::Claude);
        let ev = p.feed_line(r#"{"type":"result","is_error":true,"result":"Not logged in"}"#);
        assert_eq!(
            ev,
            vec![AiEvent::Error {
                message: "Not logged in".into(),
                status: None
            }]
        );
        assert!(p
            .feed_line(r#"{"type":"result","is_error":false,"result":"x"}"#)
            .is_empty());
    }

    #[test]
    fn codex_message_and_completion() {
        let mut p = CliParser::new(CliKind::Codex);
        let mut events = Vec::new();
        for line in [
            r#"{"type":"thread.started","thread_id":"t"}"#,
            r#"{"type":"item.completed","item":{"id":"1","type":"reasoning","text":"thinking"}}"#,
            r#"{"type":"item.completed","item":{"id":"2","type":"agent_message","text":"Answer"}}"#,
            r#"{"type":"turn.completed","usage":{"input_tokens":9,"output_tokens":3}}"#,
        ] {
            events.extend(p.feed_line(line));
        }
        assert_eq!(
            events,
            vec![
                AiEvent::Delta {
                    text: "Answer".into()
                },
                AiEvent::Done {
                    stop_reason: None,
                    input_tokens: Some(9),
                    output_tokens: Some(3)
                },
            ]
        );
    }

    #[test]
    fn codex_turn_failed_and_transient_error() {
        let mut p = CliParser::new(CliKind::Codex);
        assert!(p
            .feed_line(r#"{"type":"error","message":"reconnecting"}"#)
            .is_empty());
        let ev = p.feed_line(r#"{"type":"turn.failed","error":{"message":"boom"}}"#);
        assert_eq!(
            ev,
            vec![AiEvent::Error {
                message: "boom".into(),
                status: None
            }]
        );
    }

    #[test]
    fn finalize_reports_stderr_or_last_error() {
        let mut p = CliParser::new(CliKind::Codex);
        let _ = p.feed_line(r#"{"type":"error","message":"auth required"}"#);
        let ev = p.finalize(false, "ignored");
        assert_eq!(
            ev,
            vec![AiEvent::Error {
                message: "auth required".into(),
                status: None
            }]
        );
        let mut q = CliParser::new(CliKind::Claude);
        let ev = q.finalize(false, "  bad thing \n");
        assert_eq!(
            ev,
            vec![AiEvent::Error {
                message: "bad thing".into(),
                status: None
            }]
        );
    }

    #[test]
    fn garbage_lines_are_ignored() {
        let mut p = CliParser::new(CliKind::Claude);
        assert!(p.feed_line("not json").is_empty());
        assert!(p.feed_line("").is_empty());
    }

    #[test]
    fn claude_status_parsing() {
        let (ok, d) = parse_claude_status(
            r#"{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}"#,
        )
        .expect("parse");
        assert!(ok);
        assert_eq!(d, "Logged in (claude.ai, max)");
        let (ok, _) = parse_claude_status(r#"{"loggedIn":false}"#).expect("parse");
        assert!(!ok);
        assert!(parse_claude_status("garbage").is_none());
    }

    #[test]
    fn codex_status_parsing() {
        assert_eq!(
            parse_codex_status(true, "Logged in using ChatGPT\n"),
            (true, "Logged in using ChatGPT".to_owned())
        );
        assert!(!parse_codex_status(false, "Not logged in").0);
        assert!(!parse_codex_status(true, "").0);
    }

    #[test]
    fn terminal_argument_shapes() {
        let args = vec!["auth".to_owned(), "login".to_owned()];
        assert_eq!(
            terminal_args("gnome-terminal", "/x/claude", &args),
            ["--", "/x/claude", "auth", "login"]
        );
        assert_eq!(
            terminal_args("xterm", "/x/claude", &args),
            ["-e", "/x/claude", "auth", "login"]
        );
        assert_eq!(
            terminal_args("kitty", "/x/claude", &args),
            ["/x/claude", "auth", "login"]
        );
        assert_eq!(terminal_args("xfce4-terminal", "/x/claude", &args)[0], "-x");
    }

    #[test]
    fn env_allow_list_has_no_api_keys() {
        for name in ENV_ALLOW_LIST {
            assert!(!name.contains("API_KEY"), "{name}");
        }
    }

    #[test]
    fn search_dirs_include_swiftly_and_local_bin() {
        if std::env::var_os("HOME").is_none() {
            return;
        }
        let dirs = search_dirs();
        assert!(dirs.iter().any(|d| d.ends_with(".local/share/swiftly/bin")));
        assert!(dirs.iter().any(|d| d.ends_with(".local/bin")));
    }

    #[test]
    fn login_commands_are_fixed() {
        assert_eq!(CliKind::Claude.login_args(), ["auth", "login"]);
        assert_eq!(CliKind::Codex.login_args(), ["login"]);
    }
}
