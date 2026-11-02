# ADR-0013: App Store release pipeline (Linux, no Mac)
Status: accepted (2026-11-02)

## Context
xtool builds a development-signed `.ipa` and installs it on a device. It does not create a distribution certificate or App Store profile, does not upload, and its IPA lacks `Assets.car`, a privacy manifest and a complete icon set. Owners with a paid Apple Developer account but no Mac need a path from source to App Store Connect.

## Decision
A "Yayın" panel drives seven steps: settings, App Store Connect key, release build, repack, certificate + profile, sign, upload. Logic is split into Tauri-free Rust modules so it can be unit-tested without the webview libraries:

- `ipa_pack.rs`: pure-Rust IPA repack (icon set from a 1024 px master, `Info.plist` edits, privacy manifest, profile embedding, extract/zip with zip-slip and symlink refusal).
- `signing.rs`: provisioning-profile parsing, entitlements derived from the profile, argv builders for `openssl` and `rcodesign`, pinned `rcodesign` 0.29.0 URL + SHA-256, download host allow-list.
- `appstore.rs`: App Store Connect API client (ES256 JWT ≤ 10 min, Build Uploads flow). Endpoint and field shapes checked against Apple's OpenAPI 4.5.1.
- `release.rs`: orchestration (certificate re-use, profile re-use by name, signing with cleanup, pinned download).
- `lib.rs`: thin commands only (`asc_*`, `release_*`). `xtool.rs` gains the allow-listed op `build-release-ipa`.
- `src/release/*`: pure TypeScript (config, step state machine, error translation, preflight) and `ReleaseSidebar.tsx`.

External processes: system `openssl` for CSR/`.p12`, `rcodesign` for signing. Both run through the existing shell-less runner (ADR-0006) with argv vectors. `rcodesign` signs a bundle directory (it has no IPA mode in 0.29.0 `--help`), so the IPA is extracted, signed and zipped again.

## Rules
- Never revoke, delete or overwrite anything on Apple's side. Existing certificates/profiles are re-used.
- Private key and `.p12` live in the app data dir (0700); the `.p12` password and the API key live in the OS keyring (ADR-0014). Temporary password files and extracted trees are removed even on failure.
- The JWT is never sent to Apple's presigned upload URLs; upload URLs must be `https`, byte ranges are checked against the file size.
- Honesty: every Apple-dependent step is labelled NOT_VERIFIED until the first real run. A successful build or upload never implies App Store approval.

## Consequences
New dependencies: `zip`, `plist`, `image`, `p256`, `sha2`, `base64`, `flate2`, `tar`. The full crate still needs the Tauri Linux libraries; the new modules were tested in a standalone crate and CI runs the whole suite. `Assets.car` cannot be produced on Linux (RISKS R-15).
