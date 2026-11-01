# ADR-0009: Embedded terminal
Status: accepted (2026-11-01)

Context: users need to run `claude auth login` / `codex login` and sometimes their own shell without leaving the app. ADR-0006 forbids shell execution for commands the *application* decides to run.

Decision:
- `src-tauri/src/pty.rs` (portable-pty) + `TerminalPanel` (xterm.js). Session kinds are an allow-list: `claude-login`, `codex-login` (fixed argv from `cli_ai.rs`) and `user-shell` (the user's `$SHELL`, opened only by an explicit click on "Terminal").
- ADR-0006 still governs everything the app or the AI runs. The `user-shell` session is the user's own terminal, like in any IDE: only keystrokes typed into the panel reach `pty_write`; AI output, repo content and build logs have no path to it.
- Scrubbed environment (no API keys), workspace (or home) as working directory, at most 4 sessions, closing the panel kills the child, output is decoded with UTF-8 boundary handling and streamed over a Tauri channel.

Consequences: new dependencies (`portable-pty`, `@xterm/xterm`, `@xterm/addon-fit`). Running on a real Linux desktop is NOT VERIFIED until the owner tries it.
