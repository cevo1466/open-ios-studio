# Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Owner status |
|---|---|---|---|---|---|
| R-01 | Tauri bundle only verifiable in CI → slow fix loops | High | Medium | Small PRs, `gh run view --log-failed`, pin runner image | open |
| R-02 | xtool CLI has no stable machine-readable output/exit-code contract | High | High | Version-gated tolerant parsers, CI fixtures, tested-version range | open |
| R-03 | `xtool devices` blocks by default (`--wait`) | Certain | Medium | Always `--no-wait` + timeout | mitigated in design |
| R-13 | xtool upstream is abandoned or removed | Low | High | Single adapter (ADR-0003), pinned tested version range, MIT license allows a fork; a self-owned fallback backend is not planned | open |
| R-04 | Apple SDK/Xcode.xip licensing | Certain | High | Never bundle SDK in artifacts; docs only | mitigated |
| R-05 | AI-generated code may be malicious or non-compiling | High | High | Untrusted-input policy, diff approval, workspace limits, bounded repair loop | open (M3) |
| R-06 | Password auth mode uses private Apple APIs | Medium | Medium | Document; prefer API-key mode | open |
| R-07 | Credential leakage via argv/logs/env | Medium | High | Never run `auth login`; redaction; env allow-list | mitigated in design |
| R-08 | Webview compromise → arbitrary fs/process access | Low | High | Capability-scoped commands, CSP, no generic shell | open (M1) |
| R-09 | Cannot verify desktop launch on Linux here | Certain | Medium | Report NOT VERIFIED; owner smoke test | open |
| R-10 | Policy rules drift from Apple/OWASP sources | High | Medium | `lastVerified`/`policyVersion` per rule, `null` when unverified, diff report | open |
| R-11 | Policy Engine over-claims compliance | Medium | High | Separate enforcement status; no score; manual items stay NOT_VERIFIED | open |
| R-12 | Prompt injection via repo files/logs | Medium | High | Treat as data; privilege limits; tests (MSEC-025/026) | open |
