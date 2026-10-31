import { describe, expect, it } from 'vitest';
import { defaultSettings, effectiveTheme, parseSettings } from './settings';

describe('settings', () => {
  it('falls back to defaults on bad input', () => {
    expect(parseSettings(null)).toEqual(defaultSettings);
    expect(parseSettings('{oops')).toEqual(defaultSettings);
    expect(parseSettings('{"theme":"neon","fontSize":"big"}')).toEqual(defaultSettings);
  });
  it('clamps font size', () => {
    expect(parseSettings('{"theme":"dark","fontSize":99}')).toEqual({ theme: 'dark', fontSize: 28 });
    expect(parseSettings('{"fontSize":1}').fontSize).toBe(10);
  });
  it('resolves system theme', () => {
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('light', true)).toBe('light');
  });
});
