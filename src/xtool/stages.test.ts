import { describe, expect, it } from 'vitest';
import { stageProgress, stagesFor } from './stages';
import { summarize } from './summary';
import { initialBuildState, type BuildState } from './buildState';

const states = (op: Parameters<typeof stageProgress>[0], lines: string[], running: boolean, code: number | null = null) =>
  stageProgress(op, lines, running, running ? null : { code, cancelled: false }).map((s) => `${s.id}:${s.state}`);

describe('stages', () => {
  it('only build and run-device have a stage bar', () => {
    expect(stagesFor('sdk-status')).toEqual([]);
    expect(stagesFor('build')).toHaveLength(1);
    expect(stagesFor('run-device')).toHaveLength(4);
  });
  it('advances with the log while running', () => {
    expect(states('run-device', ['Compiling Demo.swift'], true)).toEqual(['package:active', 'sign:pending', 'install:pending', 'verify:pending']);
    expect(states('run-device', ['Compiling', 'Signing with certificate'], true)).toEqual(['package:done', 'sign:active', 'install:pending', 'verify:pending']);
  });
  it('marks everything done on success and the reached stage failed on error', () => {
    expect(states('run-device', ['Compiling'], false, 0)).toEqual(['package:done', 'sign:done', 'install:done', 'verify:done']);
    expect(states('run-device', ['Compiling', 'Signing failed'], false, 1)).toEqual(['package:done', 'sign:failed', 'install:pending', 'verify:pending']);
  });
  it('fails the first stage when nothing was reached', () => {
    expect(states('run-device', ['error: nothing'], false, 1)[0]).toBe('package:failed');
  });
});

describe('summarize', () => {
  const base: BuildState = { ...initialBuildState, op: 'build' };
  it('reports success, cancel, running and idle', () => {
    expect(summarize({ ...base, outcome: { code: 0, cancelled: false, timedOut: false, droppedLines: 0 } }, []).tone).toBe('success');
    expect(summarize({ ...base, outcome: { code: null, cancelled: true, timedOut: false, droppedLines: 0 } }, []).tone).toBe('cancelled');
    expect(summarize({ ...base, running: true }, []).tone).toBe('running');
    expect(summarize(base, []).tone).toBe('idle');
  });
  it('gives a short failure reason from the first error, then from stderr', () => {
    const failed = { ...base, outcome: { code: 1, cancelled: false, timedOut: false, droppedLines: 0 } };
    const withDiag = summarize(failed, [{ file: 'A.swift', line: 3, column: 1, severity: 'error', message: 'cannot find x', raw: '' }]);
    expect(withDiag).toMatchObject({ tone: 'error', detail: 'cannot find x' });
    const withStderr = summarize({ ...failed, lines: [{ id: 1, stream: 'stderr', text: 'boom happened' }] }, []);
    expect(withStderr.detail).toBe('boom happened');
    expect(summarize(failed, []).detail).toBe('Ayrıntılar günlükte.');
  });
  it('truncates long details', () => {
    const long = 'x'.repeat(400);
    const s = summarize({ ...base, outcome: { code: 1, cancelled: false, timedOut: false, droppedLines: 0 }, lines: [{ id: 1, stream: 'stderr', text: long }] }, []);
    expect(s.detail!.length).toBeLessThanOrEqual(160);
  });
});
