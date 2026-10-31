# ADR-0006: Process execution without a shell
Status: accepted (2026-10-31)
Decision: Single runner: program + args, allow-listed env (strip XTL_*), stdin null, process group, timeout, SIGTERM then SIGKILL, bounded ring buffer, log redaction.
Consequences: All features needing commands go through this runner and an explicit command allow-list.
