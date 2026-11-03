# Bundled agent skills

Open iOS Studio copies these skills into `<project>/.claude/skills/` every time "Claude Code'u bu projede aç" starts, so Claude Code finds them in every iOS project without any manual `npx skills add`. Existing files that differ (the user edited or updated them) are kept; the app never overwrites them.

| Skill | Purpose | Origin |
|---|---|---|
| `ios-app-xtool` | How an iOS app is built, tested and prepared for App Store review inside Open iOS Studio (xtool, no Xcode, no simulator, policy checks). | This repository. |
| `mobile-ios-design` | Apple Human Interface Guidelines and SwiftUI layout, navigation, typography, colour and accessibility patterns. | [wshobson/agents](https://github.com/wshobson/agents), MIT, pinned in `SOURCE.md`. |
| `find-skills` | Lets Claude Code search and install further skills from skills.sh (`npx skills find`, `npx skills add`). | [vercel-labs/skills](https://github.com/vercel-labs/skills), MIT, pinned in `SOURCE.md`. |

Rules for this directory:

- The Rust backend embeds every file at compile time (`src-tauri/src/skills.rs`); adding a skill means adding its files here *and* an entry in that module, with a test.
- Vendored files are copied verbatim. Record repository, path, commit and SHA-256 in `SOURCE.md`, and include the upstream licence text. Only permissive licences (MIT, Apache-2.0, BSD) are accepted.
- Skill text is instructions for Claude Code inside the user's project; it is reviewed before vendoring because it is untrusted input from a third party.
- Updating: run `npx skills add <owner/repo> --skill <name>` in a scratch project, diff against the vendored copy, review, then update `SOURCE.md`.
