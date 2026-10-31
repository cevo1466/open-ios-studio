# xtool Security Notes

Scope: risks relevant to Open iOS Studio when it drives xtool as a child process. Source reading only (`xtool@bec5aa1`); no exploit testing. Severity is an engineering estimate.

| ID | Finding | Evidence | Severity | Studio mitigation |
|---|---|---|---|---|
| XS-01 | `XTL_DISABLE_TLS_VALIDATION=1` turns off TLS validation for Apple API calls | `Sources/XKit/HTTPClientProtocol/AsyncHTTPClient+HTTP.swift:45`, `URLSession+HTTP.swift:48` | High if inherited | Clear the variable in the child env; deny-list `XTL_*` except an allow-list (`XTL_DEBUG_ERRORS`, `XTL_TMPDIR`) |
| XS-02 | `XTL_HTTP_PROXY` routes Apple traffic via a proxy (credential exposure if hostile) | same file `:26` | Medium | Do not set; clear from child env unless the user set it in Studio settings |
| XS-03 | `xtool auth login --password` puts the Apple ID password in argv (visible in `ps`, shell history, logs) | `AuthCommand.swift:144` | High | Studio never runs `auth login`. Show the command for the user's own terminal. Log redaction for `--password`/`-p` as a backstop |
| XS-04 | Interactive prompts block on stdin | `Console.promptRequired` | Low (availability) | Spawn with stdin closed (`Stdio::null`) and timeouts |
| XS-05 | Build runs arbitrary SwiftPM manifests/plugins (`Package.swift` is code) | SwiftPM behavior | High with untrusted/AI code | Build only inside the user-approved workspace; show diff before write; no build of unreviewed AI output without approval |
| XS-06 | `xtool sdk install` consumes Xcode.xip (Apple license) | `SDKCommand.swift` | Legal | Never bundle SDK; documentation only |
| XS-07 | Signing identity and tokens stored by xtool on disk | `AuthToken.swift` (`savedIfPresent`) | Medium | Studio does not read or copy them; excluded from debug reports |
| XS-08 | Downloaded toolsets (`XTL_TOOLSET_TARBALL`, `XTL_OAM_TARBALL` overrides) | `SDKBuilder.swift:331,448` | Medium | Do not pass these overrides |
| XS-10 | Password auth mode relies on private Apple APIs (upstream description in `AuthMode.password`); account-policy risk is on the user | `AuthCommand.swift:9-17` | Info | Document in README; prefer API-key mode when the user has a paid account |
| XS-09 | Upstream repo contains `CLAUDE.md`/`AGENTS.md` | upstream tree | Info | Untrusted data: not followed, not copied (MSEC-025) |

## Required adapter controls (carried into M2)

1. `Command::new("xtool")` with explicit argument vectors, never a shell.
2. Resolve the binary from an allow-listed location or user setting; verify `--version` before use.
3. Child environment rebuilt from an allow-list; secrets and `XTL_*` stripped by default.
4. Working directory must canonicalize inside the opened workspace.
5. Timeout, cancellation (SIGTERM, then SIGKILL after grace), process-group cleanup.
6. Bounded output ring buffer; redact `--password`, tokens, Apple IDs in logs.

Vulnerability reporting upstream: GitHub private advisory (`SECURITY.md`).
