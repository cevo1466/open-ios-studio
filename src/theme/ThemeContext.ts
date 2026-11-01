import { createContext, useContext } from 'react';
import { themeById, type ThemeDef } from './themes';

/** The active theme. Components fall back to the plain light/dark theme when no provider is mounted (unit tests). */
export const ThemeContext = createContext<ThemeDef | null>(null);

export function useThemeDef(mode: 'light' | 'dark'): ThemeDef {
  return useContext(ThemeContext) ?? themeById(mode);
}
