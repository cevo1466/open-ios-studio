# Architecture

Status: **design (Milestone 0)**. Nothing below is implemented yet; see `STATUS.md`.

## Principles
Hexagonal: domain logic has no Tauri/OS imports; ports are traits/interfaces; adapters talk to the OS, xtool, Git, AI providers. Tauri commands are a thin IPC layer. No abstraction without a second implementation or a test seam.

## Layers

```
React UI (src/)  ── IPC (Tauri commands/events) ──  Rust core (src-tauri/)
  features/ explorer editor tabs settings            domain/   Workspace, ProjectInfo, BuildEvent …
  state/    store (single source of UI state)        ports/    FileStore, BuildBackend, SecretStore, Git
  policy/   Policy Engine (TypeScript)               adapters/ fs_engine, xtool_cli, keyring, git_cli
  ai/       providers behind one interface (M3)      commands/ IPC, capability-scoped
```

## Modules (from the master prompt)
| Module | First delivered | Notes |
|---|---|---|
| Desktop shell, theme, command palette | M1 | |
| File system engine | M1 | canonical workspace root, traversal + symlink checks, atomic write, size cap |
| Project manager | M1 (open) / M2 (create via xtool) | generator must match `xtool new` layout (`XTOOL_CLI_CONTRACTS.md`) |
| Code editor (Monaco) | M1 | Swift highlighting; LSP hook later |
| xtool build adapter | M2 | `XTOOL_INTEGRATION_STRATEGY.md` |
| AI engine | M3 | provider-agnostic, approval workflow, keys in OS keyring |
| Device manager | M4 | `devices --no-wait`; clear "no device" state |
| GitHub integration | after M2 | use system `git`/`gh` auth |
| Policy Engine | PR 3 | TypeScript core, JSON rules, `ENFORCED/PARTIAL/MANUAL_ONLY/NOT_IMPLEMENTED` tracking |

## Security boundaries
1. Webview is untrusted: capabilities grant only the specific commands; no generic shell/fs plugin exposure.
2. Every path crosses `fs_engine::resolve_in_workspace`.
3. Every child process goes through one runner (`XTOOL_INTEGRATION_STRATEGY.md`).
4. Secrets only in the OS keyring (M3), never in settings JSON or logs.

## Testing
Rust unit + integration (mock `BuildBackend`), Vitest for state/policy, Playwright smoke for the web layer, CI packaging checks. Real xtool/device tests are separate and reported `BLOCKED` where the environment lacks them.
