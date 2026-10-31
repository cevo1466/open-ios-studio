# xtool Integration Strategy

## Decision

Integrate through the **xtool CLI** from the Rust backend (ADR-0003). Do not link XKit, do not reimplement signing or provisioning, do not vendor upstream source.

## Port and adapter

```
domain:   BuildRequest, BuildEvent, XtoolInfo, DeviceInfo, Diagnostic
port:     trait BuildBackend { detect(); sdk_status(); new_project(); build(); cancel(); devices() }
adapters: XtoolCliBackend (real)   MockBackend (tests, fixtures)
```

Tauri commands only translate IPC ↔ port calls. The frontend never sees a process handle.

## Process runner (shared by all adapters)

- Spawn: program + args vector, `stdin` null, piped stdout/stderr, new process group.
- Env: allow-list (PATH, HOME, LANG, TMPDIR); strip `XTL_*` by default (see `XTOOL_SECURITY.md`).
- cwd: canonicalized path inside the workspace; reject symlink escape.
- Streaming: line-based events through a Tauri channel; ring buffer (e.g. 5 000 lines) to bound memory.
- Cancel: SIGTERM to the group, 5 s grace, then SIGKILL; reap children.
- Timeout per operation class (detect 10 s, build configurable).
- Redaction filter on every logged line.

## Parsing

Text parsers are tolerant and covered by fixtures. Diagnostics from `swift build` use the `file:line:col: error|warning: message` form; unparsed lines pass through as raw log. Build failure vs. success is decided by exit code first, parsing second.

## Milestone mapping

| Milestone | Uses |
|---|---|
| M1 | none (UI shows xtool section as "not available yet"; project creation gated) |
| M2 | `--version`, `sdk status`, `new --skip-setup <name>`, `dev build`, cancel, fixtures |
| M4 | `devices`, `install`, `launch`, `uninstall`, `dev build --sign` after user ran `xtool auth` |

## Platform notes

- Linux/WSL only for xtool; Studio on macOS/Windows can run the shell but the build tab reports the platform limit.
- Preconditions shown in the UI with exact detection results: Swift toolchain (`swift --version`), `usbmuxd`, Darwin SDK (`xtool sdk status`), auth (`xtool auth status`).
- No iOS simulator and no live SwiftUI preview are offered. Any future preview must be labeled an approximation.

## Open questions (carried to M2 research)

1. Exact `--help` output and exit codes per command (needs CI fixtures).
2. Behavior of `dev build` when run outside project root (upstream TODO says unsupported).
3. Whether `auth status` is script-friendly.
4. Cancellation cleanup of the SwiftPM child.
