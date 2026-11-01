import { describe, expect, it } from 'vitest';
import type { Capabilities, EvaluationReport, RuleResult, RuleStatus, Severity } from './types';
import {
  filterByPrefix,
  groupBySeverity,
  securityGroup,
  sortFindings,
  summaryLine,
  unverifiedCount,
  unverifiedLine,
} from './view';

function res(ruleId: string, status: RuleStatus, severity: Severity = 'medium', name = 'Rule'): RuleResult {
  return { ruleId, name, status, severity, implementation: 'ENFORCED', findings: [], lastVerified: null, policyVersion: '1' };
}

function report(results: RuleResult[]): EvaluationReport {
  const counts = { PASS: 0, FAIL: 0, WARNING: 0, NOT_APPLICABLE: 0, NOT_VERIFIED: 0, BLOCKED: 0 };
  for (const r of results) counts[r.status]++;
  return { generatedAt: 'now', capabilities: {} as Capabilities, results, counts, blocksRelease: false };
}

const fixture = report([
  res('ASR-001', 'PASS'),
  res('ASR-002', 'NOT_VERIFIED'),
  res('ASR-003', 'BLOCKED'),
  res('MSEC-001', 'FAIL', 'critical', 'Hardcoded token in source'),
  res('MSEC-002', 'WARNING', 'low'),
]);

describe('filterByPrefix', () => {
  it('keeps only matching rules and recomputes counts', () => {
    const asr = filterByPrefix(fixture, 'ASR-');
    expect(asr.results.map((r) => r.ruleId)).toEqual(['ASR-001', 'ASR-002', 'ASR-003']);
    expect(asr.counts.FAIL).toBe(0);
    expect(asr.blocksRelease).toBe(false);
    const sec = filterByPrefix(fixture, 'MSEC-');
    expect(sec.results).toHaveLength(2);
    expect(sec.blocksRelease).toBe(true);
  });
});

describe('unverified count', () => {
  it('is NOT_VERIFIED + BLOCKED', () => {
    const c = filterByPrefix(fixture, 'ASR-').counts;
    expect(unverifiedCount(c)).toBe(2);
    expect(unverifiedLine(c)).toBe('Doğrulanamayan: 2 kural elle inceleme gerektiriyor veya henüz uygulanmadı');
  });
});

describe('groupBySeverity', () => {
  it('orders by severity and drops empty groups', () => {
    const g = groupBySeverity(filterByPrefix(fixture, 'MSEC-').results);
    expect(g.map((x) => x.severity)).toEqual(['critical', 'low']);
  });
});

describe('securityGroup', () => {
  it('derives categories from keywords', () => {
    expect(securityGroup({ ruleId: 'MSEC-001', name: 'Hardcoded token in source' })).toBe('Kimlik doğrulama ve token');
    expect(securityGroup({ ruleId: 'MSEC-002', name: 'AI agent tool permissions' })).toBe('Yapay zekâ ajanı güvenliği');
    expect(securityGroup({ ruleId: 'MSEC-003', name: 'Unpinned dependencies' })).toBe('Bağımlılıklar ve tedarik zinciri');
    expect(securityGroup({ ruleId: 'MSEC-004', name: 'Secrets written to logs' })).toBe('Hassas veri ifşası');
    expect(securityGroup({ ruleId: 'MSEC-005', name: 'Zzz' })).toBe('Diğer');
  });
});

describe('sortFindings', () => {
  it('sorts by file then line without mutating', () => {
    const input = [
      { file: 'b.ts', line: 1, message: 'x', evidence: '' },
      { message: 'nofile', evidence: '' },
      { file: 'a.ts', line: 9, message: 'x', evidence: '' },
      { file: 'a.ts', line: 2, message: 'x', evidence: '' },
    ];
    const out = sortFindings(input);
    expect(out.map((f) => `${f.file ?? '-'}:${f.line ?? 0}`)).toEqual(['a.ts:2', 'a.ts:9', 'b.ts:1', '-:0']);
    expect(input[0].file).toBe('b.ts');
  });
});

describe('no score', () => {
  it('summary output has no percentage or score', () => {
    const c = fixture.counts;
    const text = `${summaryLine(c)} ${unverifiedLine(c)}`;
    expect(text).not.toMatch(/%|score|\/\s*100/i);
    expect(text).toContain('1 geçti');
  });
});
