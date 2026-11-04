# Maintenance (slice 2, sub-project 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Releases tag themselves when a `chore(release): X.Y.Z` commit lands on main, `ai.rs` is split by responsibility without behaviour change, and the owner has a written verification tour wired to STATUS.

**Architecture:** The release-gate logic lives in a shell script (`scripts/release-tag-check.sh`) with a `--self-test`, so the workflow is a thin caller and the rules are tested in CI like `doctor.sh`. The Rust split moves code into `src-tauri/src/ai/{mod,types,endpoints,stream,http}.rs` keeping every public name re-exported from `ai`. The tour is a document plus a STATUS table.

**Tech Stack:** GitHub Actions (`gh` CLI on the runner), bash + shellcheck, Rust 2021 (cargo test count as the refactor oracle), Markdown.

**Spec:** `docs/superpowers/specs/2026-11-03-launch-readiness-2-design.md`, section "4. Maintenance".

## Global Constraints

- Trigger rule: the job proceeds only when the head commit subject starts with `chore(release): `; any other push exits 0 with a notice.
- Before tagging: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` versions must agree and `CHANGELOG.md` must contain `## [<version>]`; failures happen before any tag exists.
- Existing tag `v<version>` → exit 0 with a notice (idempotent).
- Tag pushed with `GITHUB_TOKEN` does not fire `on: push: tags`; the workflow dispatches `release.yml` with `tag=v<version>` itself. Permissions: `contents: write`, `actions: write`.
- Rust public API of `ai` unchanged; `lib.rs` and `cli_ai.rs` compile without edits; Rust test count stays 115 (28 from `ai.rs`).
- Status vocabulary in the tour: `VERIFIED | NOT VERIFIED | BLOCKED`.
- Do not touch `terminalInput.ts`, `TerminalPanel.tsx`, `UpdatesSection.tsx` (PR #52).

## Review Focus

- A release PR merged with a version the CHANGELOG does not mention: the check must fail with the missing heading named and create no tag (Task 1 self-test case `changelog-missing`).
- A merge commit whose subject is `Merge pull request … chore(release): 0.2.0`: the rule matches the subject start only, so this is "not a release commit" and exits 0 (Task 1 case `merge-subject`).
- Version strings with pre-release suffixes (`0.2.0-beta.1`): accepted by the agreement check and tagged `v0.2.0-beta.1` (Task 1 case `prerelease-suffix`).
- A re-run of the workflow after the tag exists: exits 0, does not dispatch release twice (Task 1 case `tag-exists`).
- After the split, a provider error body containing an API key must still be redacted (existing test `http_error_includes_provider_message_but_not_keys` moves to `http.rs` and must still run: Task 2 count check).

---

### Task 1: Release tag check script + auto-tag workflow

**Files:**
- Create: `scripts/release-tag-check.sh`
- Create: `.github/workflows/auto-tag.yml`
- Modify: `.github/workflows/ci.yml` (job `shell`: add the self-test)
- Modify: `docs/RELEASING.md` (step 5)

**Interfaces:**
- Produces: `scripts/release-tag-check.sh <commit-subject> <repo-root> [--tag-exists <0|1>]` prints one of `SKIP: <reason>` (exit 0), `TAG v<version>` (exit 0), `ERROR: <reason>` (exit 1). `--self-test` runs the fixture cases and exits 0/2.

- [ ] **Step 1: Write the failing self-test** in `scripts/release-tag-check.sh` (the script is created with the self-test harness first; each case builds a temp repo root with the three version files and a CHANGELOG):
  - `release-ok`: subject `chore(release): 0.1.12 (#60)`, versions all `0.1.12`, CHANGELOG has `## [0.1.12] - 2026-11-04` → `TAG v0.1.12`
  - `not-release`: subject `fix(update): x` → `SKIP: not a release commit`
  - `merge-subject`: subject `Merge pull request #1 from x/chore(release): 0.2.0` → `SKIP: not a release commit`
  - `version-mismatch`: Cargo.toml `0.1.11`, others `0.1.12` → `ERROR: version mismatch` (exit 1)
  - `changelog-missing`: no `## [0.1.12]` → `ERROR: CHANGELOG.md has no section ## [0.1.12]` (exit 1)
  - `prerelease-suffix`: `0.2.0-beta.1` everywhere → `TAG v0.2.0-beta.1`
  - `tag-exists`: `--tag-exists 1` → `SKIP: tag v0.1.12 already exists`
- [ ] **Step 2: Run** `bash scripts/release-tag-check.sh --self-test` — Expected: `self-test: FAILED` (cases fail because the main logic is absent).
- [ ] **Step 3: Implement the main logic** (bash, `set -u`, no `jq`: read versions with `sed`/`grep`; version regex `^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$`).
- [ ] **Step 4: Run** `bash scripts/release-tag-check.sh --self-test && shellcheck -S warning scripts/release-tag-check.sh` — Expected: `self-test: all passed`, shellcheck silent.
- [ ] **Step 5: Write `.github/workflows/auto-tag.yml`**: `on: push: branches: [main]`; `permissions: contents: write, actions: write`; `concurrency: auto-tag`; steps: checkout (pinned SHA as the other workflows, `fetch-depth: 0`), read subject `git log -1 --format=%s`, `EXISTS=$(git ls-remote --tags origin "refs/tags/v$VERSION" | wc -l)`-style check, run the script, on `TAG v…` create `git tag -a` with `github-actions[bot]` identity and `git push origin "v$VERSION"`, then `gh workflow run release.yml -f tag="v$VERSION"` with `GH_TOKEN: ${{ github.token }}`.
- [ ] **Step 6: Add to `ci.yml` job `shell`**: `bash scripts/release-tag-check.sh --self-test` after the doctor self-test. Run locally: `shellcheck -S warning scripts/*.sh` — Expected: silent.
- [ ] **Step 7: Update `docs/RELEASING.md` step 5**: "Merging the `chore(release): X.Y.Z` pull request is the approval: `auto-tag.yml` tags `vX.Y.Z` and starts the Release workflow. Manual fallback: the two git commands." Keep the pre-release rule.
- [ ] **Step 8: Commit** `git add scripts/release-tag-check.sh .github/workflows/auto-tag.yml .github/workflows/ci.yml docs/RELEASING.md && git commit -m "ci: tag and release automatically when a chore(release) commit lands on main"`

### Task 2: Split `ai.rs` into a module directory

**Files:**
- Create: `src-tauri/src/ai/mod.rs`, `src-tauri/src/ai/types.rs`, `src-tauri/src/ai/endpoints.rs`, `src-tauri/src/ai/stream.rs`, `src-tauri/src/ai/http.rs`
- Delete: `src-tauri/src/ai.rs`
- No change: `src-tauri/src/lib.rs`, `src-tauri/src/cli_ai.rs`

**Interfaces:**
- Produces (re-exported from `ai`): `Provider`, `Message`, `ChatRequest`, `AiEvent`, `ModelInfo`, `Endpoints`, `HttpRequest`, `validate_ollama_base`, `build_request`, `StreamParser`, `http_error`, `stream_chat`, `list_models`, `parse_models`.
- Split: `types.rs` = `Provider` (+ `label`), `Message`, `ChatRequest`, `AiEvent`, `ModelInfo` and the `const`s they need; `endpoints.rs` = `Endpoints`, `validate_ollama_base`, `HttpRequest`, `join_url`, `temperature_value`, `require_key`, `validate_request`, `message_json`, `build_request`; `stream.rs` = `LineBuffer`, `error_event`, `StreamParser` and its handlers, `sse_data`, `truncate_chars`, `redact_secrets`, `error_detail`, `http_error`; `http.rs` = `Wait`, `wait_cancellable`, `client_error`, `build_client`, `stream_chat`, `parse_models`, `list_models`. Each file keeps the tests that exercise its items (the shared test helpers `request`, `header`, `delta`, `parse_all`, `parse_bytewise`, samples go to a `#[cfg(test)] pub(super) mod testutil` in `mod.rs`).

- [ ] **Step 1: Record the baseline**: `cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep "test result"` — Expected first line: `115 passed`.
- [ ] **Step 2: Create the module files** by moving code (no edits beyond `use` paths and `pub(super)` visibility); `mod.rs` declares the four modules and `pub use`s the names above.
- [ ] **Step 3: Verify** `cargo fmt --manifest-path src-tauri/Cargo.toml && cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings && cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep "test result"` — Expected: clippy silent, `115 passed`.
- [ ] **Step 4: Confirm no file over 500 lines**: `wc -l src-tauri/src/ai/*.rs` — Expected: each ≤ 500 (stream.rs may reach ~450).
- [ ] **Step 5: Commit** `git add -A src-tauri/src/ai src-tauri/src/ai.rs && git commit -m "refactor(ai): split ai.rs into types, endpoints, stream and http modules"`

### Task 3: Verification tour document + STATUS table

**Files:**
- Create: `docs/VERIFICATION_TOUR.md`
- Modify: `docs/STATUS.md` (new section "Verification tour" at the top, below the latest version entry)
- Modify: `docs/ROADMAP.md` (M6: mark the tour item ◐ "document ready, owner run pending")

- [ ] **Step 1: Write `docs/VERIFICATION_TOUR.md`** with numbered items, each `Action / Expected / STATUS line it verifies`: (1) install DEB from Releases, app opens; (2) Derle → Ortamı denetle shows PASS for swift/xtool/SDK; (3) `xtool new` from the app creates a project; (4) Yalnızca derle succeeds on it; (5) Cihazlar lists the iPhone; (6) Derle ve Yükle installs and launches; (7) Claude Code opens with `.claude/skills` present; (8) Turkish letters in the embedded terminal; (9) Ayarlar → Güncellemeler reports "Güncelsiniz"; (10) App Store hazırlığı on a real project runs; (11) a copy/paste in the terminal (after PR #52). Items 12–13 are placeholders for sub-projects 1 and 3 (preflight green on a new project; Swift completion in `ContentView.swift`), marked "after PR".
- [ ] **Step 2: Add the STATUS table** with 13 rows, all `NOT VERIFIED`, columns `#, What, Result, Date, Note`.
- [ ] **Step 3: Verify** `npm run validate:policies` still passes (docs do not affect it; run as the repo's cheap check) and `git diff --stat` shows only the three docs.
- [ ] **Step 4: Commit** `git add docs/VERIFICATION_TOUR.md docs/STATUS.md docs/ROADMAP.md && git commit -m "docs: verification tour for the owner, wired to STATUS"`

### Task 4: Whole-plan verification and push

- [ ] **Step 1:** `npm run verify` — Expected: all green (unchanged counts: Vitest 345+, typecheck, lint).
- [ ] **Step 2:** `cargo test --manifest-path src-tauri/Cargo.toml` — Expected: `115 passed`.
- [ ] **Step 3:** `git push -u origin feature/launch-readiness-2`.
