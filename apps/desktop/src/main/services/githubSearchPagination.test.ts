import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '@easyhub/github';

describe('GitHub search pagination', () => {
  it('fetches later repository pages with counts and preserves public filtering', async () => {
    const transport = vi.fn(async () => Response.json({ total_count: 75, incomplete_results: false, items: [
      { id: 31, name: 'next-project', private: false }, { id: 32, name: 'private-project', private: true },
    ] }));
    const client = new GitHubClient(async () => 'test-token', transport);
    const signal = new AbortController().signal;
    const page = await client.searchPublicReposPage('react', 2, signal);
    expect(page).toEqual({ items: [{ id: 31, name: 'next-project', private: false }], totalCount: 75, page: 2, hasNextPage: true, incompleteResults: false });
    expect(transport).toHaveBeenCalledWith('https://api.github.com/search/repositories?q=react%20is%3Apublic&per_page=30&page=2', expect.objectContaining({ signal }));
  });

  it('stops when all matching users have been shown and excludes organizations', async () => {
    const transport = vi.fn(async () => Response.json({ total_count: 14, incomplete_results: true, items: [
      { id: 13, login: 'next-user', type: 'User' }, { id: 14, login: 'unexpected-org', type: 'Organization' },
    ] }));
    const client = new GitHubClient(async () => 'test-token', transport);
    expect(await client.searchUsersPage('john', 2)).toEqual({ items: [{ id: 13, login: 'next-user', type: 'User' }], totalCount: 14, page: 2, hasNextPage: false, incompleteResults: true });
    expect(transport).toHaveBeenCalledWith('https://api.github.com/search/users?q=john%20type%3Auser&per_page=12&page=2', expect.anything());
  });

  it('caps paging at the 1000 searchable results without advertising an unreachable next page', async () => {
    const transport = vi.fn(async () => Response.json({ total_count: 9000, items: Array.from({ length: 30 }, (_, id) => ({ id, private: false, type: 'User' })) }));
    const client = new GitHubClient(async () => 'test-token', transport);
    expect(await client.searchPublicReposPage('react', 34)).toMatchObject({ hasNextPage: false, totalCount: 9000 });
    expect((await client.searchPublicReposPage('react', 34)).items).toHaveLength(10);
    expect((await client.searchUsersPage('john', 84)).items).toHaveLength(4);
    await expect(client.searchPublicReposPage('react', 35)).rejects.toThrow('Invalid search page');
    await expect(client.searchUsersPage('john', 85)).rejects.toThrow('Invalid search page');
    await expect(client.searchUsersPage('john', 0)).rejects.toThrow('Invalid search page');
    await expect(client.searchPublicReposPage('react', 1.5)).rejects.toThrow('Invalid search page');
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('does not loop through empty or missing-total responses', async () => {
    const client = new GitHubClient(async () => 'test-token', async () => Response.json({ total_count: 500, items: [] }));
    expect(await client.searchPublicReposPage('empty', 2)).toMatchObject({ items: [], hasNextPage: false });
    const missing = new GitHubClient(async () => 'test-token', async () => Response.json({ items: [{ id: 1, private: false }] }));
    expect(await missing.searchPublicReposPage('short', 2)).toMatchObject({ totalCount: 31, hasNextPage: false });
  });
});
