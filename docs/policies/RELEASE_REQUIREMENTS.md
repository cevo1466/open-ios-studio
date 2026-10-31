# Release Requirements

Semantics of the release quality gate (`scripts/policy-gate.mjs`, fed by an `EvaluationReport`).

## Gate semantics

- A verified **FAIL** with severity `critical` blocks the release (`blocksRelease`). Build success is never used to derive this.
- Other FAILs and WARNINGs are reported but do not block by themselves.
- Manual checks (`MANUAL_ONLY`) never pass automatically. They stay `NOT_VERIFIED` until a person confirms them.
- `NOT_VERIFIED` and `BLOCKED` rules are not treated as passing.
- `NOT_APPLICABLE` needs a justification (the rule's `notApplicableReason`, tied to the capability manifest).
- Rule `implementation` is reported honestly: `ENFORCED` only with a detector and tests, otherwise `PARTIAL`, `MANUAL_ONLY` or `NOT_IMPLEMENTED`.

## What CI can verify and what only the user can

| Check | CI-verifiable | User environment |
| --- | --- | --- |
| Source and config static checks (detectors) | yes | |
| Catalog validity (`scripts/validate-policies.mjs`) | yes | |
| Unit tests, build, lint | yes | |
| Apple Developer account state, signing, certificates | | yes |
| Real device behaviour | | yes |
| App Store Connect metadata (descriptions, age rating, privacy answers) | | yes |
| Screenshots matching the real app | | yes |
| URL reachability (privacy policy, support URL) from the user's network | | yes |

## Limits

Approval by Apple is never guaranteed. Passing this gate reduces rejection risk only. Appeals and submissions are never sent without explicit user approval.
