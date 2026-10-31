import { describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_AUTOMATIC, RemediationFlow, buildPlan, unifiedDiff } from './remediation';
import type { Rule, RuleStatus } from './types';

function rule(over: Partial<Rule> = {}): Rule {
  return {
    id: 'MSEC-099',
    name: 'Test rule',
    category: 'test',
    platform: ['ios'],
    applicability: { always: true },
    notApplicableReason: '',
    severity: 'high',
    officialReference: { title: 't', url: 'https://example.com' },
    detectionMethod: '',
    remediation: 'Fix it',
    autoFix: 'safe',
    requiresApproval: false,
    verification: '',
    evidence: '',
    implementation: 'ENFORCED',
    detectorId: 'MSEC-099',
    lastVerified: null,
    policyVersion: '1',
    ...over,
  };
}
const change = [{ path: 'a.swift', before: 'x\n', after: 'y\n' }];

function mk(r: Rule, status: RuleStatus, pre?: boolean, changes = change) {
  const writeFile = vi.fn();
  const reverify = vi.fn(() => ({ status }));
  const plan = buildPlan(r, [], changes);
  const flow = new RemediationFlow({
    rule: r,
    plan,
    writeFile,
    reverify,
    preapproved: pre ? { lowRiskSafeFixes: true } : undefined,
  });
  return { flow, writeFile, reverify, plan };
}

describe('buildPlan', () => {
  it('low-risk safe rule', () => {
    const p = buildPlan(rule(), [], change);
    expect(p.risk).toBe('low');
    expect(p.requiresApproval).toBe(false);
    expect(p.forbiddenAutomatic).toBe(false);
    expect(p.affectedFiles).toEqual(['a.swift']);
  });
  it('needs-approval rule is medium and requires approval', () => {
    const p = buildPlan(rule({ autoFix: 'needs-approval' }), [], change);
    expect(p.risk).toBe('medium');
    expect(p.requiresApproval).toBe(true);
  });
  it('forbidden by rule id and by keyword', () => {
    expect(FORBIDDEN_AUTOMATIC.ruleIds.size).toBeGreaterThan(0);
    const byId = buildPlan(rule({ id: 'ASR-012' }), [], change);
    expect(byId.forbiddenAutomatic).toBe(true);
    expect(byId.risk).toBe('high');
    const byKw = buildPlan(rule(), [{ message: 'Needs secret rotation now', evidence: 'e' }], change);
    expect(byKw.forbiddenAutomatic).toBe(true);
    expect(byKw.requiresApproval).toBe(true);
  });
});

describe('RemediationFlow', () => {
  it('requires approval', async () => {
    const { flow, writeFile } = mk(rule(), 'PASS');
    flow.prepare();
    expect(flow.phase).toBe('await_approval');
    await expect(flow.apply()).rejects.toThrow(/approve/);
    expect(writeFile).not.toHaveBeenCalled();
    flow.approve();
    expect(await flow.apply()).toBe('done');
    expect(writeFile).toHaveBeenCalledWith('a.swift', 'y\n');
  });
  it('preapproved low-risk safe auto-applies', async () => {
    const { flow, writeFile, reverify } = mk(rule(), 'PASS', true);
    flow.prepare();
    expect(await flow.apply()).toBe('done');
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(reverify).toHaveBeenCalledTimes(1);
  });
  it('preapproval does not cover non-safe rules', async () => {
    const { flow } = mk(rule({ autoFix: 'needs-approval' }), 'PASS', true);
    flow.prepare();
    await expect(flow.apply()).rejects.toThrow();
  });
  it('forbidden category ignores preapproval', async () => {
    const { flow, writeFile, plan } = mk(rule({ id: 'ASR-024' }), 'PASS', true);
    expect(plan.forbiddenAutomatic).toBe(true);
    flow.prepare();
    await expect(flow.apply()).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
    flow.approve();
    expect(await flow.apply()).toBe('done');
  });
  it('rejected path writes nothing', async () => {
    const { flow, writeFile } = mk(rule(), 'PASS', true);
    flow.prepare();
    flow.reject();
    expect(flow.phase).toBe('rejected');
    await expect(flow.apply()).rejects.toThrow();
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('fails when reverify still FAIL', async () => {
    const { flow } = mk(rule(), 'FAIL', true);
    flow.prepare();
    expect(await flow.apply()).toBe('failed');
    expect(flow.error).toMatch(/FAIL/);
  });
  it('fails when write throws and does not verify', async () => {
    const r = rule();
    const reverify = vi.fn(() => ({ status: 'PASS' as const }));
    const flow = new RemediationFlow({
      rule: r,
      plan: buildPlan(r, [], change),
      writeFile: () => {
        throw new Error('disk');
      },
      reverify,
    });
    flow.prepare();
    flow.approve();
    expect(await flow.apply()).toBe('failed');
    expect(reverify).not.toHaveBeenCalled();
  });
  it('cannot apply before prepare', async () => {
    const { flow } = mk(rule(), 'PASS', true);
    await expect(flow.apply()).rejects.toThrow();
  });
});

describe('unifiedDiff', () => {
  it('formats a simple change', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', 'f.txt')).toBe(
      '--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n',
    );
  });
  it('new file uses /dev/null', () => {
    expect(unifiedDiff(null, 'x\n', 'n.txt')).toBe(
      '--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+x\n',
    );
  });
  it('identical returns empty', () => {
    expect(unifiedDiff('a\n', 'a\n', 'f')).toBe('');
  });
  it('splits distant changes into hunks', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') + '\n';
    const after = before.replace('l1\n', 'X\n').replace('l18\n', 'Y\n');
    const d = unifiedDiff(before, after, 'f');
    expect(d.match(/^@@/gm)).toHaveLength(2);
  });
});
