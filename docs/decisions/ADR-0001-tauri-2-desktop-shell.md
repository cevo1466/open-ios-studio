# ADR-0001: Tauri 2 as desktop shell
Status: accepted (2026-10-31)
Context: Linux-first cross-platform IDE, small binaries, Rust backend for process/fs safety.
Decision: Tauri 2 + React/TypeScript/Vite + Monaco.
Consequences: Linux bundling needs webkit2gtk (built on ubuntu runners). Electron rejected: size, weaker default isolation.
