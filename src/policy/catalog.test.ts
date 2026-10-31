import { describe, expect, it } from 'vitest';
import { loadCatalogs } from './catalog';
import { allDetectors, analyzeProject } from './index';

const rules = loadCatalogs();

describe('rule catalogs', () => {
  it('define 24 App Store and 26 security rules with unique ids', () => {
    expect(rules.filter((r) => r.id.startsWith('ASR-'))).toHaveLength(24);
    expect(rules.filter((r) => r.id.startsWith('MSEC-'))).toHaveLength(26);
    expect(new Set(rules.map((r) => r.id)).size).toBe(50);
  });

  it('claims implementation only where a detector exists, and vice versa', () => {
    const detectorIds = new Set(allDetectors.map((d) => d.ruleId));
    for (const r of rules) {
      const claims = r.implementation === 'ENFORCED' || r.implementation === 'PARTIAL';
      expect(claims, `${r.id} implementation vs detectorId`).toBe(r.detectorId !== null);
      if (r.detectorId !== null) expect(detectorIds.has(r.detectorId), `${r.id} detector`).toBe(true);
    }
    for (const id of detectorIds) expect(rules.some((r) => r.id === id), `detector ${id} has a rule`).toBe(true);
  });

  it('never claims verified sources in this session', () => {
    expect(rules.every((r) => r.lastVerified === null)).toBe(true);
  });
});

describe('analyzeProject', () => {
  it('reports unverified rules as NOT_VERIFIED, never PASS, for an empty project', () => {
    const report = analyzeProject([]);
    expect(report.results).toHaveLength(50);
    expect(report.counts.PASS + report.counts.FAIL + report.counts.WARNING).toBeLessThan(50);
    for (const r of report.results.filter((x) => x.implementation === 'MANUAL_ONLY' || x.implementation === 'NOT_IMPLEMENTED')) {
      expect(['NOT_VERIFIED', 'NOT_APPLICABLE']).toContain(r.status);
    }
  });

  it('flags an embedded secret and blocks the release', () => {
    const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';
    const report = analyzeProject([{ path: 'Sources/App/Config.swift', content: `let k = "${key}"\n` }]);
    const r = report.results.find((x) => x.ruleId === 'MSEC-014');
    expect(r?.status).toBe('FAIL');
    expect(r?.findings[0].file).toBe('Sources/App/Config.swift');
    expect(r?.findings[0].evidence).not.toContain(key);
    expect(report.blocksRelease).toBe(r?.severity === 'critical');
  });
});
