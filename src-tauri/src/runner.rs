//! Shell-free child process runner used for every external tool (xtool, swift).
//!
//! Guarantees: program + argument vector only, scrubbed environment, closed stdin, own process
//! group, bounded line length and line count, timeout, cancellation (SIGTERM, then SIGKILL).

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Longest line forwarded to the caller; the rest of a longer line is discarded.
pub const MAX_LINE_BYTES: usize = 8192;
/// Most lines forwarded per run; further lines are counted as dropped.
pub const MAX_FORWARDED_LINES: u64 = 20_000;
/// Time between SIGTERM and SIGKILL.
pub const KILL_GRACE: Duration = Duration::from_secs(5);

/// Variables copied from the parent. Everything else (notably `XTL_*`) is removed.
const ENV_ALLOW_LIST: [&str; 10] = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExitInfo {
    /// `None` when the process was killed by a signal.
    pub code: Option<i32>,
    pub cancelled: bool,
    pub timed_out: bool,
    pub dropped_lines: u64,
}

#[derive(Debug, Clone)]
pub struct Spec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// Extra variables set on top of the allow-listed ones.
    pub env: Vec<(String, String)>,
    pub timeout: Duration,
}

#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

struct Line {
    stream: Stream,
    text: String,
}

fn spawn_reader<R: Read + Send + 'static>(
    source: R,
    stream: Stream,
    tx: mpsc::SyncSender<Line>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut reader = BufReader::new(source);
        loop {
            let mut buf = Vec::new();
            let read = reader
                .by_ref()
                .take(MAX_LINE_BYTES as u64)
                .read_until(b'\n', &mut buf);
            match read {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let complete = buf.last() == Some(&b'\n');
                    if !complete && n == MAX_LINE_BYTES {
                        // Over-long line: discard the remainder up to the next newline.
                        loop {
                            let (consumed, found) = match reader.fill_buf() {
                                Ok([]) | Err(_) => (0, true),
                                Ok(avail) => match avail.iter().position(|b| *b == b'\n') {
                                    Some(i) => (i + 1, true),
                                    None => (avail.len(), false),
                                },
                            };
                            reader.consume(consumed);
                            if found {
                                break;
                            }
                        }
                    }
                    while matches!(buf.last(), Some(b'\n' | b'\r')) {
                        buf.pop();
                    }
                    let text = String::from_utf8_lossy(&buf).into_owned();
                    if tx.send(Line { stream, text }).is_err() {
                        break;
                    }
                }
            }
        }
    })
}

#[cfg(unix)]
fn terminate(child: &mut Child, hard: bool) {
    let signal = if hard { libc::SIGKILL } else { libc::SIGTERM };
    if let Ok(pid) = i32::try_from(child.id()) {
        // The child leads its own process group (process_group(0)), so -pid reaches its children.
        // SAFETY: plain syscall with integer arguments.
        unsafe {
            libc::kill(-pid, signal);
        }
    }
}

#[cfg(not(unix))]
fn terminate(child: &mut Child, hard: bool) {
    if hard {
        let _ = child.kill();
    }
}

/// Run `spec`, passing each output line to `on_line`. Blocks until the process has exited.
pub fn run(
    spec: &Spec,
    cancel: &CancelToken,
    mut on_line: impl FnMut(Stream, String),
) -> std::io::Result<ExitInfo> {
    let mut command = Command::new(&spec.program);
    command
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in ENV_ALLOW_LIST {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    for (key, value) in &spec.env {
        command.env(key, value);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn()?;
    let (tx, rx) = mpsc::sync_channel::<Line>(1024);
    if let Some(out) = child.stdout.take() {
        spawn_reader(out, Stream::Stdout, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        spawn_reader(err, Stream::Stderr, tx.clone());
    }
    drop(tx);

    let started = Instant::now();
    let mut forwarded: u64 = 0;
    let mut dropped: u64 = 0;
    let mut cancelled = false;
    let mut timed_out = false;
    let mut term_sent_at: Option<Instant> = None;
    let mut killed = false;

    let mut forward = |line: Line| {
        if forwarded < MAX_FORWARDED_LINES {
            forwarded += 1;
            on_line(line.stream, line.text);
        } else {
            dropped += 1;
        }
    };

    let status = loop {
        match rx.recv_timeout(Duration::from_millis(25)) {
            Ok(line) => forward(line),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => thread::sleep(Duration::from_millis(25)),
        }
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if term_sent_at.is_none() {
            if cancel.is_cancelled() {
                cancelled = true;
            } else if started.elapsed() >= spec.timeout {
                timed_out = true;
            }
            if cancelled || timed_out {
                terminate(&mut child, false);
                term_sent_at = Some(Instant::now());
            }
        } else if !killed && term_sent_at.is_some_and(|t| t.elapsed() >= KILL_GRACE) {
            terminate(&mut child, true);
            killed = true;
        }
    };

    // Collect output that was still in the pipes when the process exited.
    let drain_deadline = Instant::now() + Duration::from_secs(1);
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(line) => forward(line),
            Err(RecvTimeoutError::Timeout) => {
                if Instant::now() >= drain_deadline {
                    break;
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    Ok(ExitInfo {
        code: status.code(),
        cancelled,
        timed_out,
        dropped_lines: dropped,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    fn script(dir: &Path, body: &str) -> PathBuf {
        let path = dir.join("fake-tool");
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("chmod");
        path
    }

    fn spec(program: PathBuf, dir: &Path, timeout: Duration) -> Spec {
        Spec {
            program,
            args: Vec::new(),
            cwd: dir.to_path_buf(),
            env: Vec::new(),
            timeout,
        }
    }

    fn collect(spec: &Spec, cancel: &CancelToken) -> (ExitInfo, Vec<(Stream, String)>) {
        let mut lines = Vec::new();
        let info = run(spec, cancel, |s, t| lines.push((s, t))).expect("run");
        (info, lines)
    }

    #[test]
    fn streams_both_pipes_and_reports_exit_code() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = script(dir.path(), "echo out1\necho err1 >&2\necho out2\nexit 3");
        let (info, lines) = collect(&spec(tool, dir.path(), Duration::from_secs(10)), &CancelToken::new());
        assert_eq!(info.code, Some(3));
        assert!(!info.cancelled && !info.timed_out);
        assert!(lines.contains(&(Stream::Stdout, "out1".into())));
        assert!(lines.contains(&(Stream::Stdout, "out2".into())));
        assert!(lines.contains(&(Stream::Stderr, "err1".into())));
    }

    #[test]
    fn environment_is_scrubbed_but_extras_pass() {
        std::env::set_var("XTL_DISABLE_TLS_VALIDATION", "1");
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = script(
            dir.path(),
            "echo tls=${XTL_DISABLE_TLS_VALIDATION:-unset}\necho extra=${OIS_EXTRA:-unset}",
        );
        let mut s = spec(tool, dir.path(), Duration::from_secs(10));
        s.env.push(("OIS_EXTRA".into(), "yes".into()));
        let (_, lines) = collect(&s, &CancelToken::new());
        assert!(lines.contains(&(Stream::Stdout, "tls=unset".into())));
        assert!(lines.contains(&(Stream::Stdout, "extra=yes".into())));
    }

    #[test]
    fn stdin_is_closed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = script(dir.path(), "cat\necho done");
        let (info, lines) = collect(&spec(tool, dir.path(), Duration::from_secs(10)), &CancelToken::new());
        assert_eq!(info.code, Some(0));
        assert!(lines.contains(&(Stream::Stdout, "done".into())));
    }

    #[test]
    fn timeout_terminates_the_process_group() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = script(dir.path(), "sleep 30");
        let started = Instant::now();
        let (info, _) = collect(&spec(tool, dir.path(), Duration::from_millis(300)), &CancelToken::new());
        assert!(info.timed_out);
        assert!(!info.cancelled);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn cancellation_stops_a_running_process() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = script(dir.path(), "echo started\nsleep 30");
        let s = spec(tool, dir.path(), Duration::from_secs(60));
        let cancel = CancelToken::new();
        let started = Instant::now();
        let (info, lines) = thread::scope(|scope| {
            let canceller = cancel.clone();
            scope.spawn(move || {
                thread::sleep(Duration::from_millis(300));
                canceller.cancel();
            });
            collect(&s, &cancel)
        });
        assert!(info.cancelled);
        assert!(lines.contains(&(Stream::Stdout, "started".into())));
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn overlong_lines_are_truncated_and_following_lines_survive() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = script(
            dir.path(),
            "head -c 30000 /dev/zero | tr '\\0' a\necho\necho after",
        );
        let (_, lines) = collect(&spec(tool, dir.path(), Duration::from_secs(10)), &CancelToken::new());
        assert!(lines.iter().all(|(_, t)| t.len() <= MAX_LINE_BYTES));
        assert!(lines.contains(&(Stream::Stdout, "after".into())));
    }

    #[test]
    fn excess_lines_are_dropped_and_counted() {
        let dir = tempfile::tempdir().expect("tempdir");
        let tool = script(dir.path(), "yes line | head -n 25000");
        let (info, lines) = collect(&spec(tool, dir.path(), Duration::from_secs(30)), &CancelToken::new());
        assert_eq!(lines.len() as u64, MAX_FORWARDED_LINES);
        assert_eq!(info.dropped_lines, 25_000 - MAX_FORWARDED_LINES);
    }

    #[test]
    fn missing_program_is_an_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let s = spec(dir.path().join("does-not-exist"), dir.path(), Duration::from_secs(5));
        assert!(run(&s, &CancelToken::new(), |_, _| {}).is_err());
    }
}
