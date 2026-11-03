# Development environment on Linux

What a developer needs on a Linux PC to build, run and ship an iOS app with Open iOS Studio, how to check it, and what stays impossible without a Mac. The README has the short install list; this page is the reference.

## What is possible on Linux, and what is not

| Task | On Linux with Open iOS Studio | Needs |
|---|---|---|
| Write SwiftUI code with AI help | Yes | Swift toolchain, Claude Code / Codex / API key / Ollama |
| Compile for iOS (`xtool dev build`) | Yes | Swift toolchain + Darwin SDK (built by `xtool setup` from Xcode.xip) |
| Run on a real iPhone (`xtool dev`) | Yes | usbmuxd, USB cable, Developer Mode on the phone, an Apple ID (free works for personal devices, re-signed every 7 days) |
| iOS Simulator, SwiftUI live preview | **No** | macOS only; the app never claims it |
| XCUITest UI tests, Instruments profiling | **No** | Xcode only; logic tests run with `swift test` on the host |
| Static App Store / security checks | Yes | the IDE's App Store hazırlığı and Güvenlik merkezi (source level, no score) |
| Submit to App Store review | Partly | a **paid Apple Developer Program membership** (yearly fee) and App Store Connect; the upload pipeline is being added in a separate pull request and is not verified yet |

A free Apple ID is enough to learn and to test on your own iPhone. Publishing on the App Store always requires the paid program; no tool on Linux or macOS can avoid that.

## Checking the machine

Two ways, same checks, same status vocabulary (`PASS`, `FAIL`, `WARN`, `NOT_VERIFIED`):

1. **In the app:** Derle panel, "Ortam denetimi", button "Ortamı denetle". Every line shows what is missing and the command to fix it.
2. **In a terminal:** from a clone of this repository,

```bash
npm run doctor
```

or directly `bash scripts/doctor.sh`. Exit code 0 means every required check passed; 1 means at least one `FAIL`.

Both run only read-only commands (`--version`, `sdk status`, `auth status`, `devices --no-wait`), never install anything and never ask for Apple credentials. `FAIL` lines block a build (Swift, Darwin SDK, xtool); `WARN` lines concern installing on a device (usbmuxd, Apple account, connected iPhone).

## Install order

1. **Swift toolchain**: <https://swift.org/install/linux>, `swiftly` on Ubuntu/Linux Mint. Put its `bin` directory on `PATH` in `~/.profile` (not only `~/.bashrc`), otherwise an app started from the desktop menu does not see it. Check: `swift --version`.
2. **usbmuxd** and, optionally, **libimobiledevice-utils** for diagnosing USB problems: `sudo apt install usbmuxd libimobiledevice-utils`. Check: `idevice_id -l` lists the connected iPhone.
3. **Xcode.xip**: download with a free Apple ID from <https://developer.apple.com/download/all/?q=Xcode> in a browser. Apple's licence applies; the file is never bundled or redistributed.
4. **xtool**: AppImage from <https://github.com/xtool-org/xtool/releases/latest>, renamed to `xtool`, `chmod +x`, placed on `PATH`. The tested version is `1.24.0` (`fixtures/xtool-1.24.0/`); other versions show `WARN` in the environment check. If the AppImage does not start, install FUSE (`sudo apt install libfuse2`) or set `APPIMAGE_EXTRACT_AND_RUN=1`.
5. **`xtool setup`**: in your own terminal. Logs in to Apple and builds the Darwin SDK from `Xcode.xip`. Check: `swift sdk list` shows `darwin` and `xtool sdk status` is not "Not installed".
6. **iPhone**: USB data cable, unlocked, "Trust this computer", Developer Mode on (Settings > Privacy & Security). Check: `xtool devices --no-wait`.
7. **AI**: `claude` or `codex` CLI logged in with your subscription (the app has an embedded terminal and login buttons), or an API key stored through the app (OS keyring), or a local Ollama.

## Agent skills in every project

When "Claude Code'u bu projede aç" starts, the app copies the bundled skills into `<project>/.claude/skills/`:

- `ios-app-xtool`: how to build, test and prepare for App Store review in this setup.
- `mobile-ios-design`: Apple Human Interface Guidelines and SwiftUI design patterns.
- `find-skills`: lets Claude Code search skills.sh and install more (`npx skills add <owner/repo> --skill <name>`).

Files you edited are never overwritten. See `skills/README.md` for provenance and licences.

## Updating the app

Ayarlar → Güncellemeler → "Güncellemeleri denetle". The app asks the GitHub Releases API of this repository (pre-releases included, drafts skipped), shows the newest version next to the installed one, and offers the DEB or the AppImage (the one matching your install first). The download goes to `$XDG_DOWNLOAD_DIR`, `~/Downloads` or `~`, is hashed while it streams and compared with the release's `SHA256SUMS.txt`; a mismatch deletes the file. A DEB is never installed by the app (that needs root): copy the shown `sudo apt install ./…deb` command. An AppImage can replace the running one in place after a second checksum; restart the app afterwards. Only `https://github.com/cevo1466/open-ios-studio/releases/download/…` URLs are accepted.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Status bar says "xtool yok" although `xtool --version` works in a terminal | PATH differs for desktop-launched apps | add the directory to `PATH` in `~/.profile`, log out and in; "Yeniden algıla" in Derle |
| `xtool devices --no-wait` prints nothing | usbmuxd missing, phone locked, trust dialog not accepted, Developer Mode off | install usbmuxd, unlock, accept the dialog, enable Developer Mode, reconnect |
| Build works, install fails with a signing error | logged out of Apple, or the free profile expired (7 days) | `xtool auth status`, then `xtool setup` / `xtool auth login` in your terminal |
| Turkish characters garbled in the embedded terminal | the session had no UTF-8 locale (fixed in 0.1.9 by forcing `C.UTF-8` when the environment lacks one) | update to 0.1.9 or newer; report the exact keys if it still happens, with `locale` output |
| App window does not open on the desktop | WebKitGTK 4.1 missing or an unsupported distribution | `sudo apt install libwebkit2gtk-4.1-0`; Ubuntu 22.04+/Mint 21+ |

## For contributors

```bash
npm ci
npm run verify          # typecheck, lint, unit tests, build, policy catalogs
npm run e2e             # Playwright against a mocked Tauri IPC
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

The Rust side needs the Tauri Linux libraries listed in `.github/workflows/ci.yml`. CI on `ubuntu-22.04` is the reference build; a change is verified only when CI is green.
