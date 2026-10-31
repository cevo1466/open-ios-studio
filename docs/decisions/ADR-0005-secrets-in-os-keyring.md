# ADR-0005: Secrets only in the OS keyring
Status: accepted (2026-10-31)
Decision: AI API keys via keyring crate (M3). GitHub auth via existing gh/git credential helpers. Apple credentials are never handled by Studio. No secrets in settings JSON, logs, docs or CI artifacts.
