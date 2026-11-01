/** Colour themes. One source of truth: CSS variables, terminal colours and the Monaco theme. */

export type ThemeId = 'dark' | 'light' | 'midnight' | 'monokai' | 'dracula' | 'solarized-light';

export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground?: string;
}

export interface MonacoThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: { token: string; foreground?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

export interface ThemeDef {
  id: ThemeId;
  label: string;
  mode: 'light' | 'dark';
  /** CSS variables set on <html>. `dark` and `light` use the stylesheet defaults and set none. */
  vars: Record<string, string>;
  terminal: TerminalColors;
  monaco: MonacoThemeData;
  /** Three swatches shown in the picker: background, accent, text. */
  swatch: [string, string, string];
}

interface Palette {
  bg: string; bg2: string; bg3: string; fg: string; muted: string; accent: string; accentStrong: string;
  border: string; activity: string; success: string; warn: string; danger: string;
  dangerBg: string; dangerFg: string; successBg: string; warnBg: string;
}

function vars(p: Palette): Record<string, string> {
  return {
    '--bg': p.bg, '--bg2': p.bg2, '--bg3': p.bg3, '--fg': p.fg, '--muted': p.muted,
    '--accent': p.accent, '--accent-strong': p.accentStrong, '--border': p.border, '--activity': p.activity,
    '--success': p.success, '--warn': p.warn, '--danger': p.danger,
    '--danger-bg': p.dangerBg, '--danger-fg': p.dangerFg, '--success-bg': p.successBg, '--warn-bg': p.warnBg,
  };
}

const swiftRules = (c: { keyword: string; string: string; number: string; comment: string; type: string; fn: string }) => [
  { token: 'comment', foreground: c.comment, fontStyle: 'italic' },
  { token: 'keyword', foreground: c.keyword },
  { token: 'string', foreground: c.string },
  { token: 'number', foreground: c.number },
  { token: 'type', foreground: c.type },
  { token: 'type.identifier', foreground: c.type },
  { token: 'function', foreground: c.fn },
];

const editorColors = (bg: string, fg: string, line: string, sel: string, gutter: string, cursor: string) => ({
  'editor.background': bg,
  'editor.foreground': fg,
  'editorLineNumber.foreground': gutter,
  'editorLineNumber.activeForeground': fg,
  'editor.lineHighlightBackground': line,
  'editor.selectionBackground': sel,
  'editorCursor.foreground': cursor,
  'editorWidget.background': line,
  'editorIndentGuide.background1': line,
});

const hex = (s: string) => s.replace('#', '');

const MIDNIGHT: Palette = {
  bg: '#011627', bg2: '#0b2239', bg3: '#13304d', fg: '#d6deeb', muted: '#8aa0b8', accent: '#82aaff', accentStrong: '#2563c9',
  border: '#1d3b58', activity: '#010f1c', success: '#7fdbca', warn: '#ecc48d', danger: '#ff6b81',
  dangerBg: '#3a1a28', dangerFg: '#ffc1cc', successBg: '#0c3a35', warnBg: '#3b3217',
};
const MONOKAI: Palette = {
  bg: '#272822', bg2: '#2f302a', bg3: '#3e3d32', fg: '#f8f8f2', muted: '#a6a68f', accent: '#a6e22e', accentStrong: '#6f9a12',
  border: '#49483e', activity: '#1e1f1a', success: '#a6e22e', warn: '#e6db74', danger: '#f92672',
  dangerBg: '#40202c', dangerFg: '#ffb3cd', successBg: '#2c3a17', warnBg: '#3d3a1a',
};
const DRACULA: Palette = {
  bg: '#282a36', bg2: '#2f3242', bg3: '#3b3e52', fg: '#f8f8f2', muted: '#a3a9c9', accent: '#bd93f9', accentStrong: '#7c4fd0',
  border: '#44475a', activity: '#21222c', success: '#50fa7b', warn: '#f1fa8c', danger: '#ff5555',
  dangerBg: '#462631', dangerFg: '#ffb8b8', successBg: '#1f4030', warnBg: '#413f22',
};
const SOLAR_LIGHT: Palette = {
  bg: '#fdf6e3', bg2: '#f4ecd6', bg3: '#e8dfc4', fg: '#3b4b52', muted: '#6f7f84', accent: '#268bd2', accentStrong: '#1f6fa8',
  border: '#d9cfb2', activity: '#eee8d5', success: '#5d7a00', warn: '#a56a00', danger: '#c1302b',
  dangerBg: '#f9dcd6', dangerFg: '#8c1f1a', successBg: '#e5ecc4', warnBg: '#f6e6bb',
};

export const THEMES: ThemeDef[] = [
  {
    id: 'dark', label: 'Koyu', mode: 'dark', vars: {},
    terminal: { background: '#14161a', foreground: '#e6e6e6', cursor: '#e6e6e6' },
    monaco: { base: 'vs-dark', inherit: true, rules: [], colors: {} },
    swatch: ['#1e1e1e', '#5aa5ff', '#d9dde4'],
  },
  {
    id: 'light', label: 'Açık', mode: 'light', vars: {},
    terminal: { background: '#ffffff', foreground: '#1b1b1b', cursor: '#1b1b1b', selectionBackground: '#cfe3ff' },
    monaco: { base: 'vs', inherit: true, rules: [], colors: {} },
    swatch: ['#ffffff', '#1d5fd1', '#1c2330'],
  },
  {
    id: 'midnight', label: 'Gece mavisi', mode: 'dark', vars: vars(MIDNIGHT),
    terminal: { background: '#011627', foreground: '#d6deeb', cursor: '#80a4c2' },
    monaco: {
      base: 'vs-dark', inherit: true,
      rules: swiftRules({ keyword: hex('#c792ea'), string: hex('#ecc48d'), number: hex('#f78c6c'), comment: hex('#637777'), type: hex('#ffcb8b'), fn: hex('#82aaff') }),
      colors: editorColors('#011627', '#d6deeb', '#0b2239', '#1d3b53', '#4b6479', '#80a4c2'),
    },
    swatch: ['#011627', '#82aaff', '#d6deeb'],
  },
  {
    id: 'monokai', label: 'Monokai', mode: 'dark', vars: vars(MONOKAI),
    terminal: { background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0' },
    monaco: {
      base: 'vs-dark', inherit: true,
      rules: swiftRules({ keyword: hex('#f92672'), string: hex('#e6db74'), number: hex('#ae81ff'), comment: hex('#75715e'), type: hex('#66d9ef'), fn: hex('#a6e22e') }),
      colors: editorColors('#272822', '#f8f8f2', '#3e3d32', '#49483e', '#90908a', '#f8f8f0'),
    },
    swatch: ['#272822', '#a6e22e', '#f8f8f2'],
  },
  {
    id: 'dracula', label: 'Dracula', mode: 'dark', vars: vars(DRACULA),
    terminal: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2' },
    monaco: {
      base: 'vs-dark', inherit: true,
      rules: swiftRules({ keyword: hex('#ff79c6'), string: hex('#f1fa8c'), number: hex('#bd93f9'), comment: hex('#6272a4'), type: hex('#8be9fd'), fn: hex('#50fa7b') }),
      colors: editorColors('#282a36', '#f8f8f2', '#343746', '#44475a', '#6272a4', '#f8f8f2'),
    },
    swatch: ['#282a36', '#bd93f9', '#f8f8f2'],
  },
  {
    id: 'solarized-light', label: 'Solarized açık', mode: 'light', vars: vars(SOLAR_LIGHT),
    terminal: { background: '#fdf6e3', foreground: '#586e75', cursor: '#586e75', selectionBackground: '#eee8d5' },
    monaco: {
      base: 'vs', inherit: true,
      rules: swiftRules({ keyword: hex('#859900'), string: hex('#2aa198'), number: hex('#d33682'), comment: hex('#93a1a1'), type: hex('#b58900'), fn: hex('#268bd2') }),
      colors: editorColors('#fdf6e3', '#586e75', '#eee8d5', '#eee8d5', '#93a1a1', '#586e75'),
    },
    swatch: ['#fdf6e3', '#268bd2', '#586e75'],
  },
];

export const THEME_IDS: ThemeId[] = THEMES.map((t) => t.id);
export type ThemeChoice = 'system' | ThemeId;

export function themeById(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === 'system' || (typeof v === 'string' && (THEME_IDS as string[]).includes(v));
}

/** The theme to apply: "system" follows the OS light/dark preference. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeDef {
  if (choice === 'system') return themeById(prefersDark ? 'dark' : 'light');
  return themeById(choice);
}

/** Every CSS variable any theme sets, so a switch can clear the previous theme completely. */
export const THEME_VAR_NAMES: string[] = [...new Set(THEMES.flatMap((t) => Object.keys(t.vars)))];

/** Monaco theme name for a theme (built-ins for the two defaults). */
export function monacoThemeName(def: ThemeDef): string {
  if (def.id === 'dark') return 'vs-dark';
  if (def.id === 'light') return 'vs';
  return `ois-${def.id}`;
}
