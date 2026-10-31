# ADR-0007: AI engine design (M3)
Status: accepted (2026-10-31)

Context: the Studio must work with Claude, OpenAI and Ollama, keep API keys out of the webview, and treat model output as untrusted.

Decision:
- **Rust owns network and keys.** `ai.rs` builds the provider requests, parses SSE/NDJSON streams and lists models dynamically (no model ids hard-coded). Keys live in the OS keyring (`secrets.rs`); the webview can only set, delete and ask whether a key exists. Ollama is limited to loopback addresses in M3. Redirects are disabled.
- **Provider-agnostic file protocol.** The model returns complete files in `<<<FILE path="…">>> … <<<END FILE>>>` blocks (no per-provider tool-call format). `parseProposedChanges` validates paths, sizes and file types and rejects traversal, secrets, workflows and generated files.
- **Pipeline:** capability manifest → applicable policy rules + token-budgeted project context (secret files never included, file contents fenced as untrusted) → stream → parse → static policy analysis of the project as it would look after the change → diff review → explicit approval → `apply_file` (workspace-confined, atomic). Critical policy findings and unsaved editor edits block applying.
- **Repair loop:** after a failed build the user can ask for a fix, at most 3 attempts; build output is fenced as untrusted; every attempt goes through the same review. The model cannot run commands or delete files.
- **Persistence:** conversations and settings in localStorage (no secrets, size-capped); project notes are plain text in settings.

Consequences: a streaming request per provider is implemented once in Rust and unit-tested without network (local test server). Real provider calls need the user's key and are not tested in CI.
