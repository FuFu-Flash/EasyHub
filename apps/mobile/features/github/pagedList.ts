export interface ListPage<T> {
  items: T[];
  nextPage: number | null;
}
export interface PagedListState<T> {
  items: T[];
  nextPage: number | null;
  busy: boolean;
  loaded: boolean;
  failedPage: number | null;
}

/** Owns one list's requests, including transports that resolve after abort. */
export function createPagedList<T>(
  fetchPage: (page: number, signal: AbortSignal) => Promise<ListPage<T>>,
  itemKey: (item: T) => string | number,
) {
  let state: PagedListState<T> = { items: [], nextPage: 1, busy: false, loaded: false, failedPage: null };
  let generation = 0;
  let current: AbortController | null = null;
  let openedPages = 1;
  let failedRevalidation = false;
  const listeners = new Set<(value: PagedListState<T>) => void>();
  const publish = (patch: Partial<PagedListState<T>>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const cancel = () => {
    generation += 1;
    current?.abort();
    current = null;
    publish({ busy: false });
  };
  const load = async (page: number, window = 1) => {
    const request = generation;
    const controller = new AbortController();
    current = controller;
    const active = () => generation === request && current === controller && !controller.signal.aborted;
    publish({ busy: true, failedPage: null });
    let readingPage = page;
    try {
      const items = new Map((page === 1 ? [] : state.items).map((item) => [itemKey(item), item]));
      let nextPage: number | null = page;
      let lastPage = page;
      for (; readingPage < page + window; readingPage += 1) {
        const result = await fetchPage(readingPage, controller.signal);
        if (!active()) return;
        if (!Array.isArray(result.items) || (result.nextPage !== null && result.nextPage !== readingPage + 1))
          throw new Error("Invalid list pagination");
        for (const item of result.items) items.set(itemKey(item), item);
        lastPage = readingPage;
        nextPage = result.nextPage;
        if (nextPage === null) break;
      }
      openedPages = lastPage;
      failedRevalidation = false;
      publish({ items: [...items.values()], nextPage, loaded: true });
    } catch {
      if (active()) {
        failedRevalidation = window > 1;
        publish({ failedPage: readingPage });
      }
    } finally {
      if (active()) {
        current = null;
        publish({ busy: false });
      }
    }
  };
  return {
    snapshot: () => state,
    subscribe: (listener: (value: PagedListState<T>) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel,
    refresh: () => {
      cancel();
      openedPages = 1;
      failedRevalidation = false;
      return load(1);
    },
    // Returning to a retained page revalidates the entire window the reader opened.
    // Commit it together so failed/aborted later pages cannot mix old and new rows.
    revalidate: () => {
      cancel();
      return load(1, openedPages);
    },
    more: () => {
      const page = state.failedPage ?? state.nextPage;
      if (state.busy || page === null) return Promise.resolve();
      return failedRevalidation ? load(1, openedPages) : load(page);
    },
  };
}
