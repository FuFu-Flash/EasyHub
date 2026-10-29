import { useSyncExternalStore } from 'react';

export type LayoutPreference = 'auto' | 'comfortable' | 'compact';
export type LayoutDensity = Exclude<LayoutPreference, 'auto'>;

export const LAYOUT_PREFERENCE_KEY = 'easyhub:layout-preference';
export const COMPACT_LAYOUT_QUERY = '(max-width: 1180px), (max-height: 760px)';

export function parseLayoutPreference(value: unknown): LayoutPreference {
  return value === 'comfortable' || value === 'compact' ? value : 'auto';
}

export function readLayoutPreference(): LayoutPreference {
  try {
    return parseLayoutPreference(window.localStorage.getItem(LAYOUT_PREFERENCE_KEY));
  } catch {
    return 'auto';
  }
}

export function resolveLayoutDensity(preference: LayoutPreference, compactWindow: boolean): LayoutDensity {
  return preference === 'auto' ? (compactWindow ? 'compact' : 'comfortable') : preference;
}

// One preference per window: every component that reads the layout (the workspace, the window buttons that
// position the macOS traffic lights) sees a change made anywhere else in the same window right away.
const listeners = new Set<() => void>();
let shared: LayoutPreference | null = null;

function currentPreference(): LayoutPreference {
  shared ??= readLayoutPreference();
  return shared;
}

function publish(next: LayoutPreference): void {
  if (next === currentPreference()) return;
  shared = next;
  for (const listener of listeners) listener();
}

function subscribePreference(listener: () => void): () => void {
  listeners.add(listener);
  // Another window changing the saved layout arrives as a storage event.
  const onStorage = (event: StorageEvent): void => {
    if (event.key === LAYOUT_PREFERENCE_KEY || event.key === null) publish(readLayoutPreference());
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setLayoutPreference(next: LayoutPreference): void {
  publish(next);
  try {
    window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, next);
  } catch {
    /* The selected layout can still apply for this session. */
  }
}

function subscribeCompactWindow(listener: () => void): () => void {
  const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}

const compactWindowNow = (): boolean => window.matchMedia(COMPACT_LAYOUT_QUERY).matches;

export function useLayoutPreference(): {
  preference: LayoutPreference;
  density: LayoutDensity;
  setPreference: (preference: LayoutPreference) => void;
} {
  const preference = useSyncExternalStore(subscribePreference, currentPreference);
  const compactWindow = useSyncExternalStore(subscribeCompactWindow, compactWindowNow);
  return { preference, density: resolveLayoutDensity(preference, compactWindow), setPreference: setLayoutPreference };
}
