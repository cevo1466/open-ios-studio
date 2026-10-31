/**
 * Shared contract of the Mobile Engineering Policy Engine.
 * Rule catalogs (policies/*.rules.json) conform to `Rule`. Do not change this file without
 * updating policies/schema/rule.schema.json and every consumer.
 */

export type RuleStatus = 'PASS' | 'FAIL' | 'WARNING' | 'NOT_APPLICABLE' | 'NOT_VERIFIED' | 'BLOCKED';
export type Implementation = 'ENFORCED' | 'PARTIAL' | 'MANUAL_ONLY' | 'NOT_IMPLEMENTED';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Platform = 'ios' | 'android' | 'backend' | 'repo' | 'ai-agent';

/** Project Capability Manifest: facts derived from the project, used to pick applicable rules. */
export interface Capabilities {
  targetsAppStore: boolean;
  hasUserAccounts: boolean;
  hasSocialLogin: boolean;
  socialProviders: string[];
  hasSignInWithApple: boolean;
  hasSubscriptions: boolean;
  hasInAppPurchases: boolean;
  usesFirebase: boolean;
  hasBackend: boolean;
  usesExternalApis: boolean;
  processesPersonalData: boolean;
  usesCamera: boolean;
  usesMicrophone: boolean;
  usesLocation: boolean;
  usesPhotos: boolean;
  usesTracking: boolean;
  usesWebView: boolean;
  usesAI: boolean;
  hasAuthTokens: boolean;
  hasDeepLinks: boolean;
  hasExternalPaymentLinks: boolean;
  hasOtpFlow: boolean;
  hasPasswordReset: boolean;
  hasAdminRoles: boolean;
  hasUserControlledUrlFetch: boolean;
  hasCiWorkflows: boolean;
}
export type CapabilityKey = Exclude<keyof Capabilities, 'socialProviders'>;

export type Applicability =
  | { always: true }
  | { all?: CapabilityKey[]; any?: CapabilityKey[]; none?: CapabilityKey[] };

export interface Rule {
  id: string; // ASR-001 .. ASR-024, MSEC-001 .. MSEC-026
  name: string;
  category: string;
  platform: Platform[];
  applicability: Applicability;
  /** Human-readable reason shown when the rule is NOT_APPLICABLE. */
  notApplicableReason: string;
  severity: Severity;
  officialReference: { title: string; url: string };
  detectionMethod: string;
  remediation: string;
  autoFix: 'none' | 'safe' | 'needs-approval';
  requiresApproval: boolean;
  verification: string;
  evidence: string; // what evidence the check records
  /** Real implementation state. Never claim ENFORCED without a detector and tests. */
  implementation: Implementation;
  /** Id of the detector in the registry (equals rule id) when implementation is ENFORCED/PARTIAL. */
  detectorId: string | null;
  /** ISO date the reference was last compared with the official source, or null when not verified. */
  lastVerified: string | null;
  policyVersion: string;
}

export interface RuleCatalog {
  catalog: 'app-store' | 'mobile-security';
  policyVersion: string;
  rules: Rule[];
}

export interface ProjectFile {
  /** Workspace-relative path, `/` separators. */
  path: string;
  content: string;
}

export interface DetectorContext {
  files: ProjectFile[];
  capabilities: Capabilities;
}

export interface DetectorFinding {
  file?: string;
  line?: number; // 1-based
  message: string;
  /** The offending snippet or fact that proves the finding. */
  evidence: string;
  remediation?: string;
}

export interface DetectorResult {
  /** `not_verified`: the detector cannot decide from source alone. */
  outcome: 'pass' | 'fail' | 'warn' | 'not_verified';
  findings: DetectorFinding[];
  note?: string;
}

export interface Detector {
  ruleId: string;
  run(ctx: DetectorContext): DetectorResult;
}

export interface RuleResult {
  ruleId: string;
  name: string;
  status: RuleStatus;
  severity: Severity;
  implementation: Implementation;
  /** Why NOT_APPLICABLE / NOT_VERIFIED / BLOCKED. */
  reason?: string;
  findings: DetectorFinding[];
  lastVerified: string | null;
  policyVersion: string;
}

export interface EvaluationReport {
  generatedAt: string;
  capabilities: Capabilities;
  results: RuleResult[];
  counts: Record<RuleStatus, number>;
  /** True when at least one FAIL has severity `critical`. Never derived from build success. */
  blocksRelease: boolean;
}
