# Status

Last updated: 2026-10-31

## M3 (PR #16, in progress)
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
- Detectors: 6 App Store (ASR-011, 013, 014, 015, 017, 019) and 11 security (MSEC-012, 013, 014, 016, 019, 021, 022, 023, 024, 025, 026), all `PARTIAL` (source-level only).
- UI: App Store Readiness and Security Center panels in the activity bar; the Rust command `scan_workspace` feeds project files to the engine.
- Remaining 33 rules are `MANUAL_ONLY` or `NOT_IMPLEMENTED` and always show `NOT_VERIFIED`. No score is computed.
- `lastVerified` is `null` for every rule: official sources were not compared in this session; Apple guideline numbers in titles come from memory and need verification.

## Not done yet
- AI engine does not call `buildPolicyContext` yet (the AI engine itself arrives in M3); the function and tests exist.
- Remediation flow is not wired to a UI; no auto-fix is applied anywhere.
- Fixture-directory layout (`policies/fixtures/`) not used; fixtures are inline in tests.
- Secret scanning job in CI, Playwright smoke, window-close unsaved-changes warning.
- IPA/APK binary analysis (MSEC-014 checks source only).

## Test status
See the PR. NOT VERIFIED: launch of the desktop app on a real Linux desktop.
