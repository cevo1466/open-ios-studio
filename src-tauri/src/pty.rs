//! Embedded terminal sessions (ADR-0009).
//!
//! Only three session kinds exist: the two CLI login commands (fixed argument vectors) and the
//! user's own login shell, which is opened by an explicit click. The webview only forwards what
//! the user types; AI output has no path to `pty_write`. Environments are scrubbed, so API keys
//! of the parent never reach a session.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};

use crate::cli_ai::{env_pairs, find_program, CliKind};

const MAX_SESSIONS: usize = 4;
const MIN_DIM: u16 = 2;
const MAX_DIM: u16 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PtyKind {
    ClaudeLogin,
    CodexLogin,
    UserShell,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PtyEvent {
    Data { text: String },
    Exit { code: Option<u32> },
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<u32, Session>>,
    next: AtomicU32,
}

fn clamp_dim(v: u16) -> u16 {
    v.clamp(MIN_DIM, MAX_DIM)
}

fn size(rows: u16, cols: u16) -> PtySize {
    PtySize {
        rows: clamp_dim(rows),
        cols: clamp_dim(cols),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Splits `buf` into the longest valid UTF-8 prefix (returned) and an incomplete tail (kept).
/// Genuinely invalid bytes are replaced so the stream cannot stall.
pub fn take_valid_utf8(buf: &mut Vec<u8>) -> String {
    match std::str::from_utf8(buf) {
        Ok(s) => {
            let out = s.to_owned();
            buf.clear();
            out
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let out = String::from_utf8_lossy(&buf[..valid]).into_owned();
            buf.drain(..valid);
            out
        }
        Err(_) => {
            let out = String::from_utf8_lossy(buf).into_owned();
            buf.clear();
            out
        }
    }
}

fn user_shell() -> PathBuf {
    if let Some(shell) = std::env::var_os("SHELL") {
        let p = PathBuf::from(shell);
        if p.is_absolute() && p.is_file() {
            return p;
        }
    }
    PathBuf::from("/bin/sh")
}

/// Program and fixed arguments for a session kind.
pub fn command_for(kind: PtyKind) -> Result<(PathBuf, Vec<String>), String> {
    let cli = |k: CliKind| {
        find_program(k.program())
            .map(|p| (p, k.login_args()))
            .ok_or_else(|| format!("The `{}` command is not installed.", k.program()))
    };
    match kind {
        PtyKind::ClaudeLogin => cli(CliKind::Claude),
        PtyKind::CodexLogin => cli(CliKind::Codex),
        PtyKind::UserShell => Ok((user_shell(), Vec::new())),
    }
}

impl PtyState {
    /// Opens a session and returns its id. `sink` receives output and the final exit event.
    pub fn open(
        &self,
        kind: PtyKind,
        rows: u16,
        cols: u16,
        cwd: PathBuf,
        sink: impl Fn(PtyEvent) + Send + 'static,
    ) -> Result<u32, String> {
        if self
            .sessions
            .lock()
            .map_err(|_| "internal state error".to_owned())?
            .len()
            >= MAX_SESSIONS
        {
            return Err("Too many terminals are open. Close one first.".to_owned());
        }
        let (program, args) = command_for(kind)?;
        let pair = native_pty_system()
            .openpty(size(rows, cols))
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(&program);
        for a in args {
            cmd.arg(a);
        }
        cmd.cwd(&cwd);
        cmd.env_clear();
        for (name, value) in env_pairs() {
            cmd.env(name, value);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if kind == PtyKind::UserShell {
            cmd.env("SHELL", &program);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let killer = child.clone_killer();

        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        self.sessions
            .lock()
            .map_err(|_| "internal state error".to_owned())?
            .insert(
                id,
                Session {
                    master: pair.master,
                    writer,
                    killer,
                },
            );

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pending: Vec<u8> = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let text = take_valid_utf8(&mut pending);
                        if !text.is_empty() {
                            sink(PtyEvent::Data { text });
                        }
                    }
                }
            }
            let code = child.wait().ok().map(|s| s.exit_code());
            sink(PtyEvent::Exit { code });
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "internal state error".to_owned())?;
        let s = sessions
            .get_mut(&id)
            .ok_or_else(|| "terminal is closed".to_owned())?;
        s.writer
            .write_all(data.as_bytes())
            .and_then(|()| s.writer.flush())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "internal state error".to_owned())?;
        let s = sessions
            .get(&id)
            .ok_or_else(|| "terminal is closed".to_owned())?;
        s.master.resize(size(rows, cols)).map_err(|e| e.to_string())
    }

    pub fn close(&self, id: u32) -> Result<(), String> {
        let removed = self
            .sessions
            .lock()
            .map_err(|_| "internal state error".to_owned())?
            .remove(&id);
        if let Some(mut s) = removed {
            let _ = s.killer.kill();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn utf8_split_keeps_incomplete_tail() {
        let bytes = "aé".as_bytes().to_vec(); // 'é' is two bytes
        let mut buf = bytes[..2].to_vec(); // 'a' + first byte of 'é'
        assert_eq!(take_valid_utf8(&mut buf), "a");
        assert_eq!(buf.len(), 1);
        buf.push(bytes[2]);
        assert_eq!(take_valid_utf8(&mut buf), "é");
        assert!(buf.is_empty());
    }

    #[test]
    fn utf8_invalid_bytes_do_not_stall() {
        let mut buf = vec![0xff, b'a'];
        let out = take_valid_utf8(&mut buf);
        assert!(out.ends_with('a'));
        assert!(buf.is_empty());
    }

    #[test]
    fn dimensions_are_clamped() {
        assert_eq!(size(0, 9999).rows, MIN_DIM);
        assert_eq!(size(0, 9999).cols, MAX_DIM);
    }

    #[test]
    fn kind_names_from_the_webview() {
        let k: PtyKind = serde_json::from_str("\"claude-login\"").expect("kind");
        assert_eq!(k, PtyKind::ClaudeLogin);
        assert!(serde_json::from_str::<PtyKind>("\"rm -rf\"").is_err());
    }

    #[test]
    fn shell_session_echoes_and_exits() {
        let state = PtyState::default();
        let (tx, rx) = mpsc::channel();
        let id = state
            .open(PtyKind::UserShell, 24, 80, std::env::temp_dir(), move |e| {
                let _ = tx.send(e);
            })
            .expect("open");
        state.write(id, "echo ois-pty-ok\nexit\n").expect("write");
        let mut text = String::new();
        let mut exited = false;
        while let Ok(ev) = rx.recv_timeout(Duration::from_secs(10)) {
            match ev {
                PtyEvent::Data { text: t } => text.push_str(&t),
                PtyEvent::Exit { .. } => {
                    exited = true;
                    break;
                }
            }
        }
        assert!(exited, "shell did not exit; output: {text}");
        assert!(text.contains("ois-pty-ok"), "output: {text}");
        state.close(id).expect("close");
        assert!(state.write(id, "x").is_err());
    }
}
