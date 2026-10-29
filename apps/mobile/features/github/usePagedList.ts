import { useSessionReadFocusEffect } from "../auth/useSessionReadFocusEffect";
import { useCallback, useMemo, useState } from "react";
import { createPagedList, type ListPage } from "./pagedList";

export function usePagedList<T>(
  fetchPage: (page: number, signal: AbortSignal) => Promise<ListPage<T>>,
  itemKey: (item: T) => string | number,
  enabled: boolean,
) {
  const list = useMemo(() => createPagedList(fetchPage, itemKey), [fetchPage, itemKey]);
  const [view, setView] = useState(() => ({ list, state: list.snapshot() }));
  useSessionReadFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const unsubscribe = list.subscribe((state) => setView({ list, state }));
      void list.revalidate();
      return () => {
        unsubscribe();
        list.cancel();
      };
    }, [list, enabled]),
  );
  return { ...(view.list === list ? view.state : list.snapshot()), reload: list.refresh, more: list.more };
}
