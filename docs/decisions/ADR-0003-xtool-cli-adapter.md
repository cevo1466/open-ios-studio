# ADR-0003: Integrate xtool via CLI adapter
Status: accepted (2026-10-31)
Context: XKit is Swift-only (tools-version 6.2); xtool has no JSON output (see research docs).
Decision: Rust BuildBackend port with XtoolCliBackend and MockBackend. No reimplementation, no vendoring.
Consequences: Text parsing, version gating, fixtures required. See XTOOL_INTEGRATION_STRATEGY.md.
