# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/) (pre-1.0: anything may change).

## [Unreleased]

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

[Unreleased]: https://github.com/cevo1466/open-ios-studio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cevo1466/open-ios-studio/releases/tag/v0.1.0
