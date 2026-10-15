import { useEasyHub } from './bridge';
import { useEffect, useRef } from 'react';
type ShortcutKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'defaultPrevented'>;
export function navigationShortcut(event: ShortcutKey, platform: string, editing: boolean): 'back' | 'forward' | null {
  if (editing || event.isComposing || event.defaultPrevented || event.shiftKey) return null;
  if (/darwin|mac/i.test(platform)) {
    if (!event.metaKey || event.altKey || event.ctrlKey) return null;
    return event.key === '[' ? 'back' : event.key === ']' ? 'forward' : null;
  }
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  return event.key === 'ArrowLeft' ? 'back' : event.key === 'ArrowRight' ? 'forward' : null;
}

function editingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || Boolean(target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')));
}
export function useNavigationShortcuts(back: () => void, forward: () => void): void {
  const easyHub = useEasyHub();
  const actions = useRef({ back, forward }); actions.current = { back, forward };
  useEffect(() => {
    let last = { direction: '', time: 0 };
    const navigate = (direction: 'back' | 'forward'): void => {
      if (document.querySelector('[aria-modal="true"]')) return;
      const now = performance.now();
      if (last.direction === direction && now - last.time < 100) return;
      last = { direction, time: now }; actions.current[direction]();
    };
    const key = (event: KeyboardEvent): void => {
      const editing = event.composedPath().some(editingTarget) || editingTarget(document.activeElement);
      const direction = navigationShortcut(event, easyHub?.platform ?? navigator.platform, editing);
      if (direction) { event.preventDefault(); navigate(direction); }
    };
    const mouse = (event: MouseEvent): void => { if (event.button === 3 || event.button === 4) { event.preventDefault(); navigate(event.button === 3 ? 'back' : 'forward'); } };
    window.addEventListener('keydown', key); window.addEventListener('mouseup', mouse);
    const unsubscribe = easyHub?.onNavigate?.(navigate);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mouseup', mouse); unsubscribe?.(); };
  }, []);
}
