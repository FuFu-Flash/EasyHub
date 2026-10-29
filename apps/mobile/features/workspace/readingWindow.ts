import type { ListPage } from "../github/pagedList";

/** Re-read an opened window atomically; callers retain their old rows until this settles. */
export async function readListWindow<T>(
  fetchPage: (page: number, signal: AbortSignal) => Promise<ListPage<T>>,
  openedPages: number,
  key: (item: T) => string | number,
  signal: AbortSignal,
) {
  const items = new Map<string | number, T>();
  let nextPage: number | null = 1;
  let pages = 0;
  for (let page = 1; page <= Math.max(1, openedPages); page += 1) {
    if (signal.aborted) {
      const error = new Error("Reading window cancelled");
      error.name = "AbortError";
      throw error;
    }
    const result = await fetchPage(page, signal);
    if (signal.aborted) {
      const error = new Error("Reading window cancelled");
      error.name = "AbortError";
      throw error;
    }
    if (!Array.isArray(result.items) || (result.nextPage !== null && result.nextPage !== page + 1))
      throw new Error("Invalid reading window pagination");
    for (const item of result.items) items.set(key(item), item);
    pages = page;
    nextPage = result.nextPage;
    if (nextPage === null) break;
  }
  return { items: [...items.values()], nextPage, pages };
}
