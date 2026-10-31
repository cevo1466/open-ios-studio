import { describe, expect, it } from 'vitest';
import { buildReducer, initialBuildState, MAX_LOG_LINES, type BuildState } from './buildState';
import type { RunEvent } from './types';

const line = (text: string): RunEvent => ({ kind: 'line', stream: 'stdout', text });
const feed = (s: BuildState, n: number) => {
  for (let i = 0; i < n; i++) s = buildReducer(s, { type: 'event', event: line(`l${i}`) });
  return s;
};

describe('buildReducer', () => {
  it('enforces the bound and counts dropped lines', () => {
    const s = feed(buildReducer(initialBuildState, { type: 'start', op: 'build' }), MAX_LOG_LINES + 10);
    expect(s.lines).toHaveLength(MAX_LOG_LINES);
    expect(s.dropped).toBe(10);
    expect(s.lines[0].text).toBe('l10');
  });
  it('start resets', () => {
    let s = feed(buildReducer(initialBuildState, { type: 'start', op: 'build' }), 3);
    s = buildReducer(s, { type: 'start', op: 'new' });
    expect(s.lines).toEqual([]);
    expect(s.dropped).toBe(0);
    expect(s.outcome).toBeNull();
    expect(s.running).toBe(true);
    expect(s.op).toBe('new');
  });
  it('exit stops running and keeps outcome', () => {
    let s = feed(buildReducer(initialBuildState, { type: 'start', op: 'build' }), 2);
    s = buildReducer(s, {
      type: 'event',
      event: { kind: 'exit', code: 1, cancelled: false, timedOut: true, droppedLines: 4 },
    });
    expect(s.running).toBe(false);
    expect(s.dropped).toBe(4);
    expect(s.outcome).toEqual({ code: 1, cancelled: false, timedOut: true, droppedLines: 4 });
  });
  it('ids strictly increase, also across drops', () => {
    const s = feed(buildReducer(initialBuildState, { type: 'start', op: 'build' }), MAX_LOG_LINES + 5);
    for (let i = 1; i < s.lines.length; i++) expect(s.lines[i].id).toBeGreaterThan(s.lines[i - 1].id);
  });
});
