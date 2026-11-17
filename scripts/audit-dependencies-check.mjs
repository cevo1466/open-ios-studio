import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessAudit } from './audit-dependencies.mjs';

function fixture() {
  return {
    report: { auditReportVersion: 2, vulnerabilities: {
      picomatch: { severity: 'high', nodes: ['node_modules/picomatch'], via: [{
        name: 'picomatch', severity: 'high', url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
      }] },
      vite: { severity: 'high', nodes: ['node_modules/vite'], via: ['picomatch'] },
    } },
    lock: { packages: {
      'node_modules/picomatch': { version: '4.0.7', dev: true },
      'node_modules/vite': { version: '8.3.5', dev: true },
    } },
  };
}
const now = new Date('2026-11-17T00:00:00Z');
test('known development-only finding remains a visible, expiring assessment', () => {
  const { report, lock } = fixture();
  assert.deepEqual(assessAudit(report, lock, now), { blocked: [], accepted: ['picomatch', 'vite'] });
  assert.deepEqual(assessAudit(report, lock, new Date('2026-12-01')), { blocked: ['picomatch', 'vite'], accepted: [] });
});
test('production, missing lock metadata and changed package versions fail closed', () => {
  for (const change of [p => { p.dev = false; }, p => { delete p.dev; }, p => { p.version = '4.0.8'; }]) {
    const { report, lock } = fixture();
    change(lock.packages['node_modules/picomatch']);
    assert.deepEqual(assessAudit(report, lock, now).blocked, ['picomatch', 'vite']);
  }
});
test('new advisories and critical severity are never accepted', () => {
  for (const change of [v => { v.via[0].url = 'https://github.com/advisories/NEW'; }, v => { v.severity = 'critical'; }]) {
    const { report, lock } = fixture();
    change(report.vulnerabilities.picomatch);
    assert.deepEqual(assessAudit(report, lock, now).blocked, ['picomatch', 'vite']);
  }
});
test('unknown and cyclic transitive causes fail closed', () => {
  for (const via of ['unknown', 'vite']) {
    const { report, lock } = fixture();
    report.vulnerabilities.picomatch.via = [via];
    assert.equal(assessAudit(report, lock, now).blocked.length, 2);
  }
});
test('audit API failure and unsupported output fail closed', () => {
  assert.throws(() => assessAudit({ error: 'network' }, {}, now));
  assert.throws(() => assessAudit({}, {}, now));
});
