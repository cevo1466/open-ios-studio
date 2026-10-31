# xtool Architecture Analysis

- Upstream: https://github.com/xtool-org/xtool (license: see upstream `LICENSE.md`)
- Reference snapshot: latest release `1.24.0`, `main` HEAD `bec5aa106ac31ce9ae49aaef93dfeabf0a097e35` (committed 2026-10-31)
- Method: direct source reading of a shallow clone kept **outside** this repository (`~/ref/xtool`). No upstream code is copied here.
- Evidence level: **SUPPORTED_BY_SOURCE** unless stated. No dynamic run was possible (see `XTOOL_CAPABILITIES.md`, status `BLOCKED`).

## 1. Source tree

| Path | Role |
|---|---|
| `Sources/xtool` | Executable entry point; calls `XTool.run()` |
| `Sources/XToolSupport` | All CLI subcommands (ArgumentParser) |
| `Sources/XKit` | Core library: Apple Developer Services, signing, device install, connection manager |
| `Sources/PackLib` | SwiftPM project planning and packing (`Planner`, `Packer`, `PackSchema`, `BuildSettings`, `DarwinSDK`, `XcodePacker`) |
| `Sources/DeveloperAPI` | OpenAPI-generated Apple Developer Services client |
| `Sources/XCLIUtils`, `Sources/XUtils` | Console prompts, subprocess, caches, temp dirs |
| `Sources/CXKit` | C shim over OpenSSL |
| `Sources/XcodeProjects` | Xcode project generation (`generate-xcode-project`) |
| `Documentation/xtool.docc` | Official docs (`Installation-Linux.md`, tutorials) |

## 2. Entry point and command tree

`XToolCommand` (`Sources/XToolSupport/XTool.swift`) groups subcommands:

- Configuration: `setup`, `auth` (`login`, `logout`, `status`), `sdk` (`install`, `update`, `remove`, `status`, `build`)
- Development: `new`, `dev` (default run; `build`, `generate-xcode-project`), `ds` (Developer Services: teams, certificates, devices, identifiers, profiles)
- Device: `devices`, `install`, `uninstall`, `launch`

`cancellableMain` wraps every run in a `Task`; `CancellationError` prints `Cancelled.` to stderr and exits. Other errors go to `exit(withError:)`; `XTL_DEBUG_ERRORS` prints `String(reflecting:)` details.

## 3. Module boundaries

`xtool` → `XToolSupport` → (`XKit`, `PackLib`, `XCLIUtils`, `XUtils`). `XKit` and `XToolSupport` are exported as SwiftPM **library products**, but they are Swift-only and Swift 6.2 (`swift-tools-version:6.2`). Rust cannot link them; the supported integration surface is the **CLI process**.

## 4. Data flow: `xtool dev`

1. `PackOperation.run` checks `Package.swift` exists in the current directory (no child-directory support: upstream TODO).
2. `EnsureSDKOperation` verifies the Darwin Swift SDK.
3. Reads `xtool.yml` (`PackSchema`, version 1). If absent: default schema with `com.example` org ID and a printed warning.
4. `Planner.createPlan` → `Packer.pack` builds with SwiftPM (triple default `arm64-apple-ios`) and writes a `.app`.
5. `dev` then signs (`IntegratedInstaller`), installs and launches on the device. `dev build` only builds; flags `--sign`, `--ipa`, `--triple`, `--configuration debug|release`.

## 5. Process and error model

- stdout/stderr are human text via `d.out.print` (a dependency-injected writer). No `--json` or machine-readable mode was found.
- Interactive prompts (`Console.promptRequired`) are used for missing values (package name, Apple ID auth). Callers must supply flags or pre-run setup; otherwise the process blocks on stdin.
- Cancellation is cooperative (task cancellation on signal). Child cleanup behavior is not documented → `REQUIRES_RUNTIME_TEST`.

## 6. Platform-specific

- Linux/WSL: Swift toolchain + `usbmuxd` required; macOS uses its own device stack. `Linux/` and `macOS/` directories hold platform packaging.
- Windows is supported only through WSL (per `Installation-Linux.md`).

## 7. Dependency highlights

swift-argument-parser, swift-openapi-*, swift-crypto/certificates, `xtool-core`, `SwiftyMobileDevice` (libimobiledevice), `swift-rcodesign`, Yams (YAML), swift-subprocess, async-http-client, websocket-kit.

## 8. Consequences for Open iOS Studio

1. Integrate via **CLI adapter** (Rust `std::process::Command`, no shell). Never re-implement signing, provisioning or SDK handling.
2. Treat output as unstructured text; parsers must be tolerant and version-gated (`XTOOL_CLI_CONTRACTS.md`).
3. Interactive prompts must be avoided by flags or surfaced to the user explicitly.
