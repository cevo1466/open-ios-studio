# Status

Last updated: 2026-10-31

## Current stage
Milestone 1 — desktop foundation (PR #13). M0 merged (PR #1).

## Done
- Tauri 2 + React + Vite + Monaco (Swift highlighting) app: open folder (native picker in Rust), explorer, tabs, create/edit/save (atomic), dirty tracking, settings (theme, font size), command palette, light/dark.
- `fs_engine` (Rust): workspace root canonicalization, traversal and symlink-escape rejection, size cap, UTF-8 only, atomic write.
- Not-yet-built features are visible but disabled and labelled with their milestone.
- CI: `ci.yml` (typecheck, eslint, vitest, build, npm audit, cargo fmt/clippy/test, advisory cargo-audit) and `build-linux.yml` (DEB + AppImage + SHA256).
- Found and fixed in CI: rustfmt diff; critical `dompurify` advisory pulled in by monaco-editor (pinned `monaco-editor@0.56.0`, `overrides: dompurify ^3.4.17`).

## Test status
- Vitest: 9 passed (reducer, settings). ESLint, tsc, vite build: pass locally and in CI.
- Rust: fmt, clippy `-D warnings`, `cargo test` (fs_engine incl. symlink escape): pass in CI.
- Artifact inspection: SHA256 verified; DEB structure and contents listed (binary `usr/bin/open-ios-studio`, desktop entry, icons); AppImage is an ELF, 80 MB.
- **NOT VERIFIED:** the app window launching on a real Linux desktop (no display on dev host). Owner must run the DEB/AppImage on Linux Mint.
- **Not delivered yet:** Playwright smoke test, Rust-side IPC integration test, window-close warning for unsaved changes, secret scanning job.

## Known issues
- Bundle ships Monaco language workers (ts/css/html/json) that are not wired; ~14 MB frontend. Can be trimmed later.
- GitHub Actions pinned by major tag, not SHA (hardening TODO).
- Placeholder generated icon.

## Next
1. Policy Engine core PR (`feature/policy-engine-core`).
2. M2 xtool adapter.
