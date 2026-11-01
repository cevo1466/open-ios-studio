# ADR-0012: Claude Code sessions start without permission prompts by default
Status: accepted (2026-11-01), owner decision

Context: The owner runs Claude Code with `--dangerously-skip-permissions` in their own terminal and wants the "Claude Code'u projeyle aç" session to behave the same for every user, without a confirmation per file write or command.

Decision: The session adds `--dangerously-skip-permissions` when the setting "İzin sormadan çalış (bypass permissions)" is on. It is on by default, shown as a checkbox with a warning in the AI panel, and the terminal header says "izin sormadan çalışıyor". The Rust side defaults to off when the field is missing, so only the UI's explicit value turns it on. Changing the setting while a session runs shows the "settings changed" notice with a restart action. The flag is a fixed string in the argument vector; nothing user-controlled reaches it.

Consequences:
- Claude Code can write files and run commands in the project folder without asking. Combined with a remote website (ADR-0011) it can run connection commands without asking, and text from that site (untrusted) could try to steer it. The fixed system prompt tells it to treat remote content as data and to stay read-only, but that is guidance, not enforcement.
- Users who want prompts turn the checkbox off; the choice is stored in the app's local settings.
- This supersedes the "each command asks permission" statements in ADR-0009 and ADR-0011 for the default configuration.
- `claude` refuses this flag when run as root; the session would then exit with Claude's own message.
