# Status

## Subscription providers + embedded terminal (branch `feature/subscription-cli-providers`)
- New providers "Claude (abonelik)" and "Codex (ChatGPT aboneliği)" run the official `claude` / `codex` CLIs with the user's own login (ADR-0008); no API key needed. Login status badge, "Gömülü terminalde giriş yap", "Sistem terminalinde aç", "Durumu yenile".
- Embedded terminal (xterm.js + Rust PTY, ADR-0009) in the bottom dock; activity-bar "Terminal" opens the user's shell on explicit click.
- Tests: Vitest (cli helpers, settings), Rust unit tests for argument building, event parsing, status parsing, terminal argv, UTF-8 splitting and a PTY shell round trip; E2E mock updated.
- NOT VERIFIED: a real subscription call, `claude`/`codex` JSON event shapes against the installed CLI versions (parsers follow the documented stream-json / `--json` events), the PTY and terminal launch on a real Linux desktop. Rust was not compiled on the dev host; CI is the first compile.
- `Cargo.lock` is not regenerated on the dev host (no Rust); CI resolves `portable-pty` and a follow-up commit should add the lockfile.

## Released
**v0.1.0 (pre-release)**: https://github.com/cevo1466/open-ios-studio/releases/tag/v0.1.0 — `Open-iOS-Studio_0.1.0_amd64.deb`, `Open-iOS-Studio_0.1.0_amd64.AppImage`, `SHA256SUMS.txt` (checksums re-verified after downloading the published assets). Published by `release.yml` after verify and bundle jobs passed.
**NOT VERIFIED:** that the app window opens on a real Linux desktop (no display in CI or on the dev host). Please try the DEB/AppImage on Linux Mint and report.

Last updated: 2026-10-31

## M4 + M5 (this PR)
- Devices panel: `xtool devices --no-wait`, `auth status`, run on device (`dev run`), launch by bundle id; UDID/bundle id validated in Rust. Device output format is from xtool source (no device in CI): NOT VERIFIED on hardware. Device-dependent tests are BLOCKED.
- Not delivered: test-result view (no iOS test runner is available through xtool on Linux), signing flow UI beyond showing `auth status` (login stays in the user's terminal by design).
- Bug found by the E2E suite and fixed: the Monaco editor was controlled by React state, so fast typing raced with re-renders and scrambled characters (`let edited` became `ltedie`). The editor is now uncontrolled while typing; only external changes (new tab, reload after an approved AI change) are pushed in via a per-tab `rev`.
- E2E: Playwright against a mocked Tauri IPC (CI job `e2e`), gitleaks secret scan (CI job `secret-scan`).
- Release: `release.yml` (tag-triggered pre-release with checksums), SECURITY/CONTRIBUTING/CODE_OF_CONDUCT/CHANGELOG/RELEASING docs.

## M3 (merged, PR #16)
- Rust: `ai.rs` (Anthropic/OpenAI/Ollama streaming, dynamic model lists), `secrets.rs` (OS keyring), `apply_file`, `read_file_if_exists`.
- TS: file-block protocol parser, token-budgeted context, prompts (generate/chat/repair/plan), policy-checked proposals, review UI with Monaco diff, chat state/persistence, bounded repair loop (3 attempts).
- NOT VERIFIED: any real provider call (needs user API key / local Ollama); the OS keyring on a real desktop session (needs a Secret Service such as gnome-keyring).
- Not delivered: structured planning step UI (plan prompt exists, not wired), project memory beyond a notes field, file deletion by the AI (intentionally unsupported).

## M2 (merged, PR #15)
- Shell-free runner, xtool adapter (version, sdk status, new, build), Build panel, real xtool 1.24.0 CLI fixtures captured in CI and used in tests.
- BLOCKED: real build, signing, device (need Darwin SDK/Apple ID/iPhone).
- rustfmt patch artifact step added to CI (uploads a patch when formatting fails).

## Current stage
Policy Engine core (branch `feature/policy-engine-core`). M0 (#1) and M1 (#13) are merged.

## Policy Engine — what exists
- Catalogs: `policies/app-store.rules.json` (ASR-001..024), `policies/mobile-security.rules.json` (MSEC-001..026), schema `policies/schema/rule.schema.json`, validated by `scripts/validate-policies.mjs` (CI job `policy`).
- Engine (`src/policy/`): capability manifest, applicability, evaluator (PASS only when a detector ran), catalog loader, remediation flow with approval and forbidden-automatic list, AI prompt context with untrusted-data fencing.
- Detectors: 11 App Store (ASR-005, 008, 009, 011, 013, 014, 015, 016, 017, 019, 023) and 13 security (MSEC-012, 013, 014, 016, 017, 018, 019, 021, 022, 023, 024, 025, 026), all `PARTIAL` (source-level heuristics only; ASR-023 never passes).
- UI: App Store Readiness and Security Center panels in the activity bar; the Rust command `scan_workspace` feeds project files to the engine.
- Remaining 26 rules are `MANUAL_ONLY` or `NOT_IMPLEMENTED` (server behaviour, App Store Connect content, running app, human judgement) and always show `NOT_VERIFIED`. No score is computed.
- `lastVerified` is `null` for every rule: official sources were not compared in this session; Apple guideline numbers in titles come from memory and need verification.

## Not done yet
- AI engine does not call `buildPolicyContext` yet (the AI engine itself arrives in M3); the function and tests exist.
- Remediation flow is not wired to a UI; no auto-fix is applied anywhere.
- Fixture-directory layout (`policies/fixtures/`) not used; fixtures are inline in tests.
- Secret scanning job in CI, Playwright smoke, window-close unsaved-changes warning.
- IPA/APK binary analysis (MSEC-014 checks source only).

## Test status
See the PR. NOT VERIFIED: launch of the desktop app on a real Linux desktop.
