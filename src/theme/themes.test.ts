import { describe, expect, it } from 'vitest';
import { THEMES, THEME_VAR_NAMES, monacoThemeName, resolveTheme, themeById } from './themes';

describe('themes', () => {
  it('ships the two defaults and four extra themes', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['dark', 'light', 'midnight', 'monokai', 'dracula', 'solarized-light']);
  });
  it('custom themes set the full variable set; defaults rely on the stylesheet', () => {
    expect(themeById('dark').vars).toEqual({});
    for (const t of THEMES.filter((x) => Object.keys(x.vars).length > 0)) {
      expect(Object.keys(t.vars).sort()).toEqual([...THEME_VAR_NAMES].sort());
    }
  });
  it('all colours are valid hex', () => {
    for (const t of THEMES) {
      for (const v of [...Object.values(t.vars), ...t.swatch, t.terminal.background, t.terminal.foreground]) {
        expect(v).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
  it('monaco rules use colours without a leading #', () => {
    for (const t of THEMES) for (const r of t.monaco.rules) if (r.foreground) expect(r.foreground).toMatch(/^[0-9a-f]{6}$/i);
  });
  it('resolves system and names monaco themes', () => {
    expect(resolveTheme('system', true).id).toBe('dark');
    expect(resolveTheme('dracula', false).mode).toBe('dark');
    expect(monacoThemeName(themeById('light'))).toBe('vs');
    expect(monacoThemeName(themeById('monokai'))).toBe('ois-monokai');
  });
});
