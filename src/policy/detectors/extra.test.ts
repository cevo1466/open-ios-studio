import { describe, expect, it } from 'vitest';
import { extraDetectors } from './extra';
import type { Capabilities, DetectorResult, ProjectFile } from '../types';

const caps = {} as Capabilities;
function run(id: string, files: ProjectFile[]): DetectorResult {
  const d = extraDetectors.find((x) => x.ruleId === id);
  if (!d) throw new Error(`no detector ${id}`);
  return d.run({ files, capabilities: caps });
}
const sw = (content: string, path = 'Sources/App/App.swift'): ProjectFile => ({ path, content });
const plist = (entries: string): ProjectFile => ({ path: 'Sources/App/Info.plist', content: `<dict>${entries}</dict>` });

describe('registry', () => {
  it('has one detector per new rule', () => {
    expect(extraDetectors.map((d) => d.ruleId).sort()).toEqual([
      'ASR-005', 'ASR-008', 'ASR-009', 'ASR-016', 'ASR-023', 'MSEC-017', 'MSEC-018',
    ]);
  });
  it('returns not_verified without sources', () => {
    for (const d of extraDetectors) expect(run(d.ruleId, []).outcome).toBe('not_verified');
  });
});

describe('ASR-005', () => {
  it('passes when a privacy policy is referenced', () => {
    expect(run('ASR-005', [sw('Link("Privacy Policy", destination: u)')]).outcome).toBe('pass');
  });
  it('ignores mentions in comments and warns', () => {
    expect(run('ASR-005', [sw('// privacy policy later\nText("Hi")')]).outcome).toBe('warn');
  });
});

describe('ASR-008', () => {
  it('warns when renewal and cancel wording are missing', () => {
    expect(run('ASR-008', [sw('Button("Buy") {}')]).findings).toHaveLength(2);
  });
  it('passes when both are present', () => {
    const r = run('ASR-008', [sw('Text("Renews automatically. Cancel anytime in Settings.")')]);
    expect(r.outcome).toBe('pass');
  });
});

describe('ASR-009', () => {
  it('warns without a terms reference', () => {
    expect(run('ASR-009', [sw('Text("Subscribe")')]).outcome).toBe('warn');
  });
  it('passes with a terms reference', () => {
    expect(run('ASR-009', [sw('Link("Terms of Use", destination: u)')]).outcome).toBe('pass');
  });
});

describe('ASR-016', () => {
  it('fails when the identifier is used without a request', () => {
    const r = run('ASR-016', [sw('let id = ASIdentifierManager.shared().advertisingIdentifier')]);
    expect(r.outcome).toBe('fail');
  });
  it('fails when requested without the usage description', () => {
    const r = run('ASR-016', [sw('ATTrackingManager.requestTrackingAuthorization { _ in }'), plist('')]);
    expect(r.outcome).toBe('fail');
  });
  it('passes when request and description exist', () => {
    const r = run('ASR-016', [
      sw('ATTrackingManager.requestTrackingAuthorization { _ in }'),
      plist('<key>NSUserTrackingUsageDescription</key><string>Ads</string>'),
    ]);
    expect(r.outcome).toBe('pass');
  });
});

describe('ASR-023', () => {
  it('warns for a web-view-only app', () => {
    const r = run('ASR-023', [sw('struct Root: View { var body: some View { WebView(url: u) } }')]);
    expect(r.outcome).toBe('warn');
  });
  it('never passes without a web view', () => {
    expect(run('ASR-023', [sw('struct A: View { var body: some View { Text("x") } }')]).outcome).toBe('not_verified');
  });
});

describe('MSEC-017', () => {
  it('passes when nothing is written', () => {
    expect(run('MSEC-017', [sw('let x = 1')]).outcome).toBe('pass');
  });
  it('warns on writes without protection', () => {
    expect(run('MSEC-017', [sw('try data.write(to: url)')]).outcome).toBe('warn');
  });
  it('passes when a protection flag exists', () => {
    expect(run('MSEC-017', [sw('try data.write(to: url, options: .completeFileProtection)')]).outcome).toBe('pass');
  });
});

describe('MSEC-018', () => {
  it('warns on a handler without validation', () => {
    const r = run('MSEC-018', [sw('.onOpenURL { url in\n  open(url)\n}')]);
    expect(r.outcome).toBe('warn');
    expect(r.findings[0].line).toBe(1);
  });
  it('passes when the handler validates host', () => {
    const r = run('MSEC-018', [sw('.onOpenURL { url in\n  guard url.host == "x" else { return }\n}')]);
    expect(r.outcome).toBe('pass');
  });
  it('is not_verified when no handler exists', () => {
    expect(run('MSEC-018', [sw('let x = 1')]).outcome).toBe('not_verified');
  });
});
