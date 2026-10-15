import { describe, expect, it, vi } from 'vitest';
import { readPageWindow } from './pageWindow';
describe('revalidating a paged reading window', () => {
  it('retains loaded pages, removes duplicate identities and returns the next unread page', async () => {
    const more = vi.fn(async (page: number) =>
      page === 2 ? { items: [{ id: 2 }, { id: 3 }], nextPage: 3 } : { items: [{ id: 4 }], nextPage: 4 },
    );
    const result = await readPageWindow(
      async () => ({ items: [{ id: 1 }, { id: 2 }], nextPage: 2 }),
      more,
      3,
      (item) => item.id,
    );
    expect(result).toEqual({ items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], nextPage: 4 });
    expect(more.mock.calls).toEqual([[2], [3]]);
  });
  it('an explicit first-page refresh does not replay every previously loaded page', async () => {
    const more = vi.fn();
    expect(
      await readPageWindow(
        async () => ({ items: [1], nextPage: 2 }),
        more,
        1,
        (item) => item,
      ),
    ).toEqual({ items: [1], nextPage: 2 });
    expect(more).not.toHaveBeenCalled();
  });
  it('stops when removed content makes the refreshed window shorter', async () => {
    const more = vi.fn();
    expect(
      await readPageWindow(
        async () => ({ items: [], nextPage: null }),
        more,
        4,
        (item) => String(item),
      ),
    ).toEqual({ items: [], nextPage: null });
    expect(more).not.toHaveBeenCalled();
  });
});
