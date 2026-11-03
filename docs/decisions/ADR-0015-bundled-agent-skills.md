# ADR-0015: Bundled agent skills installed into every project

Status: accepted (2026-11-03). Numbers 0013 and 0014 are used by the App Store release pipeline pull request.

## Context

The owner wants every developer who uses Open iOS Studio to get iOS design guidance in Claude Code without knowing about skills, package managers or `npx skills add`. Skills are Markdown instruction files that Claude Code discovers in `<project>/.claude/skills/<name>/SKILL.md`.

Running `npx skills add ...` from the app would execute code downloaded at run time inside the user's project, which the process-execution rules (ADR-0006) and the untrusted-input policy do not allow without an explicit user action.

## Decision

- The repository carries the skills under `skills/` (one folder per skill). Third-party skills are vendored verbatim with a `SOURCE.md` that records repository, path, commit, SHA-256 and the upstream licence (MIT only so far). Our own `ios-app-xtool` skill describes the xtool workflow, what can and cannot be tested on Linux, and the App Store preparation steps.
- The Rust backend embeds the files at compile time (`src-tauri/src/skills.rs`) and copies them into `<workspace>/.claude/skills/` through the workspace-confined file engine when "Claude Code'u bu projede aç" starts. Files that already exist with different content are kept; a report lists installed, unchanged and kept files.
- The Claude Code system-prompt context names the skills so the agent reads `ios-app-xtool` first and `mobile-ios-design` for UI work.
- More skills come through `find-skills`, which the user triggers inside Claude Code; the app itself never runs `npx`.

## Consequences

- Works offline and in the AppImage/DEB without network access or extra tooling.
- Updating a vendored skill is a reviewed pull request (diff against upstream), not an automatic download.
- Skill text is untrusted third-party input; it is reviewed before vendoring and treated as data by the policy prompt context.
