# Status

Last updated: 2026-10-31

## Current stage
Milestone 0 — research and architecture documents (PR from `research/m0-xtool-architecture`).

## Done
- Repo audited: `cevo1466/open-ios-studio` was empty (LICENSE MIT + README).
- xtool analyzed from source: 1.24.0 / `bec5aa106ac31ce9ae49aaef93dfeabf0a097e35`.
- Reverse-engineering skill `reverse-engineer-and-rebuild` confirmed installed on the dev host (not needed for source-level analysis).
- Research docs, architecture, roadmap, risks, ADRs, CLAUDE.md written.

## Test status
No code yet. Dynamic xtool analysis: **BLOCKED** (dev host has no Swift/xtool/device/Apple ID).

## Open PRs
See repository PR list (M0 docs PR).

## Next
1. Owner reviews M0 PR.
2. M1 skeleton on `feature/m1-desktop-foundation`, verified only through GitHub Actions.
3. Policy Engine core PR afterwards.

## Needs owner decision / external
- Apple ID, iPhone, Xcode.xip for real xtool tests (M2/M4).
- Release tags / public release: explicit approval required.
- Confirm DEB/AppImage launch on Linux Mint after M1 artifacts exist.
