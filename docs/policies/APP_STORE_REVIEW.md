# App Store Review Policy Catalog

Policy version: 2026.10.0. Machine-readable source: `policies/app-store.rules.json`.

## Purpose

This catalog lists 24 rules (ASR-001 to ASR-024) that help Open iOS Studio projects reduce the risk of App Store rejection. Rules are evaluated by the Policy Engine (`src/policy/`) and surfaced in reports and AI prompt context.

## How rules are applied

- Each rule declares an applicability condition over the Project Capability Manifest (for example `hasUserAccounts` or `usesTracking`). A rule whose condition is not met is reported as NOT_APPLICABLE with a concrete reason.
- Each rule has an honest implementation state: ENFORCED, PARTIAL (a source-level detector exists but cannot decide everything), MANUAL_ONLY (needs App Store Connect, an Apple account, a device, screenshots, URL checks or human judgement) or NOT_IMPLEMENTED.
- Only rules with a detector (detectorId equal to the rule id) are checked automatically. Everything else is reported as NOT_VERIFIED so it is never mistaken for a pass.
- Build success is never treated as App Store compliance.
- Auto-fixes never add Sign in with Apple, external payment links or ATT prompts blindly, never change the age rating, and never send an appeal to Apple without explicit user approval.

## Rules

| ID | Name | Applicability | Severity | Implementation |
|---|---|---|---|---|
| ASR-001 | Application Launch Stability | always | critical | MANUAL_ONLY |
| ASR-002 | Review Demo Account Availability | all: hasUserAccounts | high | MANUAL_ONLY |
| ASR-003 | Demo Account Validation | all: hasUserAccounts | high | MANUAL_ONLY |
| ASR-004 | Feature Discoverability | always | medium | MANUAL_ONLY |
| ASR-005 | Privacy Policy | all: targetsAppStore | high | PARTIAL |
| ASR-006 | Metadata Consistency | all: targetsAppStore | medium | NOT_IMPLEMENTED |
| ASR-007 | Support URL | all: targetsAppStore | medium | MANUAL_ONLY |
| ASR-008 | Subscription Disclosure | all: hasSubscriptions | high | PARTIAL |
| ASR-009 | Terms of Use / EULA | all: hasSubscriptions | medium | PARTIAL |
| ASR-010 | Pricing Transparency | all: hasSubscriptions | high | NOT_IMPLEMENTED |
| ASR-011 | Restore Purchases | any: hasSubscriptions, hasInAppPurchases | high | PARTIAL |
| ASR-012 | External Payment Compliance | all: hasExternalPaymentLinks | high | MANUAL_ONLY |
| ASR-013 | Account Deletion | all: hasUserAccounts | high | PARTIAL |
| ASR-014 | Sign in with Apple | all: hasSocialLogin | high | PARTIAL |
| ASR-015 | Permission Purpose Strings | any: usesCamera, usesMicrophone, usesLocation, usesPhotos | high | PARTIAL |
| ASR-016 | App Tracking Transparency | all: usesTracking | high | PARTIAL |
| ASR-017 | Placeholder Content | always | medium | PARTIAL |
| ASR-018 | Screenshot Accuracy | all: targetsAppStore | medium | MANUAL_ONLY |
| ASR-019 | Branding Consistency | always | low | PARTIAL |
| ASR-020 | Age Rating | all: targetsAppStore | medium | MANUAL_ONLY |
| ASR-021 | Template / Copycat Detection | always | medium | NOT_IMPLEMENTED |
| ASR-022 | Feature Claims Verification | all: targetsAppStore | medium | NOT_IMPLEMENTED |
| ASR-023 | Minimum App Functionality | always | high | PARTIAL |
| ASR-024 | Rejection Analysis & Appeal | all: targetsAppStore | info | NOT_IMPLEMENTED |

Implementation counts: MANUAL_ONLY 9, NOT_IMPLEMENTED 9, PARTIAL 6.

## Limits and verification status

This catalog reduces rejection risk. It never guarantees approval; only Apple decides whether an app is approved, and guidelines change over time.

The rules were not compared with the official Apple sources in the session that wrote them, so `lastVerified` is null for every rule. Guideline numbers in the reference titles are given only where confidence is high, and reference URLs point to the general Apple pages without fragments. Verify against the current official documents before relying on a rule.
