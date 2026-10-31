import { describe, expect, it } from 'vitest';
import { initialState, isDirty, reducer, type EditorState } from './store';

const open = (s: EditorState, path: string, content = '') => reducer(s, { type: 'open', path, content });

describe('editor reducer', () => {
  it('opens a file once and re-activates it instead of duplicating', () => {
    let s = open(initialState, 'a.swift', 'x');
    s = open(s, 'b.swift');
    s = reducer(s, { type: 'edit', path: 'a.swift', content: 'changed' });
    s = open(s, 'a.swift', 'from-disk');
    expect(s.tabs).toHaveLength(2);
    expect(s.active).toBe('a.swift');
    expect(s.tabs[0].content).toBe('changed');
  });

  it('tracks dirty state and clears it on save', () => {
    let s = open(initialState, 'a.swift', 'x');
    s = reducer(s, { type: 'edit', path: 'a.swift', content: 'y' });
    expect(isDirty(s.tabs[0])).toBe(true);
    s = reducer(s, { type: 'saved', path: 'a.swift', content: 'y' });
    expect(isDirty(s.tabs[0])).toBe(false);
  });

  it('keeps the tab dirty when typing continues during a save', () => {
    let s = open(initialState, 'a.swift', 'x');
    s = reducer(s, { type: 'edit', path: 'a.swift', content: 'y' });
    s = reducer(s, { type: 'edit', path: 'a.swift', content: 'yz' });
    s = reducer(s, { type: 'saved', path: 'a.swift', content: 'y' });
    expect(isDirty(s.tabs[0])).toBe(true);
  });

  it('activates a neighbour when the active tab closes', () => {
    let s = open(open(open(initialState, 'a'), 'b'), 'c');
    s = reducer(s, { type: 'activate', path: 'b' });
    s = reducer(s, { type: 'close', path: 'b' });
    expect(s.tabs.map((t) => t.path)).toEqual(['a', 'c']);
    expect(s.active).toBe('c');
    s = reducer(s, { type: 'close', path: 'c' });
    s = reducer(s, { type: 'close', path: 'a' });
    expect(s.active).toBeNull();
  });

  it('resets tabs when another workspace opens', () => {
    const s = reducer(open(initialState, 'a'), { type: 'workspace', root: '/w' });
    expect(s).toMatchObject({ workspace: '/w', tabs: [], active: null });
  });

  it('ignores activation of unknown tabs', () => {
    const s = open(initialState, 'a');
    expect(reducer(s, { type: 'activate', path: 'zzz' })).toBe(s);
  });
});

describe('reloaded', () => {
  it('replaces content and saved snapshot of an open tab only', () => {
    let s = reducer(initialState, { type: 'open', path: 'a', content: 'x' });
    s = reducer(s, { type: 'reloaded', path: 'a', content: 'from-disk' });
    expect(s.tabs[0]).toMatchObject({ path: 'a', content: 'from-disk', saved: 'from-disk' });
    expect(s.tabs[0].rev).toBeGreaterThan(1);
    expect(reducer(s, { type: 'reloaded', path: 'zzz', content: 'q' })).toEqual(s);
  });
});
