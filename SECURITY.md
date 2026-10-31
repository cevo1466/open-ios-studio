# Security Policy

## Supported versions

Open iOS Studio is pre-1.0 software. Only the latest published release and the `main` branch receive security fixes.

| Version        | Supported |
| -------------- | --------- |
| latest 0.x tag | yes       |
| older 0.x tags | no        |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub private vulnerability reporting:
<https://github.com/cevo1466/open-ios-studio/security/advisories/new>

Include the affected version or commit, steps to reproduce, the impact you expect, and any proof of concept. Do not include real API keys, Apple credentials or private source code in the report. This is a volunteer project: expect an acknowledgement on a best-effort basis, with no guaranteed response time.

## Scope

In scope:

- The desktop application (Rust backend in `src-tauri/`, React frontend in `src/`).
- The release workflow and the packages it publishes.
- The policy engine and the rule catalogs in `policies/`, when a defect causes unsafe behaviour (for example a rule reported as `PASS` without an executed check).

Out of scope:

- Vulnerabilities in upstream projects (xtool, Swift, Tauri, WebKitGTK, Ollama, AI provider APIs). Report those to their maintainers.
- Weaknesses in the projects you build with the IDE.
- Attacks that require an already compromised user account or machine.
- Findings that depend on a modified build of the application.

## What the application protects

- Workspace confinement: file operations are canonicalised and restricted to the opened workspace. Path traversal and symlink escapes are rejected, and writes are atomic.
- Secrets: AI provider API keys are stored in the OS keyring, not in project files, settings or logs.
- No shell: external programs (such as xtool) run as a program plus an argument vector, with an allow-listed environment, closed stdin, timeouts, cancellation and bounded output buffers.
- Approvals: AI-proposed file changes are shown as a diff and are written only after the user approves. Destructive actions need confirmation. The AI cannot delete files.
- Untrusted data: AI output, repository content, logs and web pages are treated as data, never as instructions.

## Non-goals

- The application does not guarantee App Store approval. The policy engine reduces rejection risk and never reports compliance it did not check.
- It is not a replacement for a penetration test, a code audit or Apple's review.
- Source-level policy detectors are partial. Rules that need an Apple account, a device or human judgement stay `NOT_VERIFIED`.
- Release packages are checksummed but not code-signed.
