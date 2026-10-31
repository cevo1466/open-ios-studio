import type { DetectorFinding, Rule, RuleStatus } from './types';

export type RemediationRisk = 'low' | 'medium' | 'high';

export interface ProposedChange {
  path: string;
  before: string | null;
  after: string;
}

export interface RemediationPlan {
  ruleId: string;
  risk: RemediationRisk;
  affectedFiles: string[];
  steps: string[];
  changes: ProposedChange[];
  requiresApproval: boolean;
  forbiddenAutomatic: boolean;
  reason: string;
}

/**
 * Categories that must never be changed automatically. A match sets `forbiddenAutomatic`, which
 * always requires explicit approval, even when the caller passed `preapproved`.
 * Matching is by rule id and by case-insensitive keywords over rule name/category and finding text.
 */
export const FORBIDDEN_AUTOMATIC: {
  ruleIds: ReadonlySet<string>;
  keywords: readonly string[];
} = {
  // ASR-012: external payment compliance (payment configuration); ASR-024: rejection appeal / submission.
  ruleIds: new Set(['ASR-012', 'ASR-024']),
  keywords: [
    'delete user account',
    'delete real user',
    'delete all users',
    'user account deletion',
    'payment configuration',
    'payment config',
    'payment provider',
    'production database',
    'prod database',
    'production db',
    'root auth',
    'root authentication',
    'rotate secret',
    'secret rotation',
    'rotate key',
    'key rotation',
    'rotate api key',
    'revoke key',
    'external service permission',
    'iam permission',
    'oauth scope',
    'production deploy',
    'deploy to production',
    'app store submission',
    'submit to app store',
    'submit for review',
  ],
};

function matchesForbidden(rule: Rule, findings: DetectorFinding[], steps: string[]): boolean {
  if (FORBIDDEN_AUTOMATIC.ruleIds.has(rule.id)) return true;
  const hay = [
    rule.name,
    rule.category,
    ...findings.map((f) => `${f.message} ${f.remediation ?? ''}`),
    ...steps,
  ]
    .join('\n')
    .toLowerCase();
  return FORBIDDEN_AUTOMATIC.keywords.some((k) => hay.includes(k));
}

export function buildPlan(
  rule: Rule,
  findings: DetectorFinding[],
  proposed: ProposedChange[],
): RemediationPlan {
  const steps: string[] = [];
  const hint = rule.remediation;
  if (hint) steps.push(hint);
  for (const f of findings) {
    if (f.remediation && !steps.includes(f.remediation)) steps.push(f.remediation);
  }
  for (const c of proposed) {
    steps.push(c.before === null ? `Create ${c.path}` : `Modify ${c.path}`);
  }
  const forbiddenAutomatic = matchesForbidden(rule, findings, steps);

  let risk: RemediationRisk;
  if (forbiddenAutomatic || rule.autoFix === 'none') risk = 'high';
  else if (rule.autoFix === 'needs-approval' || rule.requiresApproval) risk = 'medium';
  else risk = proposed.length > 5 ? 'medium' : 'low';

  const requiresApproval =
    forbiddenAutomatic || risk !== 'low' || rule.autoFix !== 'safe' || rule.requiresApproval;

  const affectedFiles = [...new Set(proposed.map((c) => c.path))];
  const reason = forbiddenAutomatic
    ? `${rule.id} touches a forbidden-automatic category; explicit approval is always required.`
    : requiresApproval
      ? `${rule.id} (autoFix=${rule.autoFix}, risk=${risk}) requires explicit approval.`
      : `${rule.id} is a low-risk safe fix; may be applied when pre-approved.`;

  return {
    ruleId: rule.id,
    risk,
    affectedFiles,
    steps,
    changes: proposed.map((c) => ({ ...c })),
    requiresApproval,
    forbiddenAutomatic,
    reason,
  };
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

interface Op {
  t: ' ' | '-' | '+';
  s: string;
}

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', s: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ t: '-', s: a[i++]! });
    } else {
      ops.push({ t: '+', s: b[j++]! });
    }
  }
  while (i < n) ops.push({ t: '-', s: a[i++]! });
  while (j < m) ops.push({ t: '+', s: b[j++]! });
  return ops;
}

/** Simple unified diff (3 lines of context). Returns '' when nothing changed. */
export function unifiedDiff(before: string | null, after: string, path: string): string {
  const a = splitLines(before ?? '');
  const b = splitLines(after);
  const ops = diffOps(a, b);
  const changed = ops.map((o, idx) => (o.t === ' ' ? -1 : idx)).filter((x) => x >= 0);
  if (changed.length === 0) return '';
  const CTX = 3;

  // Group changed indices into hunks.
  const ranges: [number, number][] = [];
  for (const idx of changed) {
    const lo = Math.max(0, idx - CTX);
    const hi = Math.min(ops.length - 1, idx + CTX);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }

  // Precompute line numbers at each op index.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let o = 1;
  let nn = 1;
  for (const op of ops) {
    oldAt.push(o);
    newAt.push(nn);
    if (op.t !== '+') o++;
    if (op.t !== '-') nn++;
  }

  const out: string[] = [
    before === null ? '--- /dev/null' : `--- a/${path}`,
    `+++ b/${path}`,
  ];
  for (const [lo, hi] of ranges) {
    const slice = ops.slice(lo, hi + 1);
    const oldCount = slice.filter((x) => x.t !== '+').length;
    const newCount = slice.filter((x) => x.t !== '-').length;
    const oldStart = oldCount === 0 ? oldAt[lo]! - 1 : oldAt[lo]!;
    const newStart = newCount === 0 ? newAt[lo]! - 1 : newAt[lo]!;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const x of slice) out.push(`${x.t}${x.s}`);
  }
  return out.join('\n') + '\n';
}

export type RemediationPhase =
  | 'detect'
  | 'plan'
  | 'diff'
  | 'await_approval'
  | 'apply'
  | 'verify'
  | 'done'
  | 'rejected'
  | 'failed';

export interface RemediationFlowOptions {
  rule: Rule;
  plan: RemediationPlan;
  writeFile: (path: string, content: string) => Promise<void> | void;
  reverify: () => Promise<{ status: RuleStatus }> | { status: RuleStatus };
  preapproved?: { lowRiskSafeFixes?: boolean };
}

export class RemediationFlow {
  private _phase: RemediationPhase = 'detect';
  private approved = false;
  private _error: string | undefined;
  private _diffs: string[] = [];
  private readonly opts: RemediationFlowOptions;

  constructor(opts: RemediationFlowOptions) {
    this.opts = opts;
  }

  get phase(): RemediationPhase {
    return this._phase;
  }
  get error(): string | undefined {
    return this._error;
  }
  get diffs(): readonly string[] {
    return this._diffs;
  }

  /** True when apply() may run without an explicit approve(). */
  get autoApplicable(): boolean {
    const { plan, rule, preapproved } = this.opts;
    return (
      !plan.forbiddenAutomatic &&
      plan.risk === 'low' &&
      rule.autoFix === 'safe' &&
      !rule.requiresApproval &&
      preapproved?.lowRiskSafeFixes === true
    );
  }

  /** detect -> plan -> diff -> await_approval. Returns the unified diffs. Writes nothing. */
  prepare(): string[] {
    if (this._phase !== 'detect') throw new Error(`prepare() not allowed in phase ${this._phase}`);
    this._phase = 'plan';
    this._phase = 'diff';
    this._diffs = this.opts.plan.changes.map((c) => unifiedDiff(c.before, c.after, c.path));
    this._phase = 'await_approval';
    return [...this._diffs];
  }

  approve(): void {
    if (this._phase !== 'await_approval') throw new Error(`approve() not allowed in phase ${this._phase}`);
    this.approved = true;
  }

  reject(): void {
    if (this._phase !== 'await_approval') throw new Error(`reject() not allowed in phase ${this._phase}`);
    this._phase = 'rejected';
  }

  async apply(): Promise<RemediationPhase> {
    if (this._phase !== 'await_approval') throw new Error(`apply() not allowed in phase ${this._phase}`);
    if (!this.approved && !this.autoApplicable) {
      throw new Error('apply() requires explicit approve()');
    }
    this._phase = 'apply';
    try {
      for (const c of this.opts.plan.changes) {
        await this.opts.writeFile(c.path, c.after);
      }
    } catch (e) {
      this._error = `write failed: ${e instanceof Error ? e.message : String(e)}`;
      this._phase = 'failed';
      return this._phase;
    }
    this._phase = 'verify';
    try {
      const { status } = await this.opts.reverify();
      if (status === 'PASS' || status === 'WARNING' || status === 'NOT_APPLICABLE') {
        this._phase = 'done';
      } else {
        this._error = `re-verification returned ${status}`;
        this._phase = 'failed';
      }
    } catch (e) {
      this._error = `re-verification error: ${e instanceof Error ? e.message : String(e)}`;
      this._phase = 'failed';
    }
    return this._phase;
  }
}
