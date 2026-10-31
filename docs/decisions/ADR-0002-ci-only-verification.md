# ADR-0002: Verify builds and packages in GitHub Actions only
Status: accepted (2026-10-31, owner decision)
Context: Dev host is Alpine/musl without Rust/Swift/xtool; musl artifacts are invalid for Linux Mint (glibc).
Decision: No local toolchain installs. All compile, test and bundle steps run in CI; downloaded artifacts are inspected.
Consequences: Slower feedback; desktop launch stays NOT VERIFIED until the owner runs it on Mint.
