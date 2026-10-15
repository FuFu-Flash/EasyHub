interface Page<T> { items: T[]; nextPage: number | null }
/** Revalidate the already-open window, rather than collapsing a long list to page 1. */
export async function readPageWindow<T>(first: () => Promise<Page<T>>, more: (page: number) => Promise<Page<T>>, through: number, identify: (item: T) => string | number): Promise<Page<T>> {
  let result = await first();
  const items = [...result.items], ids = new Set(items.map(identify)), seen = new Set<number>();
  while (result.nextPage && result.nextPage <= through && !seen.has(result.nextPage)) {
    seen.add(result.nextPage); result = await more(result.nextPage);
    for (const item of result.items) if (!ids.has(identify(item))) { ids.add(identify(item)); items.push(item); }
  }
  return { items, nextPage: result.nextPage };
}
