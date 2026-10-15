import { useContext, useRef } from 'react';
import { PageActivityContext } from '../components/NavigationPages';
import { useWorkspace } from './WorkspaceContext';
/** A completed request on a retained, hidden page must not notify another page. */
export function usePageFeedback() {
  const { setNotice, setError } = useWorkspace();
  const active = useContext(PageActivityContext),
    current = useRef(active);
  current.current = active;
  return {
    setNotice: (text: string | null) => {
      if (current.current) setNotice(text);
    },
    setError: (text: string) => {
      if (current.current) setError(text);
    },
  };
}
