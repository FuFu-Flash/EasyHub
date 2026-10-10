export interface ListPage<T> { items: T[]; nextPage: number | null }
export interface PagedListState<T> { items: T[]; nextPage: number | null; busy: boolean; loaded: boolean; failedPage: number | null }

/** Owns one list's requests, including transports that resolve after abort. */
export function createPagedList<T>(fetchPage: (page: number, signal: AbortSignal) => Promise<ListPage<T>>, itemKey: (item: T) => string | number) {
  let state: PagedListState<T> = { items: [], nextPage: 1, busy: false, loaded: false, failedPage: null };
  let generation = 0;
  let current: AbortController | null = null;
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
  const load = async (page: number) => {
    const request = generation;
    const controller = new AbortController();
    current = controller;
    const active = () => generation === request && current === controller && !controller.signal.aborted;
    publish({ busy: true, failedPage: null });
    try {
      const result = await fetchPage(page, controller.signal);
      if (!active()) return;
      if (!Array.isArray(result.items) || result.nextPage !== null && result.nextPage !== page + 1) throw new Error('Invalid list pagination');
      const items = new Map((page === 1 ? [] : state.items).map((item) => [itemKey(item), item]));
      for (const item of result.items) items.set(itemKey(item), item);
      publish({ items: [...items.values()], nextPage: result.nextPage, loaded: true });
    } catch { if (active()) publish({ failedPage: page }); }
    finally {
      if (active()) { current = null; publish({ busy: false }); }
    }
  };
  return {
    snapshot: () => state,
    subscribe: (listener: (value: PagedListState<T>) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel,
    refresh: () => { cancel(); return load(1); },
    more: () => {
      const page = state.failedPage ?? state.nextPage;
      return !state.busy && page !== null ? load(page) : Promise.resolve();
    },
  };
}
