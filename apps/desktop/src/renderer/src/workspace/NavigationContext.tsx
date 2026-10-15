import type { ReactNode,RefObject } from 'react';
import { createContext,useContext,useLayoutEffect,useReducer,useRef } from 'react';
import type { Destination,PageParams,Section,View } from './navigation';
import { initialNavigation,navigationReducer,pageIdentity,sectionOf } from './navigation';

function useNavigationController(scrollArea: RefObject<HTMLDivElement | null>) {
  const [state, dispatch] = useReducer(navigationReducer, undefined, initialNavigation);
  const page = state.entries[state.index]!;
  const key = pageIdentity(page);
  // Embedded readers own their tab/detail scroll. Reporting that identifier must
  // not start a second restoration over the reader's own scroll restoration.
  const scrollKey = pageIdentity({ view: page.view, params: { ...page.params, nestedKey: undefined, outerBoundary: undefined } });
  const restoring = useRef(false);
  const position = () => restoring.current ? page.scrollTop : scrollArea.current?.scrollTop ?? page.scrollTop;
  useLayoutEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    const target = page.scrollTop; restoring.current = true;
    const restore = () => { if (restoring.current) { area.scrollTop = target; if (Math.abs(area.scrollTop - target) < 2) restoring.current = false; } };
    const stop = () => { restoring.current = false; };
    const keyboard = (event: KeyboardEvent) => { if (!(event.target instanceof HTMLElement && event.target.closest('input,textarea,select')) && ['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)) stop(); };
    const observer = new MutationObserver(restore), resize = new ResizeObserver(restore);
    observer.observe(area, { childList: true, subtree: true }); resize.observe(area);
    let frame = 0; const changed = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); };
    const contentObserver = new ResizeObserver(changed);
    const content = area.querySelector('.navigation-pages'); if (content) contentObserver.observe(content);
    restore(); frame = requestAnimationFrame(restore);
    area.addEventListener('wheel', stop, { passive: true }); area.addEventListener('touchstart', stop, { passive: true }); area.addEventListener('keydown', keyboard);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); contentObserver.disconnect(); area.removeEventListener('wheel', stop); area.removeEventListener('touchstart', stop); area.removeEventListener('keydown', keyboard); };
  }, [scrollKey, state.index, scrollArea]);
  return { page, key, section: sectionOf(page), scrollArea, hasBack: state.index > 0, hasForward: state.index < state.entries.length - 1,
    navigate: (view: View, params: PageParams = {}, replace = false) => dispatch({ type: 'visit', page: { view, params, scrollTop: 0 }, replace, scrollTop: position() }),
    updateParams: (params: Partial<PageParams>, resetScroll = false) => dispatch({ type: 'params', params, resetScroll, scrollTop: position() }),
    sidebar: (section: Section) => dispatch({ type: 'sidebar', section, scrollTop: position() }),
    back: (fallback: View = 'home') => state.index > 0 ? dispatch({ type: 'move', delta: -1, scrollTop: position() }) : dispatch({ type: 'visit', page: { view: fallback, params: {}, scrollTop: 0 }, replace: true, scrollTop: position() }),
    forward: () => dispatch({ type: 'move', delta: 1, scrollTop: position() }),
    removeRepository: (repo: string) => dispatch({ type: 'remove-repository', repo }),
  };
}
const NavigationContext = createContext<ReturnType<typeof useNavigationController> | null>(null);
export const PageRouteContext = createContext<Destination>({ view: 'home', params: {}, scrollTop: 0 });
export function NavigationProvider({ children, scrollArea }: { children: ReactNode; scrollArea: RefObject<HTMLDivElement | null> }) {
  const value = useNavigationController(scrollArea);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
export function useWorkspaceNavigation() { const value = useContext(NavigationContext); if (!value) throw new Error('Workspace navigation is unavailable'); return value; }
export const usePageRoute = () => useContext(PageRouteContext);
