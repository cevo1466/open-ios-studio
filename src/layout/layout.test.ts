import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AI_MAX,
  BOTTOM_DEFAULT,
  BOTTOM_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  bottomMax,
  clamp,
  clampBottom,
  defaultLayout,
  dragSize,
  loadLayout,
  parseLayout,
  saveLayout,
} from './layout';

afterEach(() => vi.unstubAllGlobals());

describe('layout limits', () => {
  it('bottom panel is at least 150px and at most 75% of the available height', () => {
    expect(bottomMax(1000)).toBe(750);
    expect(bottomMax(100)).toBe(BOTTOM_MIN);
    expect(bottomMax(0)).toBe(BOTTOM_MIN);
    expect(clampBottom(10, 1000)).toBe(BOTTOM_MIN);
    expect(clampBottom(900, 1000)).toBe(750);
    expect(clampBottom(400, 1000)).toBe(400);
  });
  it('clamp tolerates non-finite input', () => {
    expect(clamp(Number.NaN, 5, 10)).toBe(5);
    expect(clamp(7.6, 5, 10)).toBe(8);
  });
});

describe('dragSize', () => {
  it('dragging a top edge up grows the panel (direction -1)', () => {
    expect(dragSize(300, -80, -1, 150, 750)).toBe(380);
    expect(dragSize(300, 80, -1, 150, 750)).toBe(220);
  });
  it('dragging a right edge right grows the panel (direction +1)', () => {
    expect(dragSize(260, 40, 1, SIDEBAR_MIN, SIDEBAR_MAX)).toBe(300);
  });
  it('never leaves the limits', () => {
    expect(dragSize(300, 5000, -1, 150, 750)).toBe(150);
    expect(dragSize(300, -5000, -1, 150, 750)).toBe(750);
  });
});

describe('persistence', () => {
  it('falls back to defaults on bad input', () => {
    expect(parseLayout(null)).toEqual(defaultLayout);
    expect(parseLayout('{nope')).toEqual(defaultLayout);
    expect(parseLayout('42')).toEqual(defaultLayout);
    expect(parseLayout(JSON.stringify({ bottomHeight: 'x' })).bottomHeight).toBe(BOTTOM_DEFAULT);
  });
  it('clamps stored values', () => {
    const l = parseLayout(JSON.stringify({ sidebarWidth: 5, bottomHeight: 20, aiWidth: 99999 }));
    expect(l.sidebarWidth).toBe(SIDEBAR_MIN);
    expect(l.bottomHeight).toBe(BOTTOM_MIN);
    expect(l.aiWidth).toBe(AI_MAX);
  });
  it('round-trips through storage', () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    });
    saveLayout({ sidebarWidth: 300, bottomHeight: 420, aiWidth: 450 });
    expect(loadLayout()).toEqual({ sidebarWidth: 300, bottomHeight: 420, aiWidth: 450 });
  });
  it('survives unavailable storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadLayout()).toEqual(defaultLayout);
    expect(() => saveLayout(defaultLayout)).not.toThrow();
  });
});
