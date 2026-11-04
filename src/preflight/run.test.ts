import { describe, expect, it } from 'vitest';
import type { EvaluationReport, ProjectFile, Rule } from '../policy/types';
import type { PngHeader } from './icon';
import { runPreflight, type PreflightDeps } from './run';
import type { RunOutcome } from './steps';
import { REPORT_JSON, REPORT_MD, type StepId, type StepResult } from './types';

const baseFiles: ProjectFile[] = [
  { path: 'Package.swift', content: '// swift-tools-version: 6.0' },
  { path: 'xtool.yml', content: 'version: 1\nbundleID: com.example.demo\n' },
  { path: 'Sources/Demo/App.swift', content: 'import SwiftUI\n@main struct DemoApp: App { var body: some Scene { WindowGroup { Text("hi") } } }' },
];

const emptyReport: EvaluationReport = {
  generatedAt: 'now',
  capabilities: {} as EvaluationReport['capabilities'],
  results: [],
  counts: { PASS: 0, FAIL: 0, WARNING: 0, NOT_APPLICABLE: 0, NOT_VERIFIED: 0, BLOCKED: 0 },
  blocksRelease: false,
};

interface FakeOptions {
  files?: ProjectFile[];
  build?: RunOutcome;
  tests?: RunOutcome;
  png?: PngHeader | null;
}

function fakeDeps(opts: FakeOptions = {}) {
  const ops: string[] = [];
  const written = new Map<string, string>();
  const files = opts.files ?? baseFiles;
  const deps: PreflightDeps = {
    project: '',
    scan: async () => ({ files: [...files, ...[...written.entries()].map(([path, content]) => ({ path, content }))], truncated: false }),
    runOp: async (op, _args, onLine) => {
      ops.push(op);
      const outcome = op === 'build' ? (opts.build ?? { code: 0, lines: ['Build complete'], timedOut: false, cancelled: false }) : (opts.tests ?? { code: 0, lines: ['ok'], timedOut: false, cancelled: false });
      for (const l of outcome.lines) onLine(l);
      return outcome;
    },
    readPng: async () => (opts.png === undefined ? { width: 1024, height: 1024, colorType: 2 } : opts.png),
    writeFile: async (path, content) => {
      written.set(path, content);
    },
    analyze: () => emptyReport,
    rules: () => [] as Rule[],
    now: () => '2026-11-03T12:00:00.000Z',
  };
  return { deps, ops, written };
}

describe('runPreflight', () => {
  it('runs steps in order and reports progress', async () => {
    const { deps, ops } = fakeDeps();
    const seen: string[] = [];
    const report = await runPreflight(deps, (id: StepId, state: 'running' | StepResult) => seen.push(`${id}:${state === 'running' ? 'running' : state.status}`));
    expect(report.steps.map((s) => s.id)).toEqual(['build', 'tests', 'policy', 'secrets', 'manifest', 'icon']);
    expect(seen[0]).toBe('build:running');
    expect(seen).toContain('build:PASS');
    expect(ops).toEqual(['build']);
    expect(report.verdict).toBe('green');
  });

  it('skips swift-test without Tests/ and runs it when present', async () => {
    const without = await runPreflight(fakeDeps().deps);
    expect(without.steps.find((s) => s.id === 'tests')).toMatchObject({ status: 'NOT_VERIFIED', summary: expect.stringContaining('Tests/') });
    const withTests = fakeDeps({ files: [...baseFiles, { path: 'Tests/DemoTests/DemoTests.swift', content: 'import XCTest' }] });
    const report = await runPreflight(withTests.deps);
    expect(withTests.ops).toEqual(['build', 'swift-test']);
    expect(report.steps.find((s) => s.id === 'tests')?.status).toBe('PASS');
  });

  it('writes latest.json and latest.md', async () => {
    const { deps, written } = fakeDeps();
    const report = await runPreflight(deps);
    expect(JSON.parse(written.get(REPORT_JSON) ?? 'null')).toEqual(report);
    expect(written.get(REPORT_MD)).toContain('# Yayın öncesi denetim');
  });

  it('verdict red when build fails and later steps still run', async () => {
    const { deps } = fakeDeps({ build: { code: 1, lines: ['error: boom'], timedOut: false, cancelled: false } });
    const report = await runPreflight(deps);
    expect(report.verdict).toBe('red');
    expect(report.steps).toHaveLength(6);
    expect(report.steps.find((s) => s.id === 'icon')?.status).toBe('PASS');
  });

  it('fingerprint ignores the written report', async () => {
    const { deps } = fakeDeps();
    const first = await runPreflight(deps);
    const second = await runPreflight(deps);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a missing icon makes the icon step FAIL and the verdict red', async () => {
    const report = await runPreflight(fakeDeps({ png: null }).deps);
    expect(report.steps.find((s) => s.id === 'icon')?.status).toBe('FAIL');
    expect(report.verdict).toBe('red');
  });
});
