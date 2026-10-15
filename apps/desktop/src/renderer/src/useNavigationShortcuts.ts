import { useEasyHub } from './bridge';
import { useEffect, useRef } from 'react';
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
      if (event.isComposing || event.defaultPrevented) return;
      const direction = event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'ArrowLeft' || event.metaKey && event.key === '[' ? 'back'
        : event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'ArrowRight' || event.metaKey && event.key === ']' ? 'forward' : null;
      if (direction) { event.preventDefault(); navigate(direction); }
    };
    const mouse = (event: MouseEvent): void => { if (event.button === 3 || event.button === 4) { event.preventDefault(); navigate(event.button === 3 ? 'back' : 'forward'); } };
    window.addEventListener('keydown', key); window.addEventListener('mouseup', mouse);
    const unsubscribe = easyHub?.onNavigate?.(navigate);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mouseup', mouse); unsubscribe?.(); };
  }, []);
}
