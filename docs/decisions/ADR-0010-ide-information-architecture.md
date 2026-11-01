# ADR-0010: IDE information architecture and file-manager reveal
Status: accepted (2026-11-01)

Context: the first desktop runs showed a cluttered window: build output and binaries in the file tree, `.app` packages opened as garbled text, every tool panel visible at once, a dense AI panel and a build panel that mixed status, actions and logs.

Decision:
- **One module in the side panel.** The activity bar (icon + short label) switches the left panel between Dosyalar, Derle, Cihazlar and Yapay zekâ. Terminal, App Store and Güvenlik act instead of switching.
- **Bottom panel = outputs only**, in one tab system: Çıktı, Sorunlar, Terminal, Cihaz günlükleri. Every tab stays mounted so a terminal session survives switching and hiding. Build + install + launch on a device logs to Cihaz günlükleri; builds, SDK checks and project creation log to Çıktı.
- **Right panel = conversation only** and closed by default. Provider, model, key and CLI login live in the left "Yapay zekâ" view; the chat header shows a read-only chip with the provider and session state.
- **Build artifacts never mix with source.** `.build`, `.swiftpm`, `DerivedData`, `xtool`, `build`, `dist`, `out` and `Pods` at the project root are listed in a collapsed "Build çıktıları" group; hidden noise (`.git`, `.DS_Store`, `node_modules`, ...) is opt-in; project files are pinned first.
- **Binaries never open as text.** `classifyPath` marks `.app`/`.framework`/`.xcarchive` packages (and anything inside them) and known binary/image extensions before any read; `.app` directories behave as one item in the tree. If Rust still reports "not valid UTF-8", the same info card is shown. The card offers: open in the file manager, show the containing folder, show in "Build çıktıları".
- **`reveal_path` (Rust)** resolves the path inside the workspace (`Workspace::resolve`), picks a directory (`reveal_target`) and starts `xdg-open` with that single absolute argument. The environment is inherited on purpose (desktop-session variables are needed); no shell, no user text in the argument vector besides the validated directory.
- **Status bar** shows project, xtool, Swift, device, AI session and error/warning counts; every segment that has a home navigates to it.
- Progress stages (Paketleme, İmzalama, Yükleme, Doğrulama) are derived from log keywords and labelled as an estimate: xtool has no machine-readable progress.

Consequences: `BuildPanel` was split into `BuildSidebar`, `LogView` and `ProblemsList`; `ChatPanel` into `AiSettingsPanel` and a slim `ChatPanel`. The "AI işlem kayıtları" tab is not implemented (no data source yet).
