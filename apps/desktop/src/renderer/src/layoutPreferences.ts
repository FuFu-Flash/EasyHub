import { useCallback, useEffect, useState } from 'react';

export type LayoutPreference = 'auto' | 'comfortable' | 'compact';
export type LayoutDensity = Exclude<LayoutPreference, 'auto'>;

export const LAYOUT_PREFERENCE_KEY = 'easyhub:layout-preference';
export const COMPACT_LAYOUT_QUERY = '(max-width: 1180px), (max-height: 760px)';

export function parseLayoutPreference(value: unknown): LayoutPreference {
  return value === 'comfortable' || value === 'compact' ? value : 'auto';
}

export function readLayoutPreference(): LayoutPreference {
  try { return parseLayoutPreference(window.localStorage.getItem(LAYOUT_PREFERENCE_KEY)); }
  catch { return 'auto'; }
}

export function resolveLayoutDensity(preference: LayoutPreference, compactWindow: boolean): LayoutDensity {
  return preference === 'auto' ? compactWindow ? 'compact' : 'comfortable' : preference;
}

export function useLayoutPreference(): {
  preference: LayoutPreference;
  density: LayoutDensity;
  setPreference: (preference: LayoutPreference) => void;
} {
  const [preference, updatePreference] = useState(readLayoutPreference);
  const [compactWindow, setCompactWindow] = useState(() => window.matchMedia(COMPACT_LAYOUT_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const onResize = (event: MediaQueryListEvent): void => setCompactWindow(event.matches);
    const onStorage = (event: StorageEvent): void => {
      if (event.key === LAYOUT_PREFERENCE_KEY || event.key === null) updatePreference(readLayoutPreference());
    };
    setCompactWindow(media.matches);
    media.addEventListener('change', onResize);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener('change', onResize);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setPreference = useCallback((next: LayoutPreference): void => {
    updatePreference(next);
    try { window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, next); }
    catch { /* The selected layout can still apply for this session. */ }
  }, []);

  return { preference, density: resolveLayoutDensity(preference, compactWindow), setPreference };
}
