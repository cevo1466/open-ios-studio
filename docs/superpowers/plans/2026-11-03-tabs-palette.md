# Tabs, palette and App.tsx split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Non-file views (App Store hazırlığı, Güvenlik merkezi, Yayın öncesi denetim) open as editor tabs next to file tabs, every panel and action is reachable from the command palette, and `App.tsx` shrinks into focused modules with no behaviour change.

**Architecture:** The editor store keeps file tabs as they are and adds `views: ViewId[]` + `activeView: ViewId | null`; a view is in front when `activeView` is set, otherwise the active file is. `EditorPane` renders one tab strip for both kinds and shows `viewContent` instead of Monaco when a view is active. Palette entries come from a pure `buildCommands(ctx)` function. The split moves state clusters out of `App.tsx` into hooks under `src/app/`.

**Tech Stack:** React 19, TypeScript, Vitest (store, commands), Playwright (58 scenarios as the regression net).

**Spec:** `docs/superpowers/specs/2026-11-03-launch-readiness-2-design.md`, section "2. Tabs, palette and the `App.tsx` split" (settings/updates stay in the dialog; the "updates" palette entry opens Settings).

## Global Constraints

- `ViewId = 'appstore' | 'security' | 'preflight'`; titles: `App Store Hazırlığı`, `Güvenlik Merkezi`, `Yayın öncesi denetim` (the region names the E2E already uses).
- View tabs are singletons: opening an open view activates it. Closing a view activates the next view (same rule as files) or, when none is left, the active file.
- Welcome screen shows only when there are no file tabs and no view tabs.
- Ctrl+W closes the active tab (view or file; a dirty file still asks). The unsaved-changes guard ignores view tabs.
- Palette entries (exact titles): `Dosyalar`, `Derle`, `Cihazlar`, `Yapay zekâ`, `Terminali aç`, `Sohbeti aç/kapat`, `App Store hazırlığı`, `Güvenlik merkezi`, `Yayın öncesi denetimi aç`, `Yayın öncesi denetimi çalıştır`, `Ortamı denetle`, `Güncellemeleri denetle` (opens Settings), `Claude Code'u projeyle aç`, `Alt panel: Çıktı`, `Alt panel: Sorunlar`, `Alt panel: Terminal`, `Alt panel: Cihaz günlükleri`, `Yeniden algıla`, plus the existing ones.
- No file over 500 lines after the split except `App.tsx`, which must drop below 600 (from 1084).
- Playwright suite must stay green after every task; do not touch `terminalInput.ts`, `TerminalPanel.tsx`, `UpdatesSection.tsx`.

## Review Focus

- Opening a file while a view is in front must show the editor (Task 2 E2E keeps the preflight scenario green).
- Closing the last view with no files open must show the Welcome screen, not an empty editor (Task 1 reducer test + Task 2 E2E).
- Ctrl+W on a view tab must not close a dirty file tab underneath (Task 2 unit test of the key handler helper `tabToClose`).
- A palette entry for a desktop-only action must be disabled in the browser (Task 3 unit test with `desktop: false`).
- After the split, the install gate must still refuse `run-device` from the Devices panel (existing E2E + unit tests; Task 4 runs the full suite).

---

### Task 1: Store: view tabs

**Files:**
- Modify: `src/state/store.ts`
- Test: `src/state/store.test.ts`

**Interfaces:**
- `type ViewId = 'appstore' | 'security' | 'preflight'`; `VIEW_TITLE: Record<ViewId, string>`.
- `EditorState` gains `views: ViewId[]`, `activeView: ViewId | null`.
- Actions: `{ type: 'openView'; id: ViewId }`, `{ type: 'closeView'; id: ViewId }`, `{ type: 'activateView'; id: ViewId }`. Existing `open`/`activate` set `activeView: null`; `workspace` clears views.
- `tabToClose(state): { kind: 'view'; id: ViewId } | { kind: 'file'; path: string } | null` (what Ctrl+W targets).

- [ ] **Step 1: Failing tests**: `openView adds a singleton tab and puts it in front`; `opening a file brings the file in front and keeps the view tab`; `closeView activates the neighbouring view or falls back to the file`; `workspace change clears views`; `tabToClose prefers the active view`.
- [ ] **Step 2:** `npx vitest run src/state` — Expected: FAIL (unknown action types / missing exports).
- [ ] **Step 3:** Implement. **Step 4:** run — Expected: PASS, whole suite green.
- [ ] **Step 5: Commit** `git commit -am "feat(tabs): view tabs in the editor store"`

### Task 2: EditorPane view tabs + App uses the store views

**Files:**
- Modify: `src/components/EditorPane.tsx` (props `views: { id: ViewId; title: string }[]`, `activeView`, `onActivateView`, `onCloseView`, `viewContent: ReactNode`), `src/styles.css` (`.tab.view`), `src/App.tsx` (replace `panel` state with `state.views/activeView`; Welcome condition; Ctrl+W), `e2e/app.spec.ts` + `e2e/environment.spec.ts` (tab assertions)
- Test: E2E only (store covered in Task 1).

- [ ] **Step 1: Failing E2E** in `environment.spec.ts` (`views open as editor tabs`): open App Store hazırlığı → a tab `App Store Hazırlığı` is selected; open a file → the file tab is selected and the editor shows while the view tab stays; click the view tab → view returns; press Ctrl+W → view tab closes, file shows; close the file → Welcome shows.
- [ ] **Step 2:** run that spec — Expected: FAIL (no view tabs).
- [ ] **Step 3:** Implement. **Step 4:** `npx playwright test` — Expected: all green (58 + 1).
- [ ] **Step 5: Commit** `git commit -am "feat(tabs): policy and preflight views open as editor tabs"`

### Task 3: Commands module + palette entries

**Files:**
- Create: `src/app/commands.ts`
- Test: `src/app/commands.test.ts`
- Modify: `src/App.tsx` (use `buildCommands`)

**Interfaces:**
- `interface CommandContext { desktop: boolean; hasWorkspace: boolean; chatOpen: boolean; terminalOpen: boolean; actions: { openFolder; newFile; save; settings; togglePanel; toggleTheme; sidebar(view: SidebarView); terminal(); toggleChat(); openView(id: ViewId); runPreflight(); runDoctor(); claudeCode(); bottom(tab: BottomTabId); redetect() } }`
- `buildCommands(ctx: CommandContext): Command[]` — ids stable (`open`, `new`, `save`, `settings`, `panel`, `theme`, `theme-pick`, `view-files`, `view-build`, `view-devices`, `view-ai`, `terminal`, `chat`, `view-appstore`, `view-security`, `view-preflight`, `preflight-run`, `doctor`, `updates`, `claude-code`, `bottom-output`, `bottom-problems`, `bottom-terminal`, `bottom-devicelog`, `redetect`).

- [ ] **Step 1: Failing tests**: `lists every panel and action by title`; `desktop-only entries are disabled in the browser`; `project entries are disabled without a workspace`; `chat title reflects open state`.
- [ ] **Step 2–4:** RED → implement → GREEN; `npx playwright test e2e/app.spec.ts` (palette test) — Expected: green.
- [ ] **Step 5: Commit** `git commit -am "feat(palette): every panel and action in the command palette"`

### Task 4: Split App.tsx

**Files:**
- Create: `src/app/useXtoolRuns.ts` (xtoolInfo/detect, doctor, build + device reducers, runXtool/collectXtool, devices/auth, installCheck inputs), `src/app/usePreflight.ts` (preflight state, fingerprint, runPreflightNow), `src/app/useBottomPanel.ts` (bottom tabs state, showBottom, toggle, maximise), `src/app/useCloseGuard.ts` (close prompt flow)
- Modify: `src/App.tsx`

- [ ] **Step 1:** Extract one hook at a time, in the order above; after each: `npm run typecheck && npx vitest run && npx playwright test` — Expected: green each time; commit each extraction (`refactor(app): extract <hook>`).
- [ ] **Step 2:** `wc -l src/App.tsx src/app/*.ts` — Expected: App.tsx < 600, hooks ≤ 500.

### Task 5: Docs and push

- [ ] STATUS (tabs/palette/split section; NOT VERIFIED on a real desktop), CHANGELOG Unreleased, ROADMAP M6 step-2 item ☑, `docs/ARCHITECTURE.md` modules line.
- [ ] `npm run verify`, Playwright, `cargo test` (unchanged) — green; push; PR #53 description updated.
