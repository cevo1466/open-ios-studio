import { describe, expect, it } from 'vitest';
import { defaultAiSettings } from './settings';
import { applyBlockedReason, filesForRepair, findingsForChanges, prepareContext, toPending } from './engine';

const swift = (path: string, content: string) => ({ path, content });

describe('prepareContext', () => {
  it('includes project files and the applicable policy rules, within budget', () => {
    const files = [swift('Package.swift', '// swift-tools-version: 6.0'), swift('Sources/App/A.swift', 'import SwiftUI')];
    const ctx = prepareContext({ files, openPaths: [], activePath: null, settings: defaultAiSettings });
    expect(ctx.projectContext).toContain('Sources/App/A.swift');
    expect(ctx.policyContext.length).toBeGreaterThan(0);
    expect(ctx.summary).toMatch(/\d+ files, ~\d+ tokens/);
  });

  it('never puts secret files into the context', () => {
    const files = [swift('.env', 'API_KEY=supersecretvalue1234567890'), swift('Package.swift', '')];
    const ctx = prepareContext({ files, openPaths: ['.env'], activePath: '.env', settings: defaultAiSettings });
    expect(ctx.projectContext).not.toContain('supersecretvalue');
  });
});

describe('findingsForChanges', () => {
  const key = 'AKIA' + 'ABCDEFGHIJKLMNOP';

  it('reports policy findings that the proposed code introduces', () => {
    const bad = { path: 'Sources/App/Config.swift', content: `let k = "${key}"\n` };
    const found = findingsForChanges([], [bad]);
    const list = found['Sources/App/Config.swift'];
    expect(list?.some((f) => f.ruleId === 'MSEC-014' && f.status === 'FAIL')).toBe(true);
    expect(JSON.stringify(found)).not.toContain(key);
  });

  it('is quiet for clean code and ignores findings in files the AI did not touch', () => {
    const existing = [swift('Sources/App/Old.swift', `let k = "${key}"\n`)];
    const clean = { path: 'Sources/App/New.swift', content: 'import SwiftUI\nstruct V: View { var body: some View { Text("Hi") } }\n' };
    expect(findingsForChanges(existing, [clean])).toEqual({});
  });
});

describe('applyBlockedReason', () => {
  const change = (path: string, findings: { status: string; severity: string }[] = []) =>
    toPending([{ path, content: 'x' }], {}, { [path]: findings.map((f) => ({ ruleId: 'R', message: 'm', ...f })) })[0];

  it('blocks when the editor has unsaved edits to an approved file', () => {
    expect(applyBlockedReason([change('A.swift')], ['A.swift'])).toContain('unsaved');
  });
  it('blocks critical failures but allows warnings', () => {
    expect(applyBlockedReason([change('A.swift', [{ status: 'FAIL', severity: 'critical' }])], [])).toContain('critical');
    expect(applyBlockedReason([change('A.swift', [{ status: 'WARNING', severity: 'critical' }])], [])).toBeNull();
    expect(applyBlockedReason([change('A.swift')], [])).toBeNull();
  });
});

describe('toPending / filesForRepair', () => {
  it('marks new files with a null original and everything pending', () => {
    const [p] = toPending([{ path: 'N.swift', content: 'c' }], { 'N.swift': null }, {});
    expect(p).toMatchObject({ original: null, decision: 'pending', findings: [] });
  });

  it('selects files named by diagnostics (absolute paths) plus Package.swift', () => {
    const files = [swift('Package.swift', ''), swift('Sources/App/A.swift', ''), swift('Sources/App/B.swift', '')];
    const picked = filesForRepair(files, [
      { file: '/work/Demo/Sources/App/A.swift', line: 3, column: 1, severity: 'error', message: 'm', raw: '' },
      { file: null, line: null, column: null, severity: 'error', message: 'm', raw: '' },
    ]);
    expect(picked.map((f) => f.path).sort()).toEqual(['Package.swift', 'Sources/App/A.swift']);
  });
});
