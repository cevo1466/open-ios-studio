import type { DetectorFinding, EvaluationReport, RuleResult, RuleStatus, Severity } from './types';

export const STATUS_ORDER: RuleStatus[] = ['FAIL', 'BLOCKED', 'WARNING', 'NOT_VERIFIED', 'PASS', 'NOT_APPLICABLE'];
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const SECURITY_GROUPS = [
  'Authentication & tokens',
  'API security',
  'Sensitive data exposure',
  'Dependencies & supply chain',
  'AI agent security',
  'Other',
] as const;

const ZERO_COUNTS: Record<RuleStatus, number> = {
  PASS: 0,
  FAIL: 0,
  WARNING: 0,
  NOT_APPLICABLE: 0,
  NOT_VERIFIED: 0,
  BLOCKED: 0,
};

export function countStatuses(results: RuleResult[]): Record<RuleStatus, number> {
  const c = { ...ZERO_COUNTS };
  for (const r of results) c[r.status] += 1;
  return c;
}

/** Keeps only results whose rule id starts with the prefix; counts are recomputed for the subset. */
export function filterByPrefix(report: EvaluationReport, prefix: 'ASR-' | 'MSEC-'): EvaluationReport {
  const results = report.results.filter((r) => r.ruleId.startsWith(prefix));
  return {
    ...report,
    results,
    counts: countStatuses(results),
    blocksRelease: results.some((r) => r.status === 'FAIL' && r.severity === 'critical'),
  };
}

export function groupBySeverity(results: RuleResult[]): Array<{ severity: Severity; results: RuleResult[] }> {
  return SEVERITY_ORDER.map((severity) => ({ severity, results: results.filter((r) => r.severity === severity) })).filter(
    (g) => g.results.length > 0,
  );
}

/** Category chip derived from the rule name (RuleResult carries no category) by keyword. */
export function securityGroup(result: Pick<RuleResult, 'ruleId' | 'name'>): string {
  const t = `${result.ruleId} ${result.name}`.toLowerCase();
  const has = (...k: string[]) => k.some((w) => t.includes(w));
  if (has('agent', 'prompt injection', 'llm', 'mcp', ' ai ', 'ai-')) return 'AI agent security';
  if (has('dependenc', 'supply', 'lockfile', 'package', 'sbom', 'ci ', 'workflow', 'pinned')) return 'Dependencies & supply chain';
  if (has('token', 'auth', 'session', 'password', 'otp', 'jwt', 'oauth', 'login', 'role', 'admin', 'credential')) {
    return 'Authentication & tokens';
  }
  if (has('api', 'endpoint', 'ssrf', 'cors', 'rate', 'webview', 'deep link', 'url', 'tls', 'http')) return 'API security';
  if (has('secret', 'sensitive', 'pii', 'log', 'keychain', 'storage', 'key', 'personal', 'leak', 'exposure', 'data')) {
    return 'Sensitive data exposure';
  }
  return 'Other';
}

export function groupBySecurityCategory(results: RuleResult[]): Array<{ group: string; results: RuleResult[] }> {
  return SECURITY_GROUPS.map((group) => ({ group, results: results.filter((r) => securityGroup(r) === group) })).filter(
    (g) => g.results.length > 0,
  );
}

/** Rules that were not actually verified: NOT_VERIFIED plus BLOCKED. */
export function unverifiedCount(counts: Record<RuleStatus, number>): number {
  return counts.NOT_VERIFIED + counts.BLOCKED;
}

/** Plain-text summary. Deliberately contains no score or percentage. */
export function summaryLine(counts: Record<RuleStatus, number>): string {
  return STATUS_ORDER.map((s) => `${counts[s]} ${s.replace('_', ' ').toLowerCase()}`).join(', ');
}

export function unverifiedLine(counts: Record<RuleStatus, number>): string {
  return `Unverified: ${unverifiedCount(counts)} rules need manual review or are not implemented`;
}

/** Findings sorted by file, then line (no line last), then message. Does not mutate input. */
export function sortFindings(findings: DetectorFinding[]): DetectorFinding[] {
  return [...findings].sort((a, b) => {
    const fa = a.file ?? '￿';
    const fb = b.file ?? '￿';
    if (fa !== fb) return fa < fb ? -1 : 1;
    const la = a.line ?? Number.MAX_SAFE_INTEGER;
    const lb = b.line ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

/** Status-first ordering for display (failures on top). */
export function sortResults(results: RuleResult[]): RuleResult[] {
  return [...results].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.ruleId.localeCompare(b.ruleId),
  );
}
