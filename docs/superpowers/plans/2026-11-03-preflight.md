# Pre-submission check ("Yayın öncesi denetim") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One run that builds, tests, analyses and checks the open project, writes a report into the workspace, and gates "Derle ve Yükle", device install/launch and release steps until the verdict is green for the current files.

**Architecture:** Pure TypeScript step functions (`src/preflight/`) turn inputs (xtool run outcome, policy report, scanned files, PNG header) into `StepResult`s; `run.ts` orchestrates them through an injected `Deps` object so the whole flow is unit-tested without Tauri. Rust adds one allow-listed op (`swift-test`) and one read-only command (`read_png_header`). The report is persisted as JSON + Markdown under `.open-ios-studio/preflight/` and reloaded on workspace open; the gate compares the report's fingerprint with the current one.

**Tech Stack:** TypeScript (Vitest), React view in the editor region, Rust (Tauri command + runner spec), Web Crypto SHA-256 with an FNV-1a fallback.

**Spec:** `docs/superpowers/specs/2026-11-03-launch-readiness-2-design.md`, section "1. Pre-submission check" plus "Settled by the builder check".

## Global Constraints

- Step ids and order: `build`, `tests`, `policy`, `secrets`, `manifest`, `icon`. Statuses: `PASS | FAIL | WARNING | NOT_VERIFIED | BLOCKED`.
- Verdict `green` iff no step is `FAIL`; otherwise `red`. The verdict is bound to a fingerprint: SHA-256 (hex) over sorted `(path, content)` of scanned text files excluding paths under `.open-ios-studio/`, plus the icon header string `w×h:colorType` (or `none`).
- Gate reasons (exact Turkish): `Yayın öncesi denetim çalıştırılmadı`, `Yayın öncesi denetim kırmızı: <first failing step name>`, `Dosyalar değişti, denetimi yeniden çalıştırın`.
- Gate applies to `run-device`, `launch` and "Derle ve Yükle"; never to `build`, `new`, `sdk-status`, `devices`, `auth-status`, `version`.
- Report files: `.open-ios-studio/preflight/latest.json` and `.open-ios-studio/preflight/latest.md`, written with the workspace-confined `apply_file` command (creates parent dirs).
- `swift-test`: program `swift` from PATH, args `["test"]`, cwd = project dir (must contain `Package.swift`), timeout 20 min, same env allow-list as xtool. `NOT_VERIFIED` with reason when the project has no `Tests/` directory or `swift` is missing.
- Manifest rules: `xtool.yml` `bundleID` present and reverse-DNS (FAIL otherwise); usage-description keys required by imports must exist in the Info.plist named by `infoPath` (FAIL names the key); no Info.plist and no required key → `NOT_VERIFIED` "xtool varsayılanları kullanılıyor"; `CFBundleShortVersionString`/`CFBundleVersion` checked only when an Info.plist exists (WARNING when missing); `PrivacyInfo.xcprivacy` WARNING when a required-reason API appears and the file is missing, FAIL when present but not a plist dictionary.
- Icon: `iconPath` from `xtool.yml` (default `icon.png`): PASS when 1024×1024 PNG with colorType 2 or 0 (no alpha); FAIL otherwise or when missing.
- Honesty line on the view: `Yeşil, bu bilgisayarda derleme, testler ve kaynak düzeyi kontroller geçti demektir; App Store onayı anlamına gelmez.`
- `PtyOptions.extraContext`: optional, ≤ 2000 chars, no control characters (`\x00`–`\x1f` except none), appended to the fixed Claude Code context after one space; rejected otherwise.
- Do not touch `terminalInput.ts`, `TerminalPanel.tsx`, `UpdatesSection.tsx`.

## Review Focus

- A project whose build succeeds but `swift test` has no `Tests/` dir: tests step `NOT_VERIFIED`, verdict can still be green (Task 3 test `tests step is NOT_VERIFIED without a Tests directory`).
- Saving any file after a green check must flip the gate to "Dosyalar değişti" (Task 5 test + Task 7 E2E).
- The report written into the workspace must not change the fingerprint (exclusion of `.open-ios-studio/`, Task 1 test).
- An `xtool.yml` with `infoPath: Sources/App/Info.plist` (non-root plist) must be read from that path (Task 2 test).
- A critical policy FAIL (e.g. MSEC-014 secret) must make both `policy` and `secrets` steps FAIL, and the gate reason must name the first failing step in order (Task 3 + Task 4 tests).

---

### Task 1: Types and fingerprint

**Files:**
- Create: `src/preflight/types.ts`, `src/preflight/fingerprint.ts`
- Test: `src/preflight/fingerprint.test.ts`

**Interfaces:**
- Produces: `type StepId = 'build'|'tests'|'policy'|'secrets'|'manifest'|'icon'`; `type StepStatus = 'PASS'|'FAIL'|'WARNING'|'NOT_VERIFIED'|'BLOCKED'`; `interface StepResult { id: StepId; status: StepStatus; summary: string; details: string[] }`; `interface PreflightReport { version: 1; startedAt: string; finishedAt: string; project: string; fingerprint: string; steps: StepResult[]; verdict: 'green'|'red' }`; `STEP_ORDER: StepId[]`; `STEP_NAME: Record<StepId,string>` (Turkish: Derleme, Testler, Politika, Gizli anahtarlar, Manifest, Simge).
- `fingerprintFiles(files: {path: string; content: string}[], iconHeader: string): Promise<string>` — 64-hex SHA-256 via `globalThis.crypto.subtle` when available, else `fnv1a64Hex` (exported for tests) prefixed `fnv-`.

- [ ] **Step 1: Failing tests** `fingerprint.test.ts`: `same files in different order give the same fingerprint`; `a content change changes the fingerprint`; `files under .open-ios-studio/ are ignored`; `the icon header participates`; `fnv1a64Hex is stable` (`fnv1a64Hex('abc') === 'e71fa2190541574b'`).
- [ ] **Step 2:** `npx vitest run src/preflight` — Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `types.ts` and `fingerprint.ts` (sort by path, feed `path\0content\0` per file then `icon:<header>`; FNV-1a 64 with BigInt).
- [ ] **Step 4:** `npx vitest run src/preflight` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/preflight && git commit -m "feat(preflight): report types and workspace fingerprint"`

### Task 2: Manifest and icon checks (pure)

**Files:**
- Create: `src/preflight/manifest.ts`, `src/preflight/icon.ts`
- Test: `src/preflight/manifest.test.ts`, `src/preflight/icon.test.ts`

**Interfaces:**
- `readXtoolConfig(files: ProjectFile[]): { bundleId: string | null; infoPath: string | null; iconPath: string }` (regex over `xtool.yml`; `iconPath` default `icon.png`).
- `USAGE_KEYS: { pattern: RegExp; key: string }[]` (AVFoundation|AVCaptureDevice → NSCameraUsageDescription; CoreLocation → NSLocationWhenInUseUsageDescription; Photos|PHPicker → NSPhotoLibraryUsageDescription; Contacts → NSContactsUsageDescription; EventKit → NSCalendarsWriteOnlyAccessUsageDescription; LocalAuthentication → NSFaceIDUsageDescription).
- `REQUIRED_REASON_APIS: RegExp[]` (`UserDefaults`, `creationDate|modificationDate|contentModificationDateKey`, `systemUptime|boottime`, `volumeAvailableCapacity`).
- `checkManifest(files: ProjectFile[]): StepResult`
- `interface PngHeader { width: number; height: number; colorType: number }`; `checkIcon(header: PngHeader | null, iconPath: string): StepResult`.

- [ ] **Step 1: Failing tests** `manifest.test.ts`: `missing xtool.yml is FAIL`; `bundleID without a dot is FAIL`; `fresh xtool project without Info.plist is NOT_VERIFIED with the defaults reason`; `AVFoundation import without NSCameraUsageDescription is FAIL naming the key`; `infoPath outside the root is honoured`; `Info.plist without CFBundleVersion is WARNING`; `UserDefaults without PrivacyInfo.xcprivacy is WARNING`; `PrivacyInfo.xcprivacy that is not a dict is FAIL`. `icon.test.ts`: `1024 square colorType 2 is PASS`; `colorType 6 (alpha) is FAIL`; `512 is FAIL`; `missing header is FAIL naming the path`.
- [ ] **Step 2:** `npx vitest run src/preflight` — Expected: FAIL (functions missing).
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** `npx vitest run src/preflight` — Expected: PASS.
- [ ] **Step 5: Commit** `git add src/preflight && git commit -m "feat(preflight): manifest and icon checks"`

### Task 3: Build, tests, policy and secrets steps + verdict

**Files:**
- Create: `src/preflight/steps.ts`
- Test: `src/preflight/steps.test.ts`

**Interfaces:**
- `interface RunOutcome { code: number | null; lines: string[]; timedOut: boolean; cancelled: boolean }`
- `buildStep(outcome: RunOutcome): StepResult` (FAIL on non-zero/null code, details = parsed error diagnostics `file:line message` via `parseDiagnostics`, max 20; PASS otherwise with summary `Derleme başarılı`).
- `testsStep(outcome: RunOutcome | { skipped: string }): StepResult` (`NOT_VERIFIED` with the skip reason; FAIL on non-zero with the last 20 lines; PASS otherwise).
- `policyStep(report: EvaluationReport): StepResult` (FAIL when `report.blocksRelease` or any FAIL with severity critical/high; WARNING when any WARNING or non-critical FAIL; PASS otherwise; details list `ruleId name` of FAIL/WARNING rules).
- `secretsStep(report: EvaluationReport, rules: Rule[]): StepResult` (rules whose `category === 'Secrets'`; FAIL/WARNING/PASS by their results; `NOT_VERIFIED` when none ran).
- `verdictOf(steps: StepResult[]): 'green' | 'red'`; `firstFailing(steps): StepResult | null` (in `STEP_ORDER`).

- [ ] **Step 1: Failing tests**: `build with exit 1 and a swift error line is FAIL with the diagnostic`; `tests step is NOT_VERIFIED without a Tests directory` (skipped reason passed through); `tests step FAIL keeps the last lines`; `policy with a critical FAIL is FAIL`; `policy with only warnings is WARNING`; `secrets step uses only category Secrets` (MSEC-014 FAIL → FAIL, unrelated ASR FAIL ignored); `verdict is red when any step fails and green otherwise`; `firstFailing follows STEP_ORDER`.
- [ ] **Step 2:** run — Expected: FAIL.  **Step 3:** implement.  **Step 4:** run — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(preflight): build, tests, policy and secrets steps with verdict"`

### Task 4: Gate and Markdown report

**Files:**
- Create: `src/preflight/gate.ts`, `src/preflight/report.ts`
- Test: `src/preflight/gate.test.ts`, `src/preflight/report.test.ts`

**Interfaces:**
- `gateInstall(report: PreflightReport | null, currentFingerprint: string | null): { allowed: boolean; reason: string | null }` using the three exact reasons; when `currentFingerprint` is `null` (not computed yet) and the report is green, `allowed` is false with the "Dosyalar değişti" reason? No: `null` means unknown → reason `Yayın öncesi denetim çalıştırılmadı` only if report is null; otherwise compare strictly and treat `null` as mismatch.
- `renderMarkdown(report: PreflightReport): string` — title `# Yayın öncesi denetim`, verdict line, a table `Adım | Durum | Özet`, details as bullet lists, the honesty line, and a closing section `## Claude Code için` with the instruction "Kırmızı adımları düzelt, sonra denetimi yeniden çalıştır."

- [ ] **Step 1: Failing tests**: `no report → çalıştırılmadı`; `red report → kırmızı: <step name>`; `fingerprint mismatch → dosyalar değişti`; `green and matching → allowed`; `markdown lists every step and the honesty line`.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5: Commit** `git commit -am "feat(preflight): install gate and markdown report"`

### Task 5: Orchestrator `run.ts`

**Files:**
- Create: `src/preflight/run.ts`, `src/preflight/index.ts`
- Test: `src/preflight/run.test.ts`

**Interfaces:**
- `interface PreflightDeps { project: string; scan(): Promise<{ files: ProjectFile[]; truncated: boolean }>; runOp(op: 'build'|'swift-test', args: { project?: string }, onLine: (text: string) => void): Promise<RunOutcome>; readPng(path: string): Promise<PngHeader | null>; writeFile(path: string, content: string): Promise<void>; analyze(files: ProjectFile[]): EvaluationReport; rules(): Rule[]; now(): string }`
- `runPreflight(deps: PreflightDeps, onProgress?: (id: StepId, state: 'running' | StepResult) => void): Promise<PreflightReport>` — order per `STEP_ORDER`; `tests` skipped when no file path starts with `Tests/`; writes `latest.json` and `latest.md`; the fingerprint is computed from the scan taken **before** the build (so build artifacts under `.build/` do not count: scan already skips build dirs) and the icon header.
- `index.ts` re-exports everything public.

- [ ] **Step 1: Failing tests** with a fake `Deps`: `runs steps in order and reports progress`; `skips swift-test without Tests/`; `writes latest.json and latest.md`; `verdict red when build fails and later steps still run`; `fingerprint ignores the written report` (second run with the report file in the scan returns the same fingerprint).
- [ ] **Step 2–4:** RED → implement → GREEN; then `npx vitest run` — Expected: whole suite green.
- [ ] **Step 5: Commit** `git commit -am "feat(preflight): orchestrator with persisted report"`

### Task 6: Rust: `swift-test` op, `read_png_header`, `PtyOptions.extraContext`

**Files:**
- Modify: `src-tauri/src/xtool.rs` (op `swift-test`, `tool_for_op`), `src-tauri/src/lib.rs` (program resolution per op; new command `read_png_header`), `src-tauri/src/pty.rs` (`extra_context`)
- Create: `src-tauri/src/png.rs`
- Modify: `src/ipc.ts`, `src/xtool/types.ts` (`XtoolOp` gains `'swift-test'`), `src/ai/types.ts` (`extraContext?: string`), `e2e/fakeTauri.ts` (fakes)

**Interfaces:**
- `xtool::program_for_op(op: &str) -> &'static str` → `"swift"` for `swift-test`, else `"xtool"`.
- `build_spec("swift-test", args, program, ws)` → `Spec { program, args: ["test"], cwd: project_dir(args, ws)?, timeout: 20 min }`; `project_dir` already requires `Package.swift`.
- `png::parse_png_header(bytes: &[u8]) -> Result<PngHeader { width: u32, height: u32, color_type: u8 }, String>` (signature + IHDR check); command `read_png_header(state, path) -> Result<Option<PngHeader>, String>` (`None` when the file does not exist; reads ≤ 33 bytes through `Workspace::resolve`).
- `pty::validate_extra_context(&str) -> Result<(), String>`; `command_for` appends `" "` + extra to the context when present.

- [ ] **Step 1: Failing Rust tests**: `swift_test_spec_runs_swift_test_in_the_project_dir`; `program_for_op`; `png_header_parses_ihdr` (hand-built 33-byte buffer 1024×1024 colorType 2), `png_header_rejects_non_png`; `extra_context_is_appended_and_validated` (2001 chars rejected, `\x07` rejected, `"Rapor: x.md"` appended).
- [ ] **Step 2:** `cargo test --manifest-path src-tauri/Cargo.toml` — Expected: compile errors / FAIL.
- [ ] **Step 3:** implement; register `read_png_header` at the end of the handler list.
- [ ] **Step 4:** `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test` — Expected: clean, 117 + 5 passed (or more).
- [ ] **Step 5:** TS: `ipc.readPngHeader(path)`, `XtoolOp` union, `PtyOptions.extraContext`; fakeTauri: `read_png_header` returns `{width:1024,height:1024,colorType:2}`; `xtool_run` fake handles `swift-test` with exit 0 and `build` as today. `npm run typecheck` — Expected: clean.
- [ ] **Step 6: Commit** `git commit -am "feat(preflight): swift-test op, PNG header reader and Claude Code extra context"`

### Task 7: UI: view, sidebar summary, gate wiring, palette, E2E

**Files:**
- Create: `src/components/PreflightView.tsx`, `src/preflight-view.css`
- Modify: `src/App.tsx` (state: `preflight: PreflightReport | null`, `preflightRunning`, `preflightProgress`, `currentFingerprint`; panel kind `'preflight'`; gate in `installCheck`; recompute fingerprint on workspace open, after save, after `new`; load `latest.json` on open; palette entries), `src/components/BuildSidebar.tsx` (summary row + button), `src/components/ActivityBar.tsx` (no new entry: opened from Derle and the palette), `src/xtool/deviceView.ts` (`canRunOnDevice` gains `preflight: { allowed: boolean; reason: string | null }` checked first after `xtoolFound`), `e2e/fakeTauri.ts`, `e2e/environment.spec.ts`
- Test: `src/xtool/deviceView.test.ts` (gate reason precedence), E2E.

- [ ] **Step 1: Failing unit test** in `deviceView.test.ts`: `preflight reason blocks run-on-device before device checks`.
- [ ] **Step 2:** RED → implement `canRunOnDevice` change → GREEN.
- [ ] **Step 3: Failing E2E** in `environment.spec.ts`: `pre-submission check runs, gates install and hands the report to Claude Code`: open workspace → Derle → "Derle ve Yükle" disabled with reason `Yayın öncesi denetim çalıştırılmadı` → run the check from the sidebar button → view shows six steps, verdict green (fakes: build exit 0, swift-test skipped (no Tests/ in fixture) → NOT_VERIFIED, manifest NOT_VERIFIED, icon PASS, policy WARNING) → `apply_file` called twice with the two report paths → "Derle ve Yükle" enabled (device fakes permitting) → edit and save a file → reason `Dosyalar değişti, denetimi yeniden çalıştırın` → button "Raporu Claude Code'a ver" calls `pty_open` with `options.extraContext` containing `latest.md`.
- [ ] **Step 4:** run the E2E — Expected: FAIL (no view yet).
- [ ] **Step 5:** Implement `PreflightView` (steps list with badges, verdict banner, logs collapsed, buttons "Denetimi çalıştır/Yeniden çalıştır", "Raporu Claude Code'a ver", "Kapat", honesty footer), wire App state and the palette entry `Yayın öncesi denetimi çalıştır`, sidebar summary row.
- [ ] **Step 6:** `npm run verify && npx playwright test` — Expected: all green.
- [ ] **Step 7: Commit** `git commit -am "feat(preflight): view, install gate and Claude Code hand-off"`

### Task 8: Docs and push

- [ ] Update `docs/STATUS.md` (new section for the preflight: what is verified by tests, what is NOT VERIFIED: real `swift test`, real build), `CHANGELOG.md` Unreleased, `docs/ENVIRONMENT.md` (short "Yayın öncesi denetim" paragraph), `skills/ios-app-xtool/SKILL.md` (mention the report path).
- [ ] `npm run verify`, `cargo test`, Playwright — Expected: green. Push.
