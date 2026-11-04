//! sourcekit-lsp session: one language server per workspace, spoken to over stdio with
//! `Content-Length` framed JSON-RPC. The Rust side only relays frames; the protocol itself lives
//! in the webview (`src/lsp/`). No shell, allow-listed environment, bounded frame size.

use serde::Serialize;

use std::ffi::{OsStr, OsString};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

/// Largest frame accepted from the server (16 MiB); anything bigger ends the session.
pub const MAX_FRAME: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LspEvent {
    Message { json: String },
    Exit { code: Option<i32> },
    Error { message: String },
}

/// Incremental `Content-Length` frame reader. Bytes arrive in arbitrary chunks; `push` returns
/// every complete JSON payload they finished.
#[derive(Debug, Default)]
pub struct FrameParser {
    buf: Vec<u8>,
    /// Body length of the frame whose header was parsed but whose body is still incomplete.
    pending: Option<usize>,
}

impl FrameParser {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let len = match self.pending {
                Some(len) => len,
                None => match parse_header(&self.buf)? {
                    Some((len, header_len)) => {
                        self.buf.drain(..header_len);
                        self.pending = Some(len);
                        len
                    }
                    None => break,
                },
            };
            if self.buf.len() < len {
                break;
            }
            let body: Vec<u8> = self.buf.drain(..len).collect();
            self.pending = None;
            out.push(String::from_utf8(body).map_err(|e| format!("frame is not UTF-8: {e}"))?);
        }
        Ok(out)
    }
}

/// `Ok(Some((content_length, header_bytes)))` once a whole header block is buffered, `Ok(None)`
/// while it is still incomplete, `Err` for a header block without a valid `Content-Length`.
fn parse_header(buf: &[u8]) -> Result<Option<(usize, usize)>, String> {
    let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
        if buf.len() > 8 * 1024 {
            return Err("frame header is too long".to_owned());
        }
        return Ok(None);
    };
    let header =
        std::str::from_utf8(&buf[..end]).map_err(|_| "frame header is not ASCII".to_owned())?;
    let mut length = None;
    for line in header.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().eq_ignore_ascii_case("content-length") {
            length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| format!("invalid Content-Length: {}", value.trim()))?,
            );
        }
    }
    let len = length.ok_or_else(|| "frame without Content-Length".to_owned())?;
    if len > MAX_FRAME {
        return Err(format!(
            "frame of {len} bytes exceeds the {MAX_FRAME} byte limit"
        ));
    }
    Ok(Some((len, end + 4)))
}

pub fn encode_frame(json: &str) -> Vec<u8> {
    let mut out = format!("Content-Length: {}\r\n\r\n", json.len()).into_bytes();
    out.extend_from_slice(json.as_bytes());
    out
}

/// `sourcekit-lsp` on the given PATH, else next to the `swift` binary it belongs to.
pub fn resolve_program(path_var: &OsStr) -> Option<PathBuf> {
    crate::xtool::find_in_path("sourcekit-lsp", path_var).or_else(|| {
        let swift = crate::xtool::find_in_path("swift", path_var)?;
        let real = std::fs::canonicalize(&swift).unwrap_or(swift);
        let sibling = real.parent()?.join("sourcekit-lsp");
        sibling.is_file().then_some(sibling)
    })
}

struct Session {
    id: u32,
    child: Arc<Mutex<Child>>,
    stdin: ChildStdin,
}

/// At most one language server per app; `start` replaces a running one.
#[derive(Default)]
pub struct LspState {
    session: Mutex<Option<Session>>,
    next_id: Mutex<u32>,
}

impl LspState {
    /// Spawns `program` (no shell) with exactly the given environment. Every frame the server
    /// writes reaches `sink` as `Message`; a malformed frame ends in `Error`; EOF or a crash ends
    /// in exactly one `Exit`.
    pub fn start(
        &self,
        program: &Path,
        args: &[String],
        cwd: &Path,
        env: Vec<(String, OsString)>,
        sink: impl Fn(LspEvent) + Send + 'static,
    ) -> Result<u32, String> {
        self.stop();
        let mut child = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .env_clear()
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", program.display()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "no stdin pipe".to_owned())?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "no stdout pipe".to_owned())?;
        let id = {
            let mut next = self
                .next_id
                .lock()
                .map_err(|_| "internal state error".to_owned())?;
            *next += 1;
            *next
        };
        let child = Arc::new(Mutex::new(child));
        let reader_child = Arc::clone(&child);
        std::thread::Builder::new()
            .name(format!("lsp-reader-{id}"))
            .spawn(move || {
                let mut parser = FrameParser::default();
                let mut chunk = [0u8; 64 * 1024];
                loop {
                    match stdout.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => match parser.push(&chunk[..n]) {
                            Ok(frames) => {
                                for json in frames {
                                    sink(LspEvent::Message { json });
                                }
                            }
                            Err(message) => {
                                sink(LspEvent::Error { message });
                                break;
                            }
                        },
                        Err(e) => {
                            sink(LspEvent::Error {
                                message: e.to_string(),
                            });
                            break;
                        }
                    }
                }
                drop(stdout);
                let code = reader_child
                    .lock()
                    .ok()
                    .map(|mut c| wait_or_kill(&mut c))
                    .unwrap_or(None);
                sink(LspEvent::Exit { code });
            })
            .map_err(|e| format!("could not start the reader thread: {e}"))?;
        *self
            .session
            .lock()
            .map_err(|_| "internal state error".to_owned())? = Some(Session { id, child, stdin });
        Ok(id)
    }

    pub fn send(&self, id: u32, json: &str) -> Result<(), String> {
        let mut guard = self
            .session
            .lock()
            .map_err(|_| "internal state error".to_owned())?;
        let session = guard
            .as_mut()
            .filter(|s| s.id == id)
            .ok_or_else(|| "the language server is not running".to_owned())?;
        session
            .stdin
            .write_all(&encode_frame(json))
            .and_then(|_| session.stdin.flush())
            .map_err(|e| format!("could not write to the language server: {e}"))
    }

    /// Closes the server's stdin, then kills it if it has not exited within a second. The
    /// reader thread reports the `Exit` event once stdout reaches EOF.
    pub fn stop(&self) {
        let session = self.session.lock().ok().and_then(|mut g| g.take());
        if let Some(Session { child, stdin, .. }) = session {
            drop(stdin);
            if let Ok(mut child) = child.lock() {
                wait_or_kill(&mut child);
            }
        }
    }
}

/// Waits up to one second for the child, then kills it. Safe to call more than once.
fn wait_or_kill(child: &mut Child) -> Option<i32> {
    for _ in 0..20 {
        match child.try_wait() {
            Ok(Some(status)) => return status.code(),
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
            Err(_) => break,
        }
    }
    let _ = child.kill();
    child.wait().ok().and_then(|s| s.code())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(json: &str) -> Vec<u8> {
        format!("Content-Length: {}\r\n\r\n{json}", json.len()).into_bytes()
    }

    #[test]
    fn frames_split_and_join_across_pushes() {
        let mut p = FrameParser::default();
        let mut two = frame("{\"a\":1}");
        two.extend(frame("{\"b\":2}"));
        assert_eq!(p.push(&two).expect("ok"), vec!["{\"a\":1}", "{\"b\":2}"]);

        let one = frame("{\"c\":\"çğı\"}");
        let (x, rest) = one.split_at(7);
        let (y, z) = rest.split_at(15);
        assert!(p.push(x).expect("ok").is_empty());
        assert!(p.push(y).expect("ok").is_empty());
        assert_eq!(p.push(z).expect("ok"), vec!["{\"c\":\"çğı\"}"]);
    }

    #[test]
    fn frame_over_limit_is_an_error() {
        let mut p = FrameParser::default();
        let header = format!("Content-Length: {}\r\n\r\n", MAX_FRAME + 1);
        assert!(p.push(header.as_bytes()).is_err());
    }

    #[test]
    fn missing_content_length_is_an_error() {
        let mut p = FrameParser::default();
        assert!(p.push(b"Content-Type: application/json\r\n\r\n{}").is_err());
    }

    #[test]
    fn encode_frame_round_trips() {
        let mut p = FrameParser::default();
        let bytes = encode_frame("{\"id\":1}");
        assert!(bytes.starts_with(b"Content-Length: 8\r\n\r\n"));
        assert_eq!(p.push(&bytes).expect("ok"), vec!["{\"id\":1}"]);
    }

    #[test]
    fn session_talks_to_a_fake_server() {
        use std::sync::mpsc;
        use std::time::Duration;
        let python = match crate::xtool::find_in_path(
            "python3",
            &std::env::var_os("PATH").unwrap_or_default(),
        ) {
            Some(p) => p,
            None => {
                eprintln!("python3 not found: fake LSP test skipped (NOT VERIFIED)");
                return;
            }
        };
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fake_lsp.py");
        let (tx, rx) = mpsc::channel::<LspEvent>();
        let state = LspState::default();
        let id = state
            .start(
                &python,
                &[script.to_string_lossy().into_owned()],
                std::env::temp_dir().as_path(),
                vec![],
                move |ev| {
                    let _ = tx.send(ev);
                },
            )
            .expect("start");
        state
            .send(
                id,
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}",
            )
            .expect("send");
        let first = rx.recv_timeout(Duration::from_secs(10)).expect("response");
        assert!(
            matches!(&first, LspEvent::Message { json } if json.contains("\"id\": 1") || json.contains("\"id\":1"))
        );
        let second = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("notification");
        assert!(
            matches!(&second, LspEvent::Message { json } if json.contains("publishDiagnostics"))
        );
        state.stop();
        let exit = rx.recv_timeout(Duration::from_secs(10)).expect("exit");
        assert!(matches!(exit, LspEvent::Exit { .. }));
        assert!(state.send(id, "{}").is_err());
    }
}
