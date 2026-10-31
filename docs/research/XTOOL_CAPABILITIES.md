# xtool Capability Matrix

Snapshot: `xtool-org/xtool@bec5aa106ac31ce9ae49aaef93dfeabf0a097e35` (1.24.0). Date of analysis: 2026-10-31.

Status classes: `VERIFIED` (observed at runtime), `SUPPORTED_BY_SOURCE`, `REQUIRES_RUNTIME_TEST`, `UNSUPPORTED`, `UNKNOWN`.
Confidence: H = declaration and implementation read; M = declaration read only; L = inferred.

**Runtime status of this analysis: no capability is `VERIFIED`.** The dev host (Alpine/musl) has no Swift toolchain, no xtool, no iOS device, no Apple ID. Dynamic checks are `BLOCKED` and move to CI/user machines.

| Capability | Status | Source (file → symbol) | Depends on | Conf. |
|---|---|---|---|---|
| Version output | SUPPORTED_BY_SOURCE | `XTool.swift` → `configuration.version`; `XTool+Version.swift` | — | H |
| SwiftPM project creation | SUPPORTED_BY_SOURCE | `NewCommand.swift` → `NewCommand.run` | `setup` unless `--skip-setup` | H |
| Darwin SDK status/install/update/remove | SUPPORTED_BY_SOURCE | `SDKCommand.swift` → `DevSDKStatusCommand` etc. | Xcode.xip (user-supplied, Apple license) | H |
| Darwin SDK build from Xcode.xip | SUPPORTED_BY_SOURCE | `SDKBuilder.swift` | Xcode.xip/app, disk space | M |
| Build iOS app without Xcode | SUPPORTED_BY_SOURCE | `DevCommand.swift` → `PackOperation`, `DevBuildCommand`; `PackLib/Planner.swift`, `Packer.swift` | Swift 6.x toolchain, Darwin SDK | H |
| Debug/release configuration | SUPPORTED_BY_SOURCE | `BuildSettings.swift` → `BuildConfiguration` | — | H |
| Output `.ipa` | SUPPORTED_BY_SOURCE | `DevBuildCommand --ipa` | — | H |
| Code signing | SUPPORTED_BY_SOURCE | `DevBuildCommand --sign` → `IntegratedInstaller.signInPlace`; `swift-rcodesign` | `xtool auth` login (Apple ID) | H |
| Apple Developer Services (teams, certs, devices, identifiers, profiles) | SUPPORTED_BY_SOURCE | `DSCommands/*`, `DeveloperAPI` | Apple ID auth | M |
| Auth modes | SUPPORTED_BY_SOURCE | `AuthCommand.swift` → `AuthMode`: `key` (API key, requires paid Apple Developer Program) and `password` (any Apple ID, **uses private Apple APIs** per upstream description) | Apple account | H |
| Device discovery USB/network | SUPPORTED_BY_SOURCE | `DevicesCommand.swift`, `ConnectionManager.swift` → `SearchMode` | `usbmuxd` (Linux), real device | H |
| Install ipa to device | SUPPORTED_BY_SOURCE | `InstallCommand.swift` | device, signing | H |
| Launch app | SUPPORTED_BY_SOURCE | `LaunchCommand.swift` → `DebugserverClient` | device in developer mode | M |
| Uninstall app | SUPPORTED_BY_SOURCE | `UninstallCommand.swift` | device | H |
| Generate Xcode project | SUPPORTED_BY_SOURCE | `DevXcodeCommand`, `XcodePacker.swift` | macOS use case; not needed by Studio | M |
| SourceKit-LSP config | SUPPORTED_BY_SOURCE | `LSPConfig.swift` → `tryEnsure`; `xtool.yml: skipLSP` | — | M |
| App extensions | SUPPORTED_BY_SOURCE | `PackSchema.Extension`; `Documentation/xtool.docc/Appex.md` | — | M |
| Machine-readable (JSON) output | UNSUPPORTED (none found) | grep of `Sources/` for `--json`/`json` flags | — | M |
| Non-interactive credentials | UNKNOWN | `AuthLoginCommand` has `--password`; stdin/keychain behavior not read in depth | — | L |
| Build cancellation (SIGINT/SIGTERM) | REQUIRES_RUNTIME_TEST | `cancellableMain` | child `swift build` cleanup | L |
| iOS Simulator | UNSUPPORTED | no simulator code in tree | — | M |
| Windows native | UNSUPPORTED (WSL only) | `Installation-Linux.md` | WSL | H |
| Stable exit-code contract | UNKNOWN | not documented | — | L |

## Runtime test backlog (all `BLOCKED` here)

| Test | Needs | Where it can run |
|---|---|---|
| `xtool --version`, `--help`, each `<cmd> --help` fixtures | Swift 6.x + xtool binary | CI (Ubuntu) |
| `xtool new` + `xtool dev build` | Darwin SDK (Xcode.xip) | **User machine only** (license; SDK must not be in CI artifacts) |
| Signing, install, launch | Apple ID + iPhone + usbmuxd | User machine |
| Cancellation/cleanup | Swift + SDK | User machine |
