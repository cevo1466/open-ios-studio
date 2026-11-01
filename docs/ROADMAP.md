# Roadmap

Legend: ☐ not started · ◐ in progress · ☑ done (verified per Definition of Done).

Definition of Done (all milestones): code implemented; relevant tests pass; error paths handled; security checked; docs updated; pushed; CI verified; known limitations reported.

## M0 — Research & Architecture ◐
- Scope: repo audit, xtool source analysis, architecture, risk register, ADRs, backlog.
- Deliverables: `docs/research/XTOOL_*.md` (5), `ARCHITECTURE.md`, `ROADMAP.md`, `STATUS.md`, `RISKS.md`, ADR-0001..0006, `CLAUDE.md`, GitHub issues.
- Acceptance: owner can review one PR and approve the plan. Dynamic xtool tests are `BLOCKED`, stated explicitly.
- Security: no secrets in docs; upstream code not copied.

## M1 — Desktop Foundation ☐
- Scope: Tauri window, React shell, Monaco, explorer, open/create-file/edit/save, settings, theme, command palette, state store. Unavailable features visibly disabled.
- Dependencies: M0 approval. Tests: Rust (path safety, atomic write), Vitest, Playwright smoke.
- Deliverables: CI (`ci.yml`), `build-linux.yml` producing DEB + AppImage + SHA256.
- Acceptance: Actions green; artifacts inspected (`dpkg-deb`, checksum); open/edit/save covered by tests. Launch on Mint = NOT VERIFIED until owner confirms.
- Security: traversal/symlink tests, capability-scoped IPC, `permissions: contents: read` on PR workflows.

## Policy Engine core ☐ (after M1 merge)
- Scope: rule catalog (ASR-001..024, MSEC-001..026) with real implementation status, schema, Capability Manifest, evaluator, first detector slice, remediation architecture, prompt-context builder, App Store Readiness + Security Center panels, CI gates.
- Acceptance: schema-valid catalog; rule tests incl. false-positive/negative cases; no rule `PASS` without executed check; unimplemented rules shown as such.

## M2 — xtool Integration ☐
CLI adapter, toolchain/SDK diagnostics, project creation, build + log streaming, cancel, error parsing, mock + CI fixture tests; real build tests on owner machine (`BLOCKED` in CI: SDK license).

## M3 — AI Development Engine ☑ (merged, PR #16)
Provider interface (Claude/OpenAI/Ollama), keyring key storage, streaming chat, project context with token budget, plan → manifest → generation → validation → review → write, diff approval, build-error repair loop (bounded retries).

## M4 — Device & Testing ◐ (merged; device flows BLOCKED without an iPhone)
Device discovery, signing flow, install/launch, test results. Device tests `BLOCKED` without an iPhone.

## M5 — Open Source Release ☑ (v0.1.0 pre-release published)
Release workflow (tag-triggered, owner-approved), checksums, contributor guide, SECURITY.md, versioning, release notes, README for Linux Mint.

## Subscription providers + embedded terminal ◐ (PR pending CI)
- ADR-0008/0009. Real subscription call and desktop terminal launch NOT VERIFIED until run on Linux Mint.
