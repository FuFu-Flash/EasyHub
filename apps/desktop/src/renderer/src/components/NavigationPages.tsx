import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

function Page({ active, host, children }: { active: boolean; host: HTMLDivElement | null; children: ReactNode }) {
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
  return createPortal(content.current, element.current);
}

/** Keep visited pages mounted in this account session, outside the DOM when away. */
export function NavigationPages({ active, children }: { active: string; children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const visited = useRef(new Set<string>());
  visited.current.delete(active);
  visited.current.add(active);
  // Fifty previous destinations plus the current page.
  while (visited.current.size > 51) visited.current.delete(visited.current.values().next().value!);
  return <div className="navigation-pages" ref={setHost} style={{ display: 'contents' }}>
    {[...visited.current].map((name) => <Page key={name} active={name === active} host={host}>{name === active ? children : null}</Page>)}
  </div>;
}
