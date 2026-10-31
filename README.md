# Open iOS Studio

Open-source desktop IDE that helps developers **without a Mac** build iOS apps, using [xtool](https://github.com/xtool-org/xtool) as the build backend and (planned) AI assistants for code generation.

> **Status: early foundation (Milestone 1).** What works today: open a folder, browse files, edit with Monaco (Swift highlighting), create files, save atomically, settings, light/dark theme, command palette. Everything else in the UI is visibly disabled and labelled with the milestone that delivers it. There is no iOS simulator and no live SwiftUI preview.

## What is not available yet
| Feature | Planned |
|---|---|
| xtool build / SDK diagnostics | M2 |
| AI chat and code generation (Claude, OpenAI, Ollama) | M3 |
| Device install and launch | M4 |
| App Store Readiness / Security Center (policy engine) | next PR after M1 |

## Install on Linux Mint (x86_64)
Download from the CI run artifacts or, once published, from GitHub Releases (no release exists yet).

DEB:
```bash
sudo apt install ./Open-iOS-Studio_0.1.0_amd64.deb
```
AppImage:
```bash
chmod +x Open-iOS-Studio_0.1.0_amd64.AppImage
./Open-iOS-Studio_0.1.0_amd64.AppImage
```
Verify downloads with `sha256sum -c SHA256SUMS.txt`. The exact file names depend on the packaging output.

Runtime needs WebKitGTK 4.1 (Linux Mint 21+ / Ubuntu 22.04+).

## External requirements (for later milestones)
- **xtool** and a Swift toolchain, `usbmuxd`, and a Darwin SDK built from an Xcode.xip you download from Apple. The SDK is never bundled here.
- An AI provider API key (stored in the OS keyring) or a local Ollama model.
- An Apple ID and an iPhone for on-device runs.

## Develop
```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run tauri dev      # needs Rust and Tauri's Linux libraries
```
CI (GitHub Actions) is the reference build: see `.github/workflows/`.

## Project memory
`CLAUDE.md`, `docs/STATUS.md`, `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, `docs/decisions/`, `docs/research/`.

License: MIT.
