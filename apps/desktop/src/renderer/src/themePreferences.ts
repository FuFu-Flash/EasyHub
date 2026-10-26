import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = Exclude<ThemePreference, 'system'>;

export const THEME_PREFERENCE_KEY = 'easyhub:theme-preference';
export const DARK_THEME_QUERY = '(prefers-color-scheme: dark)';
const THEME_CHANGE_EVENT = 'easyhub:theme-preference-change';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_PREFERENCE_KEY));
  } catch {
    return 'system';
  }
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

function applyTheme(): void {
  const theme = resolveTheme(readThemePreference(), window.matchMedia(DARK_THEME_QUERY).matches);
  document.documentElement.dataset.theme = theme;
}

/** Applies the saved theme before the first paint and keeps it in step with the system and other windows. */
export function startThemeSync(): void {
  applyTheme();
  window.matchMedia(DARK_THEME_QUERY).addEventListener('change', applyTheme);
  window.addEventListener(THEME_CHANGE_EVENT, applyTheme);
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_PREFERENCE_KEY || event.key === null) applyTheme();
  });
}

export function useThemePreference(): {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, updatePreference] = useState(readThemePreference);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === THEME_PREFERENCE_KEY || event.key === null) updatePreference(readThemePreference());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference): void => {
    updatePreference(next);
    try {
      window.localStorage.setItem(THEME_PREFERENCE_KEY, next);
    } catch {
      /* The chosen theme still applies for this session. */
      document.documentElement.dataset.theme = resolveTheme(next, window.matchMedia(DARK_THEME_QUERY).matches);
      return;
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return { preference, setPreference };
}
