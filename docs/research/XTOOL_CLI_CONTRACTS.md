# xtool CLI Contracts

Source: `xtool-org/xtool@bec5aa1` (release 1.24.0), `Sources/XToolSupport/*.swift`. Status for every row: **SUPPORTED_BY_SOURCE** (flags read from ArgumentParser declarations). Exact `--help` text is **BLOCKED** (no Swift/xtool on the dev host); it is captured later in CI (issue: M2 fixtures).

## Global

| Item | Contract |
|---|---|
| Binary | `xtool` |
| Version | `xtool --version` prints `xtool <XTool.version>` (from `XTOOL_VERSION` env at build, else git tag/commit). Format of a source build may be `commit <sha>`; parser must accept both semver and commit form. |
| Exit codes | Not documented. Treat `0` = success, non-zero = failure. Cancellation prints `Cancelled.` to stderr. |
| Output | Human text on stdout/stderr, no JSON mode found. |
| Debug env | `XTL_DEBUG_ERRORS` (error details), `XTL_DEBUG_TMP`, `XTL_TMPDIR`, `XTL_HTTP_PROXY` |
| Dangerous env | `XTL_DISABLE_TLS_VALIDATION=1` disables TLS validation. The adapter MUST scrub it from the child environment. |

## Commands used by the adapter

| Command | Arguments / flags (from source) | Interactive? | Adapter use |
|---|---|---|---|
| `xtool --version` | — | no | install check, version detection |
| `xtool sdk status` | — | no | SDK diagnostic |
| `xtool auth status` | — | no | sign-in state (never pass credentials) |
| `xtool new [name]` | `--skip-setup` | **yes** if name missing; runs `setup` unless `--skip-setup` | create project. Name rule: first char `[A-Za-z_]`, rest `[A-Za-z0-9_-]`; fails if path exists |
| `xtool dev build` | `-c/--configuration debug\|release`, `-s/--sign`, `-i/--ipa`, `--triple <t>` | `--sign` needs prior `xtool auth` | build `.app` / `.ipa`. cwd must contain `Package.swift` |
| `xtool dev` | same build options; installs and launches | needs device | build + run on device (M4) |
| `xtool devices` | `--usb \| --network \| --all` (search mode, default all), `--wait` / `--no-wait` (**default `--wait` = blocks until a device appears**) | no, but blocks | device discovery. Adapter MUST pass `--no-wait` and a timeout, or the call hangs when no iPhone is connected |
| `xtool install [path]` | `-u/--udid`, search-mode flag, path argument | no | install ipa/app (M4) |
| `xtool launch <bundleID> [arg...]` | `-u/--udid`, search mode | no | launch app (M4) |
| `xtool uninstall <bundleID>` | `-u/--udid`, search mode | no | M4 |

Not used by the adapter (credential or destructive): `xtool auth login` (`-u`, `-p`, `-m`, password on the command line is a leak risk), `xtool auth logout`, `xtool sdk install/update/remove/build`, `xtool ds *`, `xtool setup`. The UI may show the exact command for the user to run in their own terminal.

## `xtool.yml` (PackSchema v1)

Keys: `version` (must be `1`), `orgID`, `bundleID`, `product`, `infoPath`, `entitlementsPath`, `iconPath`, `resources[]`, `extensions[]` (`product`, `bundleID`, `infoPath`, `resources`, `entitlementsPath`), `skipLSP`. Either `orgID` or `bundleID` forms the bundle id. Unsupported version → error `xtool.yml: Unsupported schema version`.

## Generated project (`xtool new`) — SUPPORTED_BY_SOURCE

Files: `Package.swift` (tools-version 6.0, platforms iOS 17 / macOS 14, **exactly one library product** = app), `xtool.yml` (`version: 1`, `bundleID: com.example.<name>`), `.gitignore`, `Sources/<Module>/<Module>App.swift`, `Sources/<Module>/ContentView.swift`. The Studio project generator must match this layout; no `.xcodeproj` is created.

## Version compatibility policy

1. Detect version at startup; compare against a tested range in `src-tauri` (initially `1.24.x`).
2. Inside the range: all adapter features on. Outside: features still allowed but banner "untested xtool version".
3. A flag is used only if it appears in this document for the detected range; unknown versions fall back to `--version`/`--help` probing.
4. Fixtures (captured CI stdout/stderr per version) back parser unit tests.
