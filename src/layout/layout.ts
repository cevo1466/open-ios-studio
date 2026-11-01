/** Pure layout model: sizes, limits and persistence of the resizable IDE panels. */

export const BOTTOM_MIN = 150;
export const BOTTOM_MAX_RATIO = 0.75;
export const BOTTOM_DEFAULT = 300;
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 260;
export const AI_MIN = 300;
export const AI_MAX = 640;
export const AI_DEFAULT = 380;
export const KEY_STEP = 16;

const STORAGE_KEY = 'open-ios-studio.layout.v1';

export interface LayoutState {
  sidebarWidth: number;
  bottomHeight: number;
  aiWidth: number;
}

export const defaultLayout: LayoutState = {
  sidebarWidth: SIDEBAR_DEFAULT,
  bottomHeight: BOTTOM_DEFAULT,
  aiWidth: AI_DEFAULT,
};

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Largest bottom panel height for the given available height (never below the minimum). */
export function bottomMax(available: number): number {
  if (!Number.isFinite(available) || available <= 0) return BOTTOM_MIN;
  return Math.max(BOTTOM_MIN, Math.floor(available * BOTTOM_MAX_RATIO));
}

export function clampBottom(height: number, available: number): number {
  return clamp(height, BOTTOM_MIN, bottomMax(available));
}

export function parseLayout(raw: string | null): LayoutState {
  if (!raw) return defaultLayout;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null) return defaultLayout;
    const o = v as Record<string, unknown>;
    const num = (x: unknown, fallback: number, min: number, max: number) =>
      typeof x === 'number' && Number.isFinite(x) ? clamp(x, min, max) : fallback;
    return {
      sidebarWidth: num(o.sidebarWidth, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX),
      // The upper limit depends on the window; it is applied when the panel is laid out.
      bottomHeight: num(o.bottomHeight, BOTTOM_DEFAULT, BOTTOM_MIN, 4000),
      aiWidth: num(o.aiWidth, AI_DEFAULT, AI_MIN, AI_MAX),
    };
  } catch {
    return defaultLayout;
  }
}

export function loadLayout(): LayoutState {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultLayout;
  }
}

export function saveLayout(layout: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable: sizes last for this session only */
  }
}

/** New size after dragging by `delta` px. `direction` is +1 when moving toward +x/+y grows the panel. */
export function dragSize(startValue: number, delta: number, direction: 1 | -1, min: number, max: number): number {
  return clamp(startValue + direction * delta, min, max);
}
