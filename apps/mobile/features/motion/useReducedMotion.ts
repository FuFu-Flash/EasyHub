import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

// Use the gentle path until the initial native preference has been read.
let reducedMotion = true;
const listeners = new Set<() => void>();
let stopObserving: (() => void) | null = null;

function update(value: boolean): void {
  if (reducedMotion === value) return;
  reducedMotion = value;
  for (const listener of listeners) listener();
}

function observe(): () => void {
  let active = true;
  let revision = 0;
  const refresh = (): void => {
    const current = ++revision;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active && revision === current) update(value);
    }).catch(() => { /* Keep the last preference if native accessibility is unavailable. */ });
  };
  const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
    if (!active) return;
    revision++;
    update(value);
  });
  const foreground = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
  refresh();
  return () => { active = false; revision++; preference.remove(); foreground.remove(); };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!stopObserving) stopObserving = observe();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stopObserving?.(); stopObserving = null; }
  };
}

/** One shared native preference subscription; updates never remount the navigator. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reducedMotion, () => true);
}
