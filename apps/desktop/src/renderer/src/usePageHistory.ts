import { useLayoutEffect, useRef, useState } from 'react';
import { NavigationHistory } from './navigationHistory';

export function usePageHistory(key: string, restore: () => void): { back: (fallback: () => void) => void; replace: (navigate: () => void) => void; prune: (isValid: (key: string) => boolean) => void; hasBack: boolean } {
  const history = useRef(new NavigationHistory());
  const [depth, setDepth] = useState(0);
  useLayoutEffect(() => { setDepth(history.current.record(key, restore)); });
  return {
    hasBack: depth > 0,
    back: (fallback) => { setDepth(history.current.back(fallback)); },
    replace: (navigate) => { history.current.replaceNext(); navigate(); },
    prune: (isValid) => { setDepth(history.current.prune(isValid)); },
  };
}
