# Backlog (mirrored as GitHub issues)

Priority: P0 blocks the next milestone, P1 needed in milestone, P2 later.

| # | Title | Milestone | Priority | Depends on |
|---|---|---|---|---|
| 1 | M1: Tauri 2 + React + Vite scaffold, lockfiles | M1 | P0 | M0 PR |
| 2 | M1: fs_engine (workspace root, traversal/symlink guard, atomic write) + tests | M1 | P0 | 1 |
| 3 | M1: Explorer, Monaco editor, tabs, open/edit/save, dirty state | M1 | P0 | 2 |
| 4 | M1: Settings, theme, command palette, disabled-feature states | M1 | P1 | 3 |
| 5 | CI: ci.yml + build-linux.yml (DEB, AppImage, SHA256) | M1 | P0 | 1 |
| 6 | Policy Engine core: schema, catalog, manifest, evaluator, first detector slice | Policy | P1 | M1 merge |
| 7 | Policy UI: App Store Readiness + Security Center | Policy | P1 | 6 |
| 8 | M2: Process runner + XtoolCliBackend + fixtures | M2 | P1 | M1 |
| 9 | M3: AI provider interface, keyring, streaming chat | M3 | P2 | M2 |
| 10 | M4: Device manager (`devices --no-wait`), signing, install/launch | M4 | P2 | M2 |
| 11 | M5: release.yml (tag-triggered, owner-approved), README for Linux Mint, SECURITY.md | M5 | P2 | M1 |

Each issue contains: description, acceptance criteria, technical dependencies, test requirements, priority (see GitHub).
