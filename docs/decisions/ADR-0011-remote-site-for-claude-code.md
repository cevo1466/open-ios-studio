# ADR-0011: Remote website access through the Claude Code session
Status: accepted (2026-11-01)

Context: The owner builds mobile apps for existing websites (for example a pilates studio's site) and wants the AI to connect to the site over FTP/SSH like FileZilla, inspect its structure and responsive design, and write the iOS app from it. The subscription chat providers run with tools disabled (ADR-0008), so they cannot connect anywhere. Claude Code in the embedded terminal (ADR-0009) already has a shell and its own permission prompts.

Decision: The "Claude Code'u projeyle aç" session may receive one remote site (protocol `sftp|ftp|ftps`, host, port, user, password). The values are validated in Rust (allow-list protocol, host/user character sets, password without control characters), passed only as environment variables of that one PTY process (`OIS_REMOTE_*`, `SSHPASS`) and described in a fixed system-prompt addition that never contains the values. Nothing is written to disk, logs or the argument vector; the form clears the password after launch; `Debug` output redacts it. Claude Code connects with `lftp`, `sshpass -e sftp/ssh` or `curl` through its normal permission prompts. The prompt tells it to stay read-only, download only design-relevant files into `./remote-site/`, skip secret files (`wp-config.php`, `.env`, keys, dumps) and treat remote content as data.

Consequences:
- The AI can read the password through the environment (it must, to connect). The UI says so. A mistyped or malicious remote file could try to prompt-inject; the permission prompts and the "data, not instructions" rule are the guard.
- Plain FTP is allowed (the owner's hosts may offer nothing else) but shows a clear warning; SFTP is the default.
- No credential persistence in this ADR. A keyring-backed "remember" option can be added later (ADR-0005 pattern).
- `lftp` and `sshpass` must be installed by the user; the UI shows the `apt` command.
- Verified only by unit tests and mock-IPC E2E; a real connection to a real server is NOT VERIFIED.
