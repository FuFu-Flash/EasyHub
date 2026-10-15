import type { RefObject } from 'react';
import { useLayoutEffect,useState } from 'react';
import type { Language } from '../i18n';
/** Observe page attachment as well as async data; both modes use the same shell. */
export function useShellEffects(root: RefObject<HTMLDivElement | null>, area: RefObject<HTMLDivElement | null>, language: Language, pageKey: string) {
  const [canScrollDown, setCanScrollDown] = useState(false);
  useLayoutEffect(() => { document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'; }, [language]);
  useLayoutEffect(() => {
    const element = area.current; if (!element) return;
    const update = () => setCanScrollDown(element.scrollTop === 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 3);
    const resize = new ResizeObserver(update); resize.observe(element);
    const watch = () => { const content = element.querySelector('.page-content'); if (content) resize.observe(content); update(); };
    const observer = new MutationObserver(watch); observer.observe(element, { childList: true, subtree: true }); element.addEventListener('scroll', update, { passive: true }); watch();
    return () => { resize.disconnect(); observer.disconnect(); element.removeEventListener('scroll', update); };
  }, [area, pageKey]);
  return canScrollDown;
}
export async function finishRefresh(icon: SVGSVGElement | null, started: number) {
  const remaining = 1200 - (performance.now() - started); if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
  const rotation = icon?.getAnimations().find(animation => animation instanceof CSSAnimation && animation.animationName === 'live-spin' && animation.playState === 'running');
  const duration = rotation?.effect?.getComputedTiming().duration;
  if (icon?.isConnected && rotation && typeof duration === 'number' && duration > 0) await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); icon.removeEventListener('animationiteration', iteration); rotation.removeEventListener('cancel', finish); resolve(); };
    const iteration = (event: AnimationEvent) => { if (event.target === icon && event.animationName === 'live-spin') finish(); };
    const timer = setTimeout(finish, duration + 150); icon.addEventListener('animationiteration', iteration); rotation.addEventListener('cancel', finish);
  });
}
