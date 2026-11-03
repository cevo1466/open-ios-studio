# Launch readiness, slice 2: design

Date: 2026-11-03. Owner decisions recorded from the conversation; everything marked *(my call)* is the designer's choice and may be overridden.

## Intent

Open iOS Studio scored 7.5/10 in the 2026-11-03 review. Four gaps stand between it and "anyone who installs it gets a professional iOS environment": the app cannot prove that a project is ready before it is installed or submitted, Swift editing has no completion or inline errors, the IDE does not behave like VS Code for non-file views, and some maintenance debt makes every release a manual step. A fifth gap, the end-to-end verification on a real iPhone, is the owner's to run; this slice prepares it.

The owner is launching publicly (an influencer campaign). Failure here looks like: a red build or a rejected App Store submission that the app could have caught, or an IDE that feels foreign next to VS Code.

## Goals

1. A **pre-submission check** ("Yayın öncesi denetim") that runs the compile, the host tests, the policy engine, secret and manifest checks, and a verdict; red blocks "Derle ve Yükle", device install/launch and any release step until the check is green for the current files (owner decision). The red report can be handed to Claude Code in one click so the fix loop runs there.
2. **Swift language support** in the editor: completion, hover and inline diagnostics from `sourcekit-lsp`, pointed at the Darwin SDK when one is installed.
3. **VS Code-style tabs and palette**: non-file views open as editor tabs, every panel and action is reachable from the command palette; `App.tsx` is split into modules on the way.
4. **Maintenance**: releases tag themselves when a version bump lands on main; `ai.rs` is split by responsibility; a written verification tour tells the owner exactly what to try and which STATUS lines to flip.

Order of delivery (owner decision): 4 → 1 → 2 → 3, one pull request each.

## Non-goals

- Changing the `--dangerously-skip-permissions` default (owner decision: stays).
- An iOS simulator, live SwiftUI preview or XCUITest. Impossible on Linux; the app keeps saying so.
- App Store upload itself: that is PR #41 (`feature/appstore-release`, unmerged). The gate here must be easy to attach to that panel later (one function), but this slice does not merge or rebase #41.
- A generic LSP framework. One language (Swift), one server (sourcekit-lsp), the four requests the editor needs.

## Anti-goals

- A green verdict that means less than it says. The check reports `NOT_VERIFIED` for anything it could not run; it never turns a skipped step green.
- Any claim of App Store compliance. The footer text of the policy panels stays on the new view.
- Running a shell. Every new child process (`swift test`, `sourcekit-lsp`) goes through the existing argv runner with the allow-listed environment.
- Writing outside the workspace. Reports and the LSP config file go through `Workspace::resolve`.

## Constraints

- Dev container and CI have no Swift toolchain, no xtool, no iPhone. `swift test` and `sourcekit-lsp` integration are verified against fake programs in tests; the real behaviour is `NOT VERIFIED` until the owner runs it (recorded in STATUS and in the verification tour).
- The open PR #52 (`fix/terminal-copy-paste`) touches `terminalInput.ts` and `TerminalPanel.tsx`: this slice does not edit those files.
- PR #41 adds `src/release/`, `ReleaseSidebar.tsx`, `ActivityBar` entries and `lib.rs` commands. To limit conflicts, new Rust commands are appended at the end of the handler list and new modules get their own files.
- Playwright (57 scenarios) is the regression net for the `App.tsx` split; it must stay green at every commit.
- Status vocabularies from `CLAUDE.md` apply to every new status shown to the user.

## Approaches considered

### Pre-submission check
- **A (chosen):** orchestrated in TypeScript, reusing what exists: the xtool `build` op, the policy engine, the workspace scan; one new Rust op (`swift-test`) and one new Rust command (PNG header read). Report written into the workspace.
- B: a single Rust command running every step. Rejected: the policy engine is TypeScript; a second copy would drift.

### Swift language support
- **A (chosen):** Rust spawns `sourcekit-lsp` with stdio pipes and relays JSON-RPC frames over a Tauri channel; a small TypeScript client feeds Monaco's completion/hover providers and markers.
- B: `monaco-languageclient` over a local WebSocket. Rejected: heavy dependency, a listening socket and a looser CSP for one language.

### Tabs and palette
- **A (chosen):** the editor tab model becomes a union of file tabs and view tabs; views render from a registry; the palette lists every panel and action.
- B: keep conditional rendering in the editor region and add palette entries only. Rejected: no VS Code feel, `App.tsx` keeps growing.

### Maintenance
- **A (chosen):** an `auto-tag` workflow on pushes to main that tags the new version and dispatches the existing release workflow; `ai.rs` split into a module directory; a verification tour document.
- B: keep tagging manual (the proxy in cloud sessions cannot push tags, so every release needs the owner at a terminal). Rejected by the owner's experience today.

## Decisions by sub-project

### 4. Maintenance (first PR)

**Auto-tag workflow** `.github/workflows/auto-tag.yml`:
- Trigger: `push` to `main` with `paths: [src-tauri/tauri.conf.json]`.
- Steps: read `version` from `src-tauri/tauri.conf.json`; fail if `package.json` or `src-tauri/Cargo.toml` disagree; if tag `v<version>` already exists, exit 0 with a notice; otherwise create an annotated tag on the pushed commit and push it (`permissions: contents: write`), then start the Release workflow with `gh workflow run release.yml -f tag=v<version>` (`permissions: actions: write`), because tags pushed with `GITHUB_TOKEN` do not fire `on: push: tags`.
- `docs/RELEASING.md` step 5 changes from "owner tags" to "merging the release PR tags"; the owner's approval moves to merging that PR. Release stays a pre-release.

**`ai.rs` split** into `src-tauri/src/ai/`: `mod.rs` (re-exports, unchanged public names), `types.rs`, `endpoints.rs` (URL building, request bodies, Ollama base validation), `stream.rs` (line buffer, SSE/NDJSON parser, error events), `http.rs` (client, `stream_chat`, `list_models`). Tests move with their code; the Rust test count must not drop (115 before the split). No behaviour change; `lib.rs` compiles without edits.

**Verification tour** `docs/VERIFICATION_TOUR.md`: a numbered checklist from "install the DEB" to "App Store hazırlığı on a real project", each item with the exact action, the expected result, and the `docs/STATUS.md` line it verifies. STATUS gets a "Verification tour" table with one row per item, all `NOT VERIFIED` until the owner fills them.

### 1. Pre-submission check ("Yayın öncesi denetim") (second PR)

**Steps, in order, each with status `PASS | FAIL | WARNING | NOT_VERIFIED | BLOCKED`:**
1. `build`: xtool `build` (debug) through the existing op. FAIL on non-zero exit; the parsed diagnostics are attached.
2. `tests`: `swift test` in the project directory through a new allow-listed xtool-adapter op `swift-test` (program `swift` from PATH, args `["test"]`, 20-minute timeout). `NOT_VERIFIED` with reason when the project has no `Tests/` directory or `swift` is missing.
3. `policy`: the policy engine over the scanned workspace (existing `evaluate`). FAIL when any critical rule fails; WARNING when only warnings; the full report is attached.
4. `secrets`: the results of the secret-related rules (MSEC-012, MSEC-013 and any rule whose id the catalog tags `secrets`) shown as their own step so a leaked key is never buried.
5. `manifest`: pure checks on `xtool.yml`, `Info.plist` and `PrivacyInfo.xcprivacy`: bundle id present and reverse-DNS, `CFBundleShortVersionString` and `CFBundleVersion` present, a usage description for every framework the sources import (`AVFoundation`/`AVCaptureDevice` → `NSCameraUsageDescription`, `CoreLocation` → `NSLocation*UsageDescription`, `Photos`/`PHPicker` → `NSPhotoLibraryUsageDescription`, `Contacts`, `EventKit` → calendar, `LocalAuthentication` → `NSFaceIDUsageDescription`), `PrivacyInfo.xcprivacy` present when any `NSPrivacyAccessedAPIType`-requiring API appears (`UserDefaults`, file timestamps, system boot time, disk space). Missing file or key → FAIL with the key name.
6. `icon`: `icon.png` (path from `xtool.yml` `iconPath`, default `icon.png`) exists and is a 1024×1024 PNG without alpha. Needs a Rust command `read_png_header(path) -> {width, height, colorType}` (workspace-confined, reads 33 bytes).

**Verdict:** `green` when no step is FAIL (WARNING and NOT_VERIFIED allowed, listed); `red` otherwise. The verdict is bound to a **fingerprint**: SHA-256 over the sorted `(path, content)` of the scanned text files plus the icon's size. Any later change makes the report `stale`.

**Gate** (`src/preflight/gate.ts`, pure): `gateInstall(report, currentFingerprint) -> { allowed: boolean; reason: string | null }`. `allowed` only when a report exists, `verdict === 'green'` and fingerprints match. Applied to "Derle ve Yükle", `run-device`, `launch`, and exported for the release panel in PR #41. Not applied to `build`, `new`, `sdk-status`, `devices` so the user can keep iterating. Reason strings (Turkish): "Yayın öncesi denetim çalıştırılmadı", "Yayın öncesi denetim kırmızı: <first failing step>", "Dosyalar değişti, denetimi yeniden çalıştırın".

**Persistence:** `.open-ios-studio/preflight/latest.json` (the report) and `latest.md` (human-readable, the text handed to Claude Code) written with the existing workspace-confined write command. On workspace open the JSON is read back; `.open-ios-studio/` joins the explorer's hidden group.

**UI:** a view "Yayın öncesi denetim" in the editor region (a tab once sub-project 2 lands): step list with status badges and expandable logs, the verdict banner, "Denetimi çalıştır / Yeniden çalıştır", "Raporu Claude Code'a ver" (starts the `claude-code` session with the existing fixed context plus one sentence naming `.open-ios-studio/preflight/latest.md` and asking to fix the red steps; implemented as an optional `extraContext` on `PtyOptions`, validated: ≤ 2000 chars, no control characters), and the same honesty footer as the policy panels. The Derle sidebar shows a one-line summary with the verdict and a link to the view. Command palette: "Yayın öncesi denetimi çalıştır".

**Honesty line on the view** *(my call)*: "Yeşil, bu bilgisayarda derleme, testler ve kaynak düzeyi kontroller geçti demektir; App Store onayı anlamına gelmez."

### 2. Tabs, palette and the `App.tsx` split (third PR)

- `Tab` becomes `FileTab | ViewTab`; `ViewTab = { kind: 'view'; id: 'welcome' | 'appstore' | 'security' | 'preflight' | 'updates' }` *(my call: settings stay a dialog)*. `active` is a tab key `file:<path>` or `view:<id>`. View tabs are singletons: opening an open view activates it. Welcome is shown when the tab list is empty (unchanged), never as a tab.
- `EditorPane` renders one tab strip for both kinds; view bodies come from `src/views/registry.tsx` (`id -> component`). Closing a view tab is Ctrl+W like a file; the unsaved-changes guard ignores view tabs.
- Command palette entries (all enabled only when applicable): Dosyalar, Derle, Cihazlar, Yapay zekâ, Terminal, Sohbeti aç/kapat, App Store hazırlığı, Güvenlik merkezi, Yayın öncesi denetim, Yayın öncesi denetimi çalıştır, Ortamı denetle, Güncellemeleri denetle, Claude Code'u projeyle aç, Alt panel: Çıktı / Sorunlar / Terminal / Cihaz günlükleri, Yeniden algıla.
- `App.tsx` split: `src/app/useWorkspace.ts` (open/create/save, tabs), `src/app/useXtoolRuns.ts` (build/device runs, diagnostics, devices), `src/app/useBottomPanel.ts` (tabs, visibility, maximise), `src/app/commands.ts` (palette entries from state), `src/app/AppShell.tsx` (layout). Target: no file over 400 lines. Playwright must stay green after each extraction commit.

### 3. Swift language support (fourth PR)

- Rust `src-tauri/src/lsp.rs`: `lsp_start(root) -> u32` spawns `sourcekit-lsp` (resolved like `swift`: PATH, then the directory of the `swift` binary) with stdio pipes, the allow-listed environment and the workspace as cwd; a reader task parses `Content-Length` frames (max 16 MB per frame, bounded queue) and sends `LspEvent::Message { json }` plus `LspEvent::Exit { code }` on a channel; `lsp_send(id, json)` writes one framed message; `lsp_stop(id)`. One session per workspace; a workspace change stops it. No shell, no network.
- TypeScript `src/lsp/`: `jsonrpc.ts` (ids, pending map, notification routing, pure and unit-tested), `client.ts` (initialize with `rootUri`, `textDocument/didOpen|didChange|didClose` with full sync, 300 ms debounce, `completion`, `hover`, `publishDiagnostics` handler), `monaco.ts` (providers for language `swift`, markers), `diagnostics.ts` (LSP → the existing `Diagnostic` shape with `source: 'lsp'` so the Sorunlar tab shows them next to build errors).
- Config: on workspace open, when `Package.swift` exists and `.sourcekit-lsp/config.json` does not, write `{ "swiftPM": { "swiftSDK": "<id>" } }` using the Darwin SDK id from `swift sdk list` (the doctor already parses it). Without a Darwin SDK no file is written and the status bar says "Swift LSP: Linux hedefi" so iOS-only errors are explained. Existing files are never overwritten.
- Status bar segment: "Swift LSP: çalışıyor / yok / Linux hedefi"; a command palette entry restarts it.
- Tests: Rust spawns `tests/fake_lsp.py` (a 40-line Python JSON-RPC server that answers `initialize`, echoes one completion item and publishes one diagnostic) to test framing, start/stop and bounded buffers; Vitest covers `jsonrpc.ts`, the diagnostic mapping and the config writer. Real sourcekit-lsp: NOT VERIFIED here; the verification tour has an item for it.

## What is left to the builder

- Exact Turkish copy of step names and reasons (keep the vocabulary of the existing panels).
- The hashing helper for the fingerprint (Web Crypto `subtle.digest` in the webview; Node's `webcrypto` in tests).
- Layout details of the tab strip for view tabs (icon, no dirty dot) and the preflight view (follow `policy-panels.css`).
- The list of frameworks → usage-description keys may grow; keep it as a table in `src/preflight/manifest.ts` with a test per row.
- Where the LSP client debounces and cancels in-flight completion requests.

## Risks

- PR #41 rebase cost grows with sub-projects 1 and 2 (shared `App.tsx`, `lib.rs`, `ActivityBar`). Mitigation: the owner merges #41 first if they want; otherwise the gate function and the view registry are designed so #41 only adds an entry.
- WebKitGTK and `subtle.digest`: if unavailable in the webview, fall back to a pure-TS FNV-1a 64-bit fingerprint (same tests).
- `swift test` on an xtool project may fail for reasons unrelated to the app (host toolchain, Linux-only). The step reports the exit code and output; it is still a FAIL by the owner's rule, with the Claude Code hand-off as the fix loop.
