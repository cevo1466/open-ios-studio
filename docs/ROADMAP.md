# Roadmap

Legend: ☐ not started · ◐ in progress · ☑ done (verified per Definition of Done).

Definition of Done (all milestones): code implemented; relevant tests pass; error paths handled; security checked; docs updated; pushed; CI verified; known limitations reported.

## M0 — Research & Architecture ☑ (merged, PR #1)
- Scope: repo audit, xtool source analysis, architecture, risk register, ADRs, backlog.
- Deliverables: `docs/research/XTOOL_*.md` (5), `ARCHITECTURE.md`, `ROADMAP.md`, `STATUS.md`, `RISKS.md`, ADR-0001..0006, `CLAUDE.md`, GitHub issues.
- Acceptance: owner can review one PR and approve the plan. Dynamic xtool tests are `BLOCKED`, stated explicitly.
- Security: no secrets in docs; upstream code not copied.

## M1 — Desktop Foundation ☑ (merged, PR #13)
- Scope: Tauri window, React shell, Monaco, explorer, open/create-file/edit/save, settings, theme, command palette, state store. Unavailable features visibly disabled.
- Dependencies: M0 approval. Tests: Rust (path safety, atomic write), Vitest, Playwright smoke.
- Deliverables: CI (`ci.yml`), `build-linux.yml` producing DEB + AppImage + SHA256.
- Acceptance: Actions green; artifacts inspected (`dpkg-deb`, checksum); open/edit/save covered by tests. Launch on Mint = NOT VERIFIED until owner confirms.
- Security: traversal/symlink tests, capability-scoped IPC, `permissions: contents: read` on PR workflows.

## Policy Engine core ☑ (merged; detectors stay PARTIAL, see STATUS.md)
- Scope: rule catalog (ASR-001..024, MSEC-001..026) with real implementation status, schema, Capability Manifest, evaluator, first detector slice, remediation architecture, prompt-context builder, App Store Readiness + Security Center panels, CI gates.
- Acceptance: schema-valid catalog; rule tests incl. false-positive/negative cases; no rule `PASS` without executed check; unimplemented rules shown as such.

## M2 — xtool Integration ☑ (merged, PR #15; real build/device BLOCKED in CI)
CLI adapter, toolchain/SDK diagnostics, project creation, build + log streaming, cancel, error parsing, mock + CI fixture tests; real build tests on owner machine (`BLOCKED` in CI: SDK license).

## M3 — AI Development Engine ☑ (merged, PR #16)
Provider interface (Claude/OpenAI/Ollama), keyring key storage, streaming chat, project context with token budget, plan → manifest → generation → validation → review → write, diff approval, build-error repair loop (bounded retries).

## M4 — Device & Testing ◐ (merged; device flows BLOCKED without an iPhone)
Device discovery, signing flow, install/launch, test results. Device tests `BLOCKED` without an iPhone.

## M5 — Open Source Release ☑ (v0.1.0 pre-release published)
Release workflow (tag-triggered, owner-approved), checksums, contributor guide, SECURITY.md, versioning, release notes, README for Linux Mint.

## Subscription providers + embedded terminal ☑ (merged, PR #22; real desktop use NOT VERIFIED)
- ADR-0008/0009. Real subscription call and desktop terminal launch NOT VERIFIED until run on Linux Mint.

## M6 — Launch readiness ◐ (owner goals from 2026-11-03)
Goal: a developer who installs the DEB/AppImage can go from an empty folder to an app on an iPhone and to a reviewed App Store submission without surprises.
- ☑ Environment check in the app (Derle → Ortam denetimi) and `scripts/doctor.sh`; `docs/ENVIRONMENT.md` with what Linux can and cannot do.
- ☑ Bundled agent skills in every project (`ios-app-xtool`, `mobile-ios-design`, `find-skills`, ADR-0015).
- ☑ Updates from the app (Ayarlar → Güncellemeler): GitHub release check, checksum-verified download, AppImage in-place replace, DEB install command.
- ☑ VS Code parity, step 1: one section title in Files; App Store / Güvenlik open in the editor area instead of a modal.
- ◐ App Store submission pipeline (separate PR, feature/appstore-release, ADR-0013/0014). Needs a paid Apple Developer Program account; NOT VERIFIED end to end.
- ☑ Pre-submission check ("Yayın öncesi denetim", PR #53): build, `swift test`, policy, secrets, manifest, icon; green/red verdict bound to the files; red blocks install/launch until green; report hand-off to Claude Code. UI tests (XCUITest) stay impossible on Linux and are reported as NOT_VERIFIED.
- ◐ VS Code parity, step 2: editor tabs for non-file views and palette entries for every panel are done (PR #53); still open: keyboard shortcuts list, Explorer context menu (rename/delete with confirmation), the release panel as a tab once #41 lands.
- ◐ Verification tour: `docs/VERIFICATION_TOUR.md` written with 14 items and a STATUS table; the owner's run is pending.
- ☑ Release automation: `auto-tag.yml` tags `chore(release): X.Y.Z` merges and starts the Release workflow (rules in `scripts/release-tag-check.sh`).
- ☐ Turkish text in the embedded Claude Code terminal: 0.1.11 (#49) ships the fix; the owner reported it works; tour item T8 records it.
- ◐ Swift language support (PR #53): sourcekit-lsp session from Rust, Monaco completion/hover/markers, Sorunlar rows and a status-bar segment. Tested against a fake server; a real `sourcekit-lsp` on the owner's machine is tour item T13.
