import { describe, expect, it } from 'vitest';
import { isApplicable } from './applicability.js';
import { evaluate } from './evaluator.js';
import { deriveCapabilities } from './manifest.js';
import type { Capabilities, Detector, Implementation, Rule, Severity } from './types.js';

const none = deriveCapabilities([]);
const caps = (o: Partial<Capabilities> = {}): Capabilities => ({ ...none, ...o });

function rule(id: string, o: Partial<Rule> = {}): Rule {
  return {
    id, name: `Rule ${id}`, category: 'test', platform: ['ios'],
    applicability: { always: true }, notApplicableReason: `N/A ${id}`,
    severity: 'high' as Severity,
    officialReference: { title: 't', url: 'https://example.com' },
    detectionMethod: 'd', remediation: 'r', autoFix: 'none', requiresApproval: false,
    verification: 'v', evidence: 'e', implementation: 'ENFORCED' as Implementation,
    detectorId: id, lastVerified: '2026-01-01', policyVersion: '1.0.0', ...o,
  };
}
const det = (ruleId: string, outcome: 'pass' | 'fail' | 'warn' | 'not_verified'): Detector => ({
  ruleId,
  run: () => ({ outcome, findings: outcome === 'fail' ? [{ message: 'm', evidence: 'x' }] : [] }),
});
const now = () => new Date('2026-02-02T00:00:00Z');

describe('isApplicable', () => {
  it('always / empty', () => {
    expect(isApplicable(rule('A'), none)).toBe(true);
    expect(isApplicable(rule('A', { applicability: {} }), none)).toBe(true);
  });
  it('all / any / none', () => {
    const all = rule('A', { applicability: { all: ['usesCamera', 'usesPhotos'] } });
    expect(isApplicable(all, caps({ usesCamera: true }))).toBe(false);
    expect(isApplicable(all, caps({ usesCamera: true, usesPhotos: true }))).toBe(true);
    const any = rule('A', { applicability: { any: ['usesCamera', 'usesPhotos'] } });
    expect(isApplicable(any, none)).toBe(false);
    expect(isApplicable(any, caps({ usesPhotos: true }))).toBe(true);
    const no = rule('A', { applicability: { none: ['usesAI'] } });
    expect(isApplicable(no, none)).toBe(true);
    expect(isApplicable(no, caps({ usesAI: true }))).toBe(false);
    expect(isApplicable(rule('A', { applicability: { any: [] } }), none)).toBe(true);
  });
});

describe('evaluate', () => {
  const run = (rules: Rule[], detectors: Detector[]) =>
    evaluate({ rules, detectors, files: [], capabilities: none, now });

  it('not applicable carries reason', () => {
    const r = run([rule('A', { applicability: { all: ['usesCamera'] } })], [det('A', 'pass')]);
    expect(r.results[0]).toMatchObject({ status: 'NOT_APPLICABLE', reason: 'N/A A' });
  });
  it('manual / not implemented / missing detector never PASS', () => {
    const r = run(
      [rule('A', { implementation: 'MANUAL_ONLY' }), rule('B', { implementation: 'NOT_IMPLEMENTED' }), rule('C')],
      [det('A', 'pass'), det('B', 'pass')],
    );
    expect(r.results.map((x) => x.status)).toEqual(['NOT_VERIFIED', 'NOT_VERIFIED', 'NOT_VERIFIED']);
    expect(r.results.every((x) => x.reason)).toBe(true);
  });
  it('detector exception is BLOCKED', () => {
    const bad: Detector = { ruleId: 'A', run: () => { throw new Error('boom'); } };
    const r = run([rule('A')], [bad]);
    expect(r.results[0]).toMatchObject({ status: 'BLOCKED', reason: 'boom' });
  });
  it('PASS only when detector ran, not_verified stays unverified', () => {
    let ran = false;
    const d: Detector = { ruleId: 'A', run: () => { ran = true; return { outcome: 'pass', findings: [] }; } };
    const r = run([rule('A'), rule('B')], [d, det('B', 'not_verified')]);
    expect(ran).toBe(true);
    expect(r.results[0].status).toBe('PASS');
    expect(r.results[1].status).toBe('NOT_VERIFIED');
    expect(run([rule('A')], []).results[0].status).not.toBe('PASS');
  });
  it('critical FAIL blocks release, high FAIL does not', () => {
    const hi = run([rule('A', { severity: 'high' })], [det('A', 'fail')]);
    expect(hi.results[0].status).toBe('FAIL');
    expect(hi.blocksRelease).toBe(false);
    const cr = run([rule('A', { severity: 'critical' })], [det('A', 'fail')]);
    expect(cr.blocksRelease).toBe(true);
    expect(run([rule('A', { severity: 'critical' })], [det('A', 'warn')]).blocksRelease).toBe(false);
  });
  it('counts, sorting, metadata', () => {
    const r = run(
      [rule('C'), rule('B', { applicability: { all: ['usesAI'] } }), rule('A'), rule('D')],
      [det('A', 'pass'), det('C', 'warn'), det('D', 'fail')],
    );
    expect(r.results.map((x) => x.ruleId)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.counts).toEqual({ PASS: 1, FAIL: 1, WARNING: 1, NOT_APPLICABLE: 1, NOT_VERIFIED: 0, BLOCKED: 0 });
    expect(r.generatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(r.results[0]).toMatchObject({ lastVerified: '2026-01-01', policyVersion: '1.0.0', implementation: 'ENFORCED' });
  });
  it('derives capabilities by default', () => {
    const r = evaluate({
      rules: [rule('A', { applicability: { all: ['usesCamera'] } })],
      detectors: [det('A', 'pass')],
      files: [{ path: 'App/Cam.swift', content: 'let s = AVCaptureSession()' }],
    });
    expect(r.results[0].status).toBe('PASS');
  });
});

describe('deriveCapabilities', () => {
  const d = (path: string, content: string) => deriveCapabilities([{ path, content }]);
  it('camera', () => expect(d('A.swift', 'AVCaptureSession()').usesCamera).toBe(true));
  it('firebase', () => {
    expect(d('Package.swift', '.package(url: "firebase-ios-sdk")').usesFirebase).toBe(true);
    expect(d('GoogleService-Info.plist', '').usesFirebase).toBe(true);
  });
  it('subscriptions', () => {
    const c = d('S.swift', 'import StoreKit\nlet i: Product.SubscriptionInfo');
    expect(c.hasSubscriptions).toBe(true);
    expect(c.hasInAppPurchases).toBe(true);
  });
  it('SIWA', () => expect(d('A.swift', 'SignInWithAppleButton(.signIn)').hasSignInWithApple).toBe(true));
  it('social login', () => {
    const c = d('A.swift', 'import GoogleSignIn\nimport FBSDKLoginKit');
    expect(c.hasSocialLogin).toBe(true);
    expect(c.socialProviders).toEqual(['google', 'facebook']);
  });
  it('ignores skipped dirs and caps', () => {
    expect(d('node_modules/x/a.swift', 'AVCaptureSession').usesCamera).toBe(false);
    expect(d('Pods/x.swift', 'CLLocationManager').usesLocation).toBe(false);
  });
  it('CI and appstore signals', () => {
    const c = deriveCapabilities([
      { path: '.github/workflows/ci.yml', content: 'on: push' },
      { path: 'App/Info.plist', content: '<plist/>' },
    ]);
    expect(c.hasCiWorkflows).toBe(true);
    expect(c.targetsAppStore).toBe(true);
  });
  it('no-signal project is all false', () => {
    const c = d('README.md', 'hello world');
    const { socialProviders, ...rest } = c;
    expect(socialProviders).toEqual([]);
    expect(Object.values(rest).every((v) => v === false)).toBe(true);
  });
});
