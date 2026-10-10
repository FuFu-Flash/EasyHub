import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/** Account-session page positions; delayed content is allowed to grow before restoration. */
export function usePageScroll(key: string, areaRef: RefObject<HTMLDivElement | null>, isActive: () => boolean = () => true): () => void {
  const positions = useRef(new Map<string, number>());
  const current = useRef(key);
  const restoring = useRef(false);
  const active = useRef(isActive);
  active.current = isActive;
  const remember = (): void => {
    if (active.current() && !restoring.current && areaRef.current) positions.current.set(current.current, areaRef.current.scrollTop);
  };
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const save = (): void => {
      if (active.current() && !restoring.current) positions.current.set(current.current, area.scrollTop);
    };
    area.addEventListener('scroll', save, { passive: true });
    return () => area.removeEventListener('scroll', save);
  }, [areaRef]);
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    current.current = key;
    const target = positions.current.get(key) ?? 0;
    restoring.current = true;
    const restore = (): void => {
      if (!active.current() || !restoring.current || !area.querySelector('.page-content')) return;
      area.scrollTop = target;
      if (Math.abs(area.scrollTop - target) < 2) restoring.current = false;
    };
    const stop = (): void => { restoring.current = false; };
    const keyDown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) stop();
    };
    const observer = new ResizeObserver(restore);
    let content: Element | null = null;
    const observeContent = (): void => {
      const next = area.querySelector('.page-content');
      if (content !== next) {
        if (content) observer.unobserve(content);
        content = next;
        if (content) observer.observe(content);
      }
      restore();
    };
    // Portals attach after child layout effects; cached pages also replace this node.
    const mutations = new MutationObserver(observeContent);
    mutations.observe(area, { childList: true, subtree: true });
    observeContent();
    area.addEventListener('wheel', stop, { passive: true });
    area.addEventListener('touchstart', stop, { passive: true });
    area.addEventListener('pointerdown', stop, { passive: true });
    area.addEventListener('keydown', keyDown);
    restore();
    return () => {
      observer.disconnect();
      mutations.disconnect();
      area.removeEventListener('wheel', stop);
      area.removeEventListener('touchstart', stop);
      area.removeEventListener('pointerdown', stop);
      area.removeEventListener('keydown', keyDown);
    };
  }, [key, areaRef]);
  return remember;
}
