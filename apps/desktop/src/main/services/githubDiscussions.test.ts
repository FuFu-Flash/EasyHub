import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError } from '@easyhub/github';

describe('discussion and history pagination', () => {
  it('reads comments past 100, preserves abort and stops on a short page', async () => {
    const transport = vi.fn(async (url: string | URL) => Response.json(new URL(String(url)).searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 101 }]));
    const client = new GitHubClient(async () => 'test-token', transport);
    const signal = new AbortController().signal;
    expect((await client.commentsPage('owner', 'repo', 3, 1, signal)).nextPage).toBe(2);
    expect(await client.commentsPage('owner', 'repo', 3, 2, signal)).toEqual({ items: [{ id: 101 }], nextPage: null });
    expect(transport).toHaveBeenLastCalledWith('https://api.github.com/repos/owner/repo/issues/3/comments?per_page=100&page=2', expect.objectContaining({ signal, cache: 'no-store' }));
  });
  it('does not silently treat a failed page as an empty discussion', async () => {
    const client = new GitHubClient(async () => 'test-token', async () => new Response('', { status: 403 }));
    await expect(client.commentsPage('owner', 'repo', 3, 2)).rejects.toBeInstanceOf(GitHubError);
  });
  it('paginates history and handles an empty repository', async () => {
    const transport = vi.fn(async () => Response.json(Array.from({ length: 100 }, (_, i) => ({ sha: String(i) }))));
    const client = new GitHubClient(async () => 'test-token', transport);
    expect((await client.commitsPage('o', 'r', 2)).nextPage).toBe(3);
    expect(transport).toHaveBeenCalledWith('https://api.github.com/repos/o/r/commits?per_page=100&page=2', expect.anything());
    const empty = new GitHubClient(async () => 'test-token', async () => new Response('', { status: 409 }));
    expect(await empty.commitsPage('o', 'r')).toEqual({ items: [], nextPage: null });
    await expect(client.commitsPage('o', 'r', 0)).rejects.toThrow();
    await expect(client.commentsPage('o', 'r', 1, 1.5)).rejects.toThrow();
  });
});

describe('server-side discussion search', () => {
  it('searches all server pages with enforced repository, type and state', async () => {
    const transport = vi.fn(async (_url: string | URL) => Response.json({ total_count: 70, items: [{ id: 31, number: 301, title: 'old issue' }] }));
    const client = new GitHubClient(async () => 'test-token', transport);
    expect(await client.searchDiscussions('owner', 'repo', 'old issue', 'issue', 'closed', 2)).toMatchObject({ page: 2, totalCount: 70, hasNextPage: true, items: [{ number: 301 }] });
    const url = new URL(String(transport.mock.calls[0]![0]));
    expect(url.pathname).toBe('/search/issues'); expect(url.searchParams.get('q')).toBe('repo:owner/repo is:issue is:closed in:title "old issue"');
    expect(url.searchParams.get('page')).toBe('2');
  });
  it('looks up exact numbers and rejects mismatched issue/pr type or status', async () => {
    const transport = vi.fn(async () => Response.json({ id: 7, number: 7, state: 'open', pull_request: {} }));
    const client = new GitHubClient(async () => 'test-token', transport);
    expect((await client.searchDiscussions('o', 'r', '#7', 'pr', 'all')).items).toHaveLength(1);
    expect((await client.searchDiscussions('o', 'r', '7', 'issue', 'all')).items).toHaveLength(0);
    expect((await client.searchDiscussions('o', 'r', '#7', 'pr', 'closed')).items).toHaveLength(0);
    expect(transport).toHaveBeenCalledWith('https://api.github.com/repos/o/r/issues/7', expect.anything());
  });
  it('treats a missing number as no match, while surfacing API errors', async () => {
    const client = new GitHubClient(async () => 'test-token', async () => new Response('', { status: 404 }));
    expect((await client.searchDiscussions('o', 'r', '#999', 'issue', 'all')).totalCount).toBe(0);
    await expect(client.searchDiscussions('o', 'r', '', 'issue', 'all')).rejects.toThrow();
  });
});
