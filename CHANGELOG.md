# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/) (pre-1.0: anything may change).

## [Unreleased]

### Fixed
- Terminal sessions always run in a UTF-8 locale (`C.UTF-8` when the app was started without one), so Claude Code and the shell handle Turkish characters correctly.

## [0.1.8] - 2026-11-01

### Changed
- "Claude Code'u projeyle aç" now starts without permission prompts by default (`--dangerously-skip-permissions`), with a visible checkbox and warning in the AI panel to turn it off and a notice in the terminal header (ADR-0012).

## [0.1.7] - 2026-11-01

### Changed
- The right panel is now labelled "Hızlı sohbet" (suggests files, you approve, runs no commands) and points to Claude Code for the full agent; the Claude Code terminal says it is the full agent, shows the requested model/effort and warns when the settings changed since the session started.

## [0.1.6] - 2026-11-01

### Added
- Optional remote website (SFTP / FTPS / FTP) for "Claude Code'u projeyle aç": the details go to that terminal session only (environment variables, never to disk), and Claude Code studies the live site's structure and responsive design read-only to build the mobile app (ADR-0011).

## [0.1.5] - 2026-11-01

### Added
- Model and effort pickers for the Claude/Codex subscription providers (Sonnet, Opus, Haiku, Düşük … Maksimum), in the chat column and the AI side panel; passed to the CLI as `--model` / `--effort` (Codex: `model_reasoning_effort`).
- "Claude Code'u projeyle aç": an interactive Claude Code session in the embedded terminal, started in the project folder with a fixed Open iOS Studio context (xtool, no Xcode/Simulator, Turkish replies) and the chosen model/effort. Also offered from a plain terminal.
- Four more colour themes (Gece mavisi, Monokai, Dracula, Solarized açık) with matching editor and terminal colours, a swatch picker in Ayarlar and a command-palette entry.
- Files panel: project folder block with path, refresh and collapse-all, folder/file icons, indent guides, captions for Package.swift / xtool.yml / Sources, a "Gizli dosyalar" group for dot-files (.bsp, .git …).

### Fixed
- The AI chat column ignored its configured width (missing CSS) and squeezed the editor area; it now follows the saved width and always leaves the editor at least 320px.

## [0.1.4] - 2026-11-01

### Added
- Resizable side, bottom and AI panels with persisted sizes, a tabbed bottom panel (Çıktı, Sorunlar, Terminal, Cihaz günlükleri) and a status bar.
- Side panel per module (Dosyalar, Derle, Cihazlar, Yapay zekâ); the chat is a separate right panel, closed by default.
- "Derle ve Yükle" primary action, estimated stage list and short success/failure summaries.
- Info card for `.app` packages and binary files with file-manager actions.

### Changed
- File tree hides build artifacts in a collapsed group and pins project files; welcome screen is a four-card guide.

### Known limitations
- WebKitGTK rendering, `xdg-open` on Linux Mint and the stage keywords against real xtool output are not verified on a real desktop.

## [0.1.3] - 2026-11-01

### Fixed
- swift and xtool are found in swiftly and other per-user directories even when the app is launched from the desktop menu (PATH was too narrow); builds pass the same PATH to xtool.

## [0.1.2] - 2026-11-01

### Added
- Subscription providers: Claude (abonelik) and Codex (ChatGPT aboneliği) through the official CLIs, no API key (ADR-0008).
- Embedded terminal with CLI login shortcuts and a user shell (ADR-0009).

### Known limitations
- A real subscription call (Claude/Codex CLI) and the embedded/system terminal on a real Linux desktop are not verified.
- The CLI event formats are parsed from documented JSON events and covered by unit tests only.
- Subscription usage limits apply; CLI cold start is slower than a direct API call.

## [0.1.1] - 2026-11-01

### Added
- Turkish user interface and a guided welcome screen with four status-aware steps.
- Unsaved-changes prompt when the window is closed.
- "Önce plan" button: asks the AI for a short step list before generating files.
- Seven more source-level policy detectors (ASR-005, 008, 009, 016, 023; MSEC-017, 018); 24 of 50 rules now have a partial detector.
- AI connection help (Claude/OpenAI via API key, Ollama local; CLI subscriptions are not API keys).

### Changed
- Build and Devices docks are mutually exclusive; disabled placeholder sections removed.
- GitHub Actions pinned to commit SHAs.
- README install instructions use the real release asset names.

### Known limitations
- Desktop behaviour (window close prompt, keyring) is covered by E2E with a fake Tauri backend only; not verified on a real desktop by the maintainer.
- Rule texts remain English; no Codex CLI integration.

## [0.1.0] - 2026-10-31

First pre-release.

### Added
- M1 editor foundation: Tauri 2 desktop shell, React + TypeScript UI, Monaco editor, file explorer, open/create/save with atomic writes and workspace confinement.
- Policy engine core: App Store and mobile security rule catalogs (ASR-001..024, MSEC-001..026), schema and validation script, applicability evaluation, remediation flow with approvals, readiness and security panels.
- xtool adapter: shell-free runner, version and SDK status checks, project creation, build panel, parsers tested against real xtool 1.24.0 CLI fixtures.
- AI engine: Claude, OpenAI and Ollama providers behind one interface, streaming chat, OS keyring key storage, token-budgeted context, policy-checked proposals with diff review, bounded repair loop.
- Devices panel for device discovery and install/launch flows through xtool.
- End-to-end tests.
- Release workflow: tag-triggered, runs verification, builds DEB and AppImage, writes and verifies SHA256SUMS, publishes a GitHub pre-release.

### Known limitations
- No iOS simulator and no live SwiftUI preview.
- Real iOS builds, signing and device runs are not verified in CI (they need the Apple SDK, an Apple account and a device).
- Desktop launch on a real Linux desktop is not verified.
- Real AI provider calls and the OS keyring on a desktop session are not verified in CI.
- 17 of 50 policy rules have detectors, all partial and source-level. The rest always show `NOT_VERIFIED`. No compliance score is computed, and App Store approval is never guaranteed.
- Packages are not code-signed.
- No Apple SDK is bundled; xtool, a Swift toolchain and an Apple account are required on the user's side.

[Unreleased]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/cevo1466/open-ios-studio/releases/tag/v0.1.0
