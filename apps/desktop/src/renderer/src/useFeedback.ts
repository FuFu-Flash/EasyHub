import { useCallback, useLayoutEffect, useRef, useState } from 'react';
export function useFeedback(page: string) {
  const [notice, updateNotice] = useState('');
  const [error, updateError] = useState('');
  const currentPage = useRef(page);
  currentPage.current = page;
  useLayoutEffect(() => {
    updateNotice('');
    updateError('');
  }, [page]);
  // Late operations from another destination cannot leave a banner on this page.
  const setNotice = useCallback(
    (text: string | null) => {
      if (currentPage.current === page) updateNotice(text ?? '');
    },
    [page],
  );
  const setError = useCallback(
    (text: string) => {
      if (currentPage.current === page) updateError(text);
    },
    [page],
  );
  return { notice, error, setNotice, setError };
}
