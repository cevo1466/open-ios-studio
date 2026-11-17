# Dependency audit assessment — 2026-11-17

The full npm high/critical audit remains enforced with one explicit, expiring development-only assessment. This is not a claim that npm reports zero findings.

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) was updated on 2026-11-17 to cover picomatch through 4.0.7. The registry's latest version is 4.0.7 and the advisory lists no patched release. `npm audit fix --force` suggests downgrading Vite/Vitest; that is not an upstream security fix for this package.

In this repository picomatch is exclusively a development dependency of Vite/Vitest/tinyglobby and lint tooling. These tools receive repository-controlled build/test globs; no application user/workspace input is supplied as a picomatch pattern. They are absent from the installed Studio runtime. This assessment does not cover running development tools against hostile repositories or accepting external glob patterns.

`npm run audit:dependencies` runs the full npm audit and fails on high/critical findings except this exact advisory in **development-only lockfile nodes at picomatch 4.0.7**, including its transitive high-severity reports. It prints the exception as a warning. Any production node, new advisory, critical finding, changed version, missing metadata or audit failure blocks CI. The exception expires automatically on **2026-12-01 UTC**. Reassess or update to an upstream patched release before that date. Existing moderate findings remain reported under the previous high/critical threshold.

The scoped gate is self-tested with production/unknown/critical/expired/cyclic/error cases. No audit check is skipped and no general `continue-on-error`, major dependency downgrade or blanket advisory exclusion is used.
