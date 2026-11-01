# Mobile Security Rule Catalog

## Purpose

This catalog (`policies/mobile-security.rules.json`, policy version 2026.10.0) defines 26 security rules, MSEC-001 to MSEC-026, evaluated by the Mobile Engineering Policy Engine. It is based on OWASP MASVS for the mobile app and OWASP ASVS for backend behaviour, plus repository, CI and AI-agent hygiene checks for the platform itself. Each rule is selected by project capabilities and reports an honest implementation state.

## Rules

| ID | Name | Applicability | Severity | Implementation |
|----|------|---------------|----------|----------------|
| MSEC-001 | Object Level Authorization (BOLA/IDOR) | all: hasBackend | high | NOT_IMPLEMENTED |
| MSEC-002 | Mass Assignment Protection | all: hasBackend | high | NOT_IMPLEMENTED |
| MSEC-003 | Token Lifetime (MASVS-AUTH) | all: hasAuthTokens | high | NOT_IMPLEMENTED |
| MSEC-004 | Logout Revocation (MASVS-AUTH) | all: hasAuthTokens | high | NOT_IMPLEMENTED |
| MSEC-005 | Administrative MFA (MASVS-AUTH) | all: hasAdminRoles | high | NOT_IMPLEMENTED |
| MSEC-006 | OTP Rate Limiting | all: hasOtpFlow | high | NOT_IMPLEMENTED |
| MSEC-007 | Geographic Access Controls (product-dependent) | all: hasBackend | info | MANUAL_ONLY |
| MSEC-008 | Account Enumeration Protection | all: hasUserAccounts, hasBackend | medium | NOT_IMPLEMENTED |
| MSEC-009 | Password Reset Security | all: hasPasswordReset | high | NOT_IMPLEMENTED |
| MSEC-010 | Expensive Endpoint Rate Limiting | all: hasBackend, usesAI | medium | NOT_IMPLEMENTED |
| MSEC-011 | SSRF Protection | all: hasUserControlledUrlFetch | high | NOT_IMPLEMENTED |
| MSEC-012 | Secure Storage (MASVS-STORAGE) | any: processesPersonalData, hasAuthTokens | high | PARTIAL |
| MSEC-013 | Firebase App Check | all: usesFirebase | medium | PARTIAL |
| MSEC-014 | Mobile Binary Secret Exposure (MASVS-STORAGE) | always | critical | PARTIAL |
| MSEC-015 | Code Hardening (MASVS-RESILIENCE) | always | info | MANUAL_ONLY |
| MSEC-016 | Secure Token Storage (MASVS-STORAGE) | all: hasAuthTokens | high | PARTIAL |
| MSEC-017 | Backup Data Protection (MASVS-STORAGE) | all: processesPersonalData | medium | PARTIAL |
| MSEC-018 | Deep Link Validation (MASVS-PLATFORM) | all: hasDeepLinks | medium | PARTIAL |
| MSEC-019 | TLS & Certificate Validation (MASVS-NETWORK) | any: usesExternalApis, hasBackend | critical | PARTIAL |
| MSEC-020 | Least Privilege (MASVS-PLATFORM) | always | medium | NOT_IMPLEMENTED |
| MSEC-021 | Environment File Protection | always | high | PARTIAL |
| MSEC-022 | Dependency Management | always | medium | PARTIAL |
| MSEC-023 | Installation Script Security | always | high | PARTIAL |
| MSEC-024 | Fork & Pull Request Secret Protection | all: hasCiWorkflows | high | PARTIAL |
| MSEC-025 | Prompt Injection Defense | always | critical | PARTIAL |
| MSEC-026 | AI Agent Least Privilege | always | high | PARTIAL |

Implementation counts: NOT_IMPLEMENTED 13, MANUAL_ONLY 2, PARTIAL 11.

## Honesty statement

Only rules marked PARTIAL have a source-level detector, and even those can only inspect source files; they cannot prove runtime behaviour. Rules marked MANUAL_ONLY or NOT_IMPLEMENTED have no automated check. Their result is shown as NOT_VERIFIED and is never reported as PASS. A rule is reported NOT_APPLICABLE only when its capability condition is not met, with a concrete reason. Rule applicability for MSEC-007 (geographic controls) is product-dependent and never mandatory.

## Sources

The official references (OWASP MASVS, OWASP ASVS, Apple Security documentation, GitHub Actions security guides) were not verified in this session. Every rule has `lastVerified: null` until a maintainer compares it with the source.
