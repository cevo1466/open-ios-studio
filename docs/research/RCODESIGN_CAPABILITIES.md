# rcodesign capabilities used by Studio
Pinned: apple-codesign 0.29.0, `x86_64-unknown-linux-musl`, SHA-256 `dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002` (matches the `.sha256` published with the release, checked 2026-11-02).

- `rcodesign sign [OPTIONS] <INPUT_PATH> [OUTPUT_PATH]` with `--p12-file`, `--p12-password-file`, `-e/--entitlements-xml-file`: flag names VERIFIED from `--help`.
- The `--help` text does not mention `.ipa` input, so Studio extracts the IPA, signs the `.app` directory in place and zips it again (design decision, not proven by a run).
- Not verified: a real signature accepted by Apple, behaviour with frameworks/extensions, timestamp server reachability. NOT_VERIFIED until a paid account exists.
- Download policy: only `github.com` and GitHub's release CDN hosts over https; SHA-256 checked before anything is extracted; only the file named `rcodesign` is taken from the archive.
