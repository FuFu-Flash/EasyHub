import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppErrorBoundary } from './AppErrorBoundary';

export const PageActivityContext = createContext(true);

function Page({ active, host, children }: { active: boolean; host: HTMLDivElement | null; children: ReactNode }) {
  const parentActive = useContext(PageActivityContext);
  const element = useRef<HTMLDivElement | null>(null);
  const content = useRef<ReactNode>(null);
  if (!element.current) {
    element.current = document.createElement('div');
    element.current.style.display = 'contents';
  }
  if (active) content.current = children;
  useLayoutEffect(() => {
    const container = element.current!;
    if (active && host) host.append(container);
    else container.remove();
    return () => container.remove();
  }, [active, host]);
  return createPortal(<PageActivityContext.Provider value={active && parentActive}>{content.current}</PageActivityContext.Provider>, element.current);
}

/** Keep visited pages mounted in this account session, outside the DOM when away. */
export function NavigationPages({ active, children, onHome }: { active: string; children: ReactNode; onHome?: () => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const visited = useRef(new Set<string>());
  visited.current.delete(active);
  visited.current.add(active);
  // Fifty previous destinations plus the current page.
  while (visited.current.size > 51) visited.current.delete(visited.current.values().next().value!);
  return <div className="navigation-pages" ref={setHost} style={{ display: 'contents' }}>
    {[...visited.current].map((name) => <Page key={name} active={name === active} host={host}>{name === active ? <AppErrorBoundary scope={`page:${name}`} onHome={onHome}>{children}</AppErrorBoundary> : null}</Page>)}
  </div>;
}
