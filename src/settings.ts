export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemeChoice;
  fontSize: number;
}

const KEY = 'open-ios-studio.settings.v1';
export const defaultSettings: Settings = { theme: 'system', fontSize: 14 };

export function parseSettings(raw: string | null): Settings {
  if (!raw) return defaultSettings;
  try {
    const v = JSON.parse(raw) as Partial<Settings>;
    const theme = v.theme === 'light' || v.theme === 'dark' || v.theme === 'system' ? v.theme : 'system';
    const size = typeof v.fontSize === 'number' ? Math.min(28, Math.max(10, Math.round(v.fontSize))) : 14;
    return { theme, fontSize: size };
  } catch {
    return defaultSettings;
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY));
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

export function effectiveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  return choice === 'system' ? (prefersDark ? 'dark' : 'light') : choice;
}
