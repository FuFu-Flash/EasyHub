import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
type Direction = 'back' | 'forward';
interface NestedHistory { scope: RefObject<HTMLElement | null>; back: (() => void) | null; forward: (() => void) | null; blocked: boolean }
const histories = new Set<RefObject<NestedHistory>>();
/** The most deeply visible page owns its history before the workspace does. */
export function navigateNested(direction: Direction): boolean {
  let selected: NestedHistory | null = null;
  for (const ref of histories) {
    const entry = ref.current;
    if (!entry?.scope.current?.isConnected || !entry[direction] && !entry.blocked) continue;
    if (!selected || selected.scope.current?.contains(entry.scope.current)) selected = entry;
  }
  if (!selected) return false;
  if (!selected.blocked) selected[direction]?.();
  return true;
}
export function useNestedNavigation(scope: RefObject<HTMLElement | null>, back: (() => void) | null, forward: (() => void) | null, blocked = false): void {
  const entry = useRef({ scope, back, forward, blocked }); entry.current = { scope, back, forward, blocked };
  useEffect(() => { histories.add(entry); return () => { histories.delete(entry); }; }, []);
}
