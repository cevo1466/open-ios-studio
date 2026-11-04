import { describe, expect, it } from 'vitest';
import type { EvaluationReport, Rule, RuleResult } from '../policy/types';
import { buildStep, firstFailing, policyStep, secretsStep, testsStep, verdictOf, type RunOutcome } from './steps';
import type { StepResult } from './types';

const ok: RunOutcome = { code: 0, lines: ['Build complete'], timedOut: false, cancelled: false };

function result(ruleId: string, status: RuleResult['status'], severity: RuleResult['severity'] = 'medium'): RuleResult {
  return { ruleId, name: `Rule ${ruleId}`, status, severity, implementation: 'PARTIAL', findings: [], lastVerified: null, policyVersion: '1' };
}

function report(results: RuleResult[]): EvaluationReport {
  const counts = { PASS: 0, FAIL: 0, WARNING: 0, NOT_APPLICABLE: 0, NOT_VERIFIED: 0, BLOCKED: 0 };
  for (const r of results) counts[r.status]++;
  return {
    generatedAt: '2026-11-03T00:00:00Z',
    capabilities: {} as EvaluationReport['capabilities'],
    results,
    counts,
    blocksRelease: results.some((r) => r.status === 'FAIL' && r.severity === 'critical'),
  };
}

const rules = [
  { id: 'MSEC-014', category: 'Secrets' },
  { id: 'MSEC-021', category: 'Secrets' },
  { id: 'ASR-005', category: 'Privacy' },
] as unknown as Rule[];

describe('buildStep', () => {
  it('build with exit 1 and a swift error line is FAIL with the diagnostic', () => {
    const r = buildStep({ code: 1, lines: ['/w/Sources/App/A.swift:3:5: error: cannot find foo in scope', 'error: fatalError'], timedOut: false, cancelled: false });
    expect(r.status).toBe('FAIL');
    expect(r.details.some((d) => d.includes('A.swift:3') && d.includes('cannot find foo'))).toBe(true);
  });
  it('exit 0 is PASS', () => {
    expect(buildStep(ok)).toMatchObject({ id: 'build', status: 'PASS', summary: 'Derleme başarılı' });
  });
  it('timeout is FAIL and says so', () => {
    expect(buildStep({ ...ok, code: null, timedOut: true }).details.join(' ')).toMatch(/zaman aşımı/);
  });
});

describe('testsStep', () => {
  it('tests step is NOT_VERIFIED without a Tests directory', () => {
    const r = testsStep({ skipped: 'Projede Tests/ klasörü yok' });
    expect(r.status).toBe('NOT_VERIFIED');
    expect(r.summary).toContain('Tests/');
  });
  it('tests step FAIL keeps the last lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const r = testsStep({ code: 1, lines, timedOut: false, cancelled: false });
    expect(r.status).toBe('FAIL');
    expect(r.details).toHaveLength(20);
    expect(r.details[19]).toBe('line 29');
  });
  it('exit 0 is PASS', () => {
    expect(testsStep(ok).status).toBe('PASS');
  });
});

describe('policyStep', () => {
  it('policy with a critical FAIL is FAIL', () => {
    const r = policyStep(report([result('MSEC-014', 'FAIL', 'critical'), result('ASR-005', 'PASS')]));
    expect(r.status).toBe('FAIL');
    expect(r.details.join(' ')).toContain('MSEC-014');
  });
  it('policy with only warnings is WARNING', () => {
    expect(policyStep(report([result('ASR-005', 'WARNING'), result('ASR-008', 'NOT_VERIFIED')])).status).toBe('WARNING');
  });
  it('policy with passes and unverified rules is PASS and counts them', () => {
    const r = policyStep(report([result('ASR-005', 'PASS'), result('ASR-001', 'NOT_VERIFIED')]));
    expect(r.status).toBe('PASS');
    expect(r.summary).toContain('1 doğrulanamadı');
  });
});

describe('secretsStep', () => {
  it('secrets step uses only category Secrets', () => {
    const rep = report([result('MSEC-014', 'FAIL', 'critical'), result('ASR-005', 'FAIL', 'high')]);
    const r = secretsStep(rep, rules);
    expect(r.status).toBe('FAIL');
    expect(r.details.join(' ')).toContain('MSEC-014');
    expect(r.details.join(' ')).not.toContain('ASR-005');
    expect(secretsStep(report([result('ASR-005', 'FAIL', 'high'), result('MSEC-014', 'PASS')]), rules).status).toBe('PASS');
  });
  it('is NOT_VERIFIED when no secrets rule ran', () => {
    expect(secretsStep(report([result('MSEC-014', 'NOT_VERIFIED')]), rules).status).toBe('NOT_VERIFIED');
  });
});

describe('verdict', () => {
  const step = (id: StepResult['id'], status: StepResult['status']): StepResult => ({ id, status, summary: '', details: [] });
  it('verdict is red when any step fails and green otherwise', () => {
    expect(verdictOf([step('build', 'PASS'), step('tests', 'NOT_VERIFIED'), step('policy', 'WARNING')])).toBe('green');
    expect(verdictOf([step('build', 'PASS'), step('icon', 'FAIL')])).toBe('red');
  });
  it('firstFailing follows STEP_ORDER', () => {
    expect(firstFailing([step('icon', 'FAIL'), step('policy', 'FAIL'), step('build', 'PASS')])?.id).toBe('policy');
    expect(firstFailing([step('build', 'PASS')])).toBeNull();
  });
});
