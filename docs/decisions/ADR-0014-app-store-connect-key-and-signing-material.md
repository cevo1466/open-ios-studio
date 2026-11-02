# ADR-0014: App Store Connect key and signing material
Status: accepted (2026-11-02). Partially supersedes ADR-0005 ("Apple credentials are never handled by Studio").

## Decision
Studio now handles three Apple-related secrets, only for the release pipeline:
1. **App Store Connect API key** (Issuer ID, Key ID, `.p8`): stored in the OS keyring under `asc-issuer-id`, `asc-key-id`, `asc-private-key`. The `.p8` is read from a file chosen in the webview and sent once to Rust; the webview never displays or reads it back. Commands expose only a status (configured, Issuer ID, Key ID).
2. **Distribution private key / `.p12`**: generated locally with `openssl`, bundled into a `.p12` under the app data dir (`signing/<bundle id>/`, directory 0700). The unencrypted key file is deleted right after the `.p12` is built.
3. **`.p12` password**: random, stored in the keyring (`p12-password-<bundle id>`), passed to tools through a 0600 file that is deleted afterwards, never through argv or logs.

Still true from ADR-0005: Apple ID passwords and 2FA codes are never handled; no secrets in settings JSON, `release.json` (the parser rejects secret-looking keys), logs, docs or CI artifacts.

## Consequences
The keyring holds a powerful key (an App Store Connect Admin key can manage the whole team). The panel says so, offers "Anahtarı sil", and the key role should be the least needed (App Manager is enough for uploads; certificate creation needs Admin).
