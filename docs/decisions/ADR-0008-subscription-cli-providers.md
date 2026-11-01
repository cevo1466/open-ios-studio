# ADR-0008: Subscription providers through the official CLIs
Status: accepted (2026-11-01)

Context: API keys are billed per token. Many users already pay for a Claude subscription or a ChatGPT plan (Codex) and want to use that instead. Both vendors' official CLIs (`claude`, `codex`) hold the subscription login themselves.

Decision:
- Two new providers, `claude-cli` and `codex-cli`, run the official CLI with a fixed argument vector (`src-tauri/src/cli_ai.rs`). Studio **never reads the CLIs' credential files and never handles a token**; extracting subscription tokens for use in a third-party client is out of scope and not done.
- Claude: `claude -p --output-format stream-json --verbose --include-partial-messages --tools "" --no-session-persistence --strict-mcp-config [--model m]`. Codex: `codex exec --json --sandbox read-only --ephemeral --skip-git-repo-check --color never [-m m] -`. Tools are disabled / the sandbox is read-only, the working directory is an empty temp directory, and the model still cannot change files except through Studio's reviewed `<<<FILE>>>` proposals (ADR-0007).
- The prompt goes on **stdin** (an argument could exceed the Linux argument limit). This is the narrow exception to ADR-0006's "stdin closed": fixed program, fixed args, prompt bytes only on stdin, no shell. The shared `runner.rs` is not used because its line cap (8 KiB) is too small for stream-json lines.
- The child environment is allow-listed; `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are never forwarded, so a stray key cannot silently switch a session to pay-per-token billing. `CODEX_HOME` / `CLAUDE_CONFIG_DIR` are forwarded only so the CLI finds its own login.
- Login state comes from `claude auth status --json` and `codex login status` (`cli_status`). The UI shows missing / logged out / ready and warns when the CLI reports an API-key login.
- Login happens in a terminal: either the embedded one (ADR-0009) or the system terminal (`cli_login_terminal`, allow-listed emulators, fixed argv).

Consequences: subscription usage limits apply; CLI cold start is slower than a direct API call; output formats of the CLIs are parsed from their documented JSON events and covered by unit tests with captured-shape fixtures, but a real subscription call is NOT VERIFIED until the owner runs it on a desktop.
