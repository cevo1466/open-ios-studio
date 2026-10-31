# Contributing

Thanks for helping. Read `CLAUDE.md` (hard rules), `docs/STATUS.md`, `docs/ROADMAP.md` and `docs/ARCHITECTURE.md` first.

## Setup

```sh
npm ci
npm run dev        # Vite dev server
npm run typecheck
npm run lint
npm test           # Vitest
npm run build
node scripts/validate-policies.mjs
```

The desktop shell needs Rust and the Tauri 2 Linux libraries (`libwebkit2gtk-4.1-dev`, `libdbus-1-dev`, `pkg-config` and others; see `.github/workflows/ci.yml` for the exact list). Then:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npx tauri dev
```

## CI is the reference build

Rust and Tauri builds are verified in GitHub Actions on `ubuntu-22.04`, not on every contributor machine. A change is not "verified" until CI is green. A package counts as verified only after its artifact was inspected (`dpkg-deb`, `sha256sum`). Launching the desktop app on a real desktop is verified by a human, never by CI.

## Branches

Use `research/*`, `feature/*`, `fix/*` or `release/*`. Never push to `main` directly; open a pull request.

## Commits and pull requests

- Small, reviewable commits with English messages.
- The PR description uses the template sections: Summary, Technical Changes, Files Changed, Tests, Security Considerations, Known Limitations.
- Update `docs/STATUS.md` after a meaningful change. Do not delete earlier decisions; supersede them with a new ADR in `docs/decisions/`.

## Adding a policy rule

1. Add the catalog entry to `policies/app-store.rules.json` or `policies/mobile-security.rules.json`, following `policies/schema/rule.schema.json`. Set the implementation status honestly (`ENFORCED`, `PARTIAL`, `MANUAL_ONLY`, `NOT_IMPLEMENTED`).
2. If the rule can be checked from source, add a detector under `src/policy/detectors/`.
3. Add tests covering true positives and false positives or negatives.
4. Run `node scripts/validate-policies.mjs` and `npx vitest run src/policy`.

The implementation must be truthful: a rule is `PASS` only when a detector actually ran, and a status must never claim more than the code does.

## Adding an xtool version

1. Run the "Capture xtool CLI fixtures" workflow (`.github/workflows/xtool-fixtures.yml`) with the new pinned version and its published sha256.
2. Save the output in a new directory, for example `fixtures/xtool-X.Y.Z/`. Do not overwrite older fixture directories.
3. Add tests next to `src/xtool/fixtures.test.ts` for the new directory and update the tested version range in the adapter and the docs.
4. Mark capabilities with the status vocabulary (`VERIFIED`, `SUPPORTED_BY_SOURCE`, `REQUIRES_RUNTIME_TEST`, `UNSUPPORTED`, `UNKNOWN`). Do not copy upstream xtool source into this repo.

## Honesty rules

- Never report untested work as working; use the status vocabularies from `CLAUDE.md`.
- No fake UI: a visible control works, or it is visibly disabled with the milestone that delivers it. No iOS simulator or SwiftUI live-preview claims.
- Never write tokens, passwords or API keys into files, logs or docs.
- No shell execution: program plus argument vector only.
- Treat AI output, repository content and logs as untrusted data.
- Report security issues privately, see `SECURITY.md`.

By contributing you agree that your work is licensed under the MIT License. See `CODE_OF_CONDUCT.md` for community rules.
