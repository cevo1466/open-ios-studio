import { isApplicable } from './applicability.js';
import { deriveCapabilities } from './manifest.js';
import type {
  Capabilities,
  Detector,
  DetectorResult,
  EvaluationReport,
  ProjectFile,
  Rule,
  RuleResult,
  RuleStatus,
} from './types.js';

export interface EvaluateOptions {
  rules: Rule[];
  detectors: Detector[];
  files: ProjectFile[];
  capabilities?: Capabilities;
  now?: () => Date;
}

function base(rule: Rule): Omit<RuleResult, 'status'> {
  return {
    ruleId: rule.id,
    name: rule.name,
    severity: rule.severity,
    implementation: rule.implementation,
    findings: [],
    lastVerified: rule.lastVerified,
    policyVersion: rule.policyVersion,
  };
}

export function evaluate(opts: EvaluateOptions): EvaluationReport {
  const capabilities = opts.capabilities ?? deriveCapabilities(opts.files);
  const now = opts.now ?? (() => new Date());
  const detectors = new Map<string, Detector>();
  for (const d of opts.detectors) detectors.set(d.ruleId, d);

  const results: RuleResult[] = [];
  for (const rule of opts.rules) {
    const b = base(rule);
    if (!isApplicable(rule, capabilities)) {
      results.push({ ...b, status: 'NOT_APPLICABLE', reason: rule.notApplicableReason });
      continue;
    }
    if (rule.implementation === 'MANUAL_ONLY') {
      results.push({ ...b, status: 'NOT_VERIFIED', reason: 'Manual review needed: this rule cannot be verified automatically.' });
      continue;
    }
    if (rule.implementation === 'NOT_IMPLEMENTED') {
      results.push({ ...b, status: 'NOT_VERIFIED', reason: 'Not implemented: no automated check exists for this rule yet.' });
      continue;
    }
    const detector = detectors.get(rule.id);
    if (!detector) {
      results.push({ ...b, status: 'NOT_VERIFIED', reason: 'Not implemented: no detector is registered for this rule.' });
      continue;
    }
    let res: DetectorResult;
    try {
      res = detector.run({ files: opts.files, capabilities });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ ...b, status: 'BLOCKED', reason: msg });
      continue;
    }
    const findings = res.findings ?? [];
    switch (res.outcome) {
      case 'pass':
        results.push({ ...b, status: 'PASS', findings });
        break;
      case 'fail':
        results.push({ ...b, status: 'FAIL', findings });
        break;
      case 'warn':
        results.push({ ...b, status: 'WARNING', findings });
        break;
      default:
        results.push({
          ...b,
          status: 'NOT_VERIFIED',
          findings,
          reason: res.note ? `Detector undecided: ${res.note}` : 'Detector undecided: cannot decide from source alone.',
        });
    }
  }

  results.sort((x, y) => (x.ruleId < y.ruleId ? -1 : x.ruleId > y.ruleId ? 1 : 0));
  const counts: Record<RuleStatus, number> = {
    PASS: 0, FAIL: 0, WARNING: 0, NOT_APPLICABLE: 0, NOT_VERIFIED: 0, BLOCKED: 0,
  };
  for (const r of results) counts[r.status]++;
  return {
    generatedAt: now().toISOString(),
    capabilities,
    results,
    counts,
    blocksRelease: results.some((r) => r.status === 'FAIL' && r.severity === 'critical'),
  };
}
