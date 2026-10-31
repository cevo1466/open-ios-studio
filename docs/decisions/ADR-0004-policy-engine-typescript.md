# ADR-0004: Policy Engine core in TypeScript, rules in JSON
Status: accepted (2026-10-31, owner decision)
Context: AI engine and UI live in the webview; rules must be versioned and machine-readable.
Decision: Rules in policies/*.rules.json (JSON Schema validated); evaluator in src/policy/ (Vitest). Rust only supplies safe file listing/reading.
Consequences: Policy runs in the webview process; file access still goes through fs_engine.
