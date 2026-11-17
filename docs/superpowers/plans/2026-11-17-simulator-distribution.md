# Bundled simulator distribution and Mint desktop verification

The owner requests inclusion in installed Open iOS Studio and prioritizes launching the real Mint desktop app, followed by running Swift from its editor. Implement directly in the existing feature branch on current main; preserve the newer preflight/editor-tab/LSP features.

- [x] Rebase the simulator onto current upstream main and resolve interfaces without dropping existing features.
- [x] Embed runtime/example metadata and headless installed-executable callback check; package source/example/license/guide resources.
- [x] Expose compiler readiness in the panel and add the simulator to the command palette; prepare version 0.2.0 without creating a release tag.
- [x] Make DEB/AppImage CI reject missing runtime resources or a failed compiled Swift callback.
- [x] Build and open the actual desktop executable on Mint. Use temporary extracted development packages if system installation requires a password; keep system packages unchanged.
- [x] Open the Swift example in Monaco and interact with its device in the real window; record screenshots/logs, distinguish desktop observations from browser tests.
- [ ] Run relevant frontend/native/package checks, push the feature branch, open/review a PR and complete authorized integration once checks pass. Do not create a public release without the required approval.

Owner steering: native Windows 11 execution is the next priority after this Linux integration. It requires real Windows compiler/linking, process cleanup and desktop/package checks; current support remains explicitly disabled.
