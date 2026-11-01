# Open iOS Studio

Open-source desktop IDE that helps developers **without a Mac** build iOS apps, using [xtool](https://github.com/xtool-org/xtool) as the build backend and (planned) AI assistants for code generation.

> **Status: pre-release (0.1.x).** Working today: open a folder, browse and edit files (Monaco), embedded terminal, build/run through xtool, device list, AI chat with Claude/Codex subscriptions (official CLIs) or API keys/Ollama, policy checks. **Not verified yet:** a complete real build and install on an iPhone, and the desktop UI on every Linux distro. There is no iOS simulator and no live SwiftUI preview.

## Install on Linux Mint (x86_64)
Download the files from the latest [GitHub Release](https://github.com/cevo1466/open-ios-studio/releases) (pre-release). In the terminal, first go to the folder you downloaded them to (usually `~/Downloads`); `apt` reports "unsupported file" when the path is wrong.

DEB:
```bash
cd ~/Downloads
sudo apt install ./Open-iOS-Studio_0.1.5_amd64.deb
```
AppImage:
```bash
cd ~/Downloads
chmod +x Open-iOS-Studio_0.1.5_amd64.AppImage
./Open-iOS-Studio_0.1.5_amd64.AppImage
```
Verify downloads with `sha256sum -c --ignore-missing SHA256SUMS.txt`. Release asset names use hyphens (GitHub replaces spaces).

Runtime needs WebKitGTK 4.1 (Linux Mint 21+ / Ubuntu 22.04+).

## What you must install first
Open iOS Studio only drives the real tools; it bundles none of them. Check each step before the next. The versions below follow the xtool installation guide at the time of writing; the [guide](https://github.com/xtool-org/xtool) is the source of truth.

1. **Swift toolchain** from <https://swift.org/install/linux> (on Ubuntu/Mint, `swiftly` works). Check: `swift --version`.
2. **usbmuxd** (talks to the iPhone): `sudo apt install usbmuxd`. Check: `usbmuxd --help`. Optional: `sudo apt install libimobiledevice-utils`.
3. **Xcode.xip** from <https://developer.apple.com/download/all/?q=Xcode>. Needs a free Apple ID, must be downloaded in a browser. Apple's license applies; it is never bundled here.
4. **xtool**: download the AppImage from the [xtool releases](https://github.com/xtool-org/xtool/releases/latest), rename to `xtool`, `chmod +x`, move it to a folder in your `PATH` (for example `/usr/local/bin`). Check: `xtool --help`.
5. **`xtool setup`**: log in (a paid developer API key, or any Apple ID with password; a throwaway Apple ID is advisable) and give it the path to `Xcode.xip`. It builds the Darwin SDK. Check: `swift sdk list` shows `darwin`.
6. **An iPhone** connected by USB, unlocked and trusting the computer. Developer Mode must be on (iOS 16+).
7. **AI (optional):** the `claude` and/or `codex` command-line tools, logged in with your subscription (the app has an embedded terminal and login buttons), or an API key, or a local Ollama model.

The app's status bar and *Derle* panel show which of these are missing.

## If xtool disappears
Open iOS Studio depends on xtool (MIT-licensed, community project) for signing, packaging and device install. The app talks to it only through one adapter (ADR-0003), and it does not copy xtool code. If upstream stops, the already installed binary and this repository keep working; only new iOS/Xcode changes would break builds over time. The code is MIT, so a fork of xtool could be used instead. See `docs/RISKS.md` (R-13).

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
