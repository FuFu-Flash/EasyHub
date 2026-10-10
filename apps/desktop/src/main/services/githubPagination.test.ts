import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '@easyhub/github';

describe('Android discovery and discussion pagination', () => {
  it('keeps public search results within GitHub’s 1,000-result limit and preserves incomplete metadata', async () => {
    const transport = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json({
      items: Array.from({ length: 30 }, (_, id) => ({ id, private: id === 0 })), total_count: 2000, incomplete_results: true,
    }));
    const client = new GitHubClient(async () => 'token', transport);
    const signal = new AbortController().signal;
    const result = await client.searchPublicReposPage(' 中文 项目 ', 34, signal);
    expect(result.items.map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result).toMatchObject({ page: 34, totalCount: 2000, hasNextPage: false, incompleteResults: true });
    const url = new URL(String(transport.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe('中文 项目 is:public');
    expect(url.searchParams.get('page')).toBe('34');
    expect(transport.mock.calls[0]?.[1]?.signal).toBe(signal);
    await expect(client.searchPublicReposPage('title', 35)).rejects.toThrow('Invalid search page');
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('paginates people independently and filters organization accounts', async () => {
    const transport = vi.fn(async (_input: string | URL) => Response.json({ items: [{ id: 1, type: 'Organization' }, { id: 2, type: 'User' }], total_count: 29 }));
    const client = new GitHubClient(async () => 'token', transport);
    const result = await client.searchUsersPage('developer', 2);
    expect(result.items.map((item) => item.id)).toEqual([2]);
    expect(result).toMatchObject({ page: 2, totalCount: 29, hasNextPage: true });
    const url = new URL(String(transport.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe('developer type:user');
    expect(url.searchParams.get('per_page')).toBe('12');
    await expect(client.searchUsersPage('developer', 85)).rejects.toThrow();
  });

  it('looks up #numbers directly and honors both discussion kind and state', async () => {
    const transport = vi.fn(async (_input: string | URL) => Response.json({ id: 7, number: 7, title: 'Review', state: 'closed', pull_request: {} }));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.searchDiscussions('writer', 'app', '#7', 'pr', 'closed')).items).toHaveLength(1);
    expect((await client.searchDiscussions('writer', 'app', '7', 'issue', 'all')).items).toEqual([]);
    expect((await client.searchDiscussions('writer', 'app', '#7', 'pr', 'open')).totalCount).toBe(0);
    expect(transport.mock.calls.every(([url]) => url === 'https://api.github.com/repos/writer/app/issues/7')).toBe(true);
  });

  it('keeps title searches scoped to one repository and prevents query qualifiers escaping the title', async () => {
    const transport = vi.fn(async (_input: string | URL) => Response.json({ items: [{ id: 1, pull_request: {} }, { id: 2 }], total_count: 61 }));
    const client = new GitHubClient(async () => 'token', transport);
    const result = await client.searchDiscussions('writer', 'app', 'fix" repo:another\\name\n', 'issue', 'closed', 2);
    expect(result.items.map((item) => item.id)).toEqual([2]);
    expect(result.hasNextPage).toBe(true);
    const url = new URL(String(transport.mock.calls[0]?.[0]));
    expect(url.searchParams.get('q')).toBe('repo:writer/app is:issue is:closed in:title "fix  repo:another name"');
    expect(url.searchParams.get('page')).toBe('2');
    await expect(client.searchDiscussions('writer is:public', 'app', 'fix', 'issue', 'all')).rejects.toThrow();
    await expect(client.searchDiscussions('writer', 'app', '#9007199254740992', 'issue', 'all')).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('treats a missing numbered discussion as empty but keeps authorization failures retryable', async () => {
    const missing = new GitHubClient(async () => 'token', async () => new Response('', { status: 404 }));
    expect(await missing.searchDiscussions('writer', 'app', '#9', 'issue', 'all')).toMatchObject({ items: [], totalCount: 0, hasNextPage: false });
    const forbidden = new GitHubClient(async () => 'token', async () => new Response('', { status: 403 }));
    await expect(forbidden.searchDiscussions('writer', 'app', '#9', 'issue', 'all')).rejects.toMatchObject({ status: 403 });
  });

  it('continues comments and reviews past 100 and stops after the last short page', async () => {
    const transport = vi.fn(async (input: string | URL, _init?: RequestInit) => Response.json(Array.from({ length: new URL(String(input)).searchParams.get('page') === '1' ? 100 : 1 }, (_, id) => ({ id }))));
    const client = new GitHubClient(async () => 'token', transport);
    const signal = new AbortController().signal;
    expect((await client.commentsPage('writer', 'app', 7, 1, signal)).nextPage).toBe(2);
    expect((await client.commentsPage('writer', 'app', 7, 2, signal)).nextPage).toBeNull();
    expect((await client.pullReviewsPage('writer', 'app', 7, 1, signal)).nextPage).toBe(2);
    expect((await client.pullReviewsPage('writer', 'app', 7, 2, signal)).nextPage).toBeNull();
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/repos/writer/app/issues/7/comments?per_page=100&page=1',
      'https://api.github.com/repos/writer/app/issues/7/comments?per_page=100&page=2',
      'https://api.github.com/repos/writer/app/pulls/7/reviews?per_page=100&page=1',
      'https://api.github.com/repos/writer/app/pulls/7/reviews?per_page=100&page=2',
    ]);
    expect(transport.mock.calls.every(([, init]) => init?.signal === signal && init.cache === 'no-store')).toBe(true);
    await expect(client.commentsPage('writer', 'app', 7, 0)).rejects.toThrow();
    await expect(client.pullReviewsPage('writer', 'app', 0, 1)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it('continues commit history and releases beyond their first pages with independent page sizes', async () => {
    const transport = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      const commits = url.pathname.endsWith('/commits');
      const length = url.searchParams.get('page') === '1' ? commits ? 100 : 30 : 1;
      return Response.json(Array.from({ length }, (_, id) => commits ? { sha: id.toString(16).padStart(40, '0'), commit: { message: `version ${id}` } } : { id: id + 1, tag_name: `v${id + 1}` }));
    });
    const client = new GitHubClient(async () => 'token', transport);
    const signal = new AbortController().signal;
    expect((await client.commitsPage('writer', 'app', 1, signal)).nextPage).toBe(2);
    expect((await client.commitsPage('writer', 'app', 2, signal)).nextPage).toBeNull();
    expect((await client.releasesPage('writer', 'app', 1, signal)).nextPage).toBe(2);
    expect((await client.releasesPage('writer', 'app', 2, signal)).nextPage).toBeNull();
    expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.github.com/repos/writer/app/commits?per_page=100&page=1',
      'https://api.github.com/repos/writer/app/commits?per_page=100&page=2',
      'https://api.github.com/repos/writer/app/releases?per_page=30&page=1',
      'https://api.github.com/repos/writer/app/releases?per_page=30&page=2',
    ]);
    expect(transport.mock.calls.every(([, init]) => init?.signal === signal && init.cache === 'no-store')).toBe(true);
  });

  it('rejects illegal pages and malformed repository list responses without inventing continuation', async () => {
    const transport = vi.fn(async () => Response.json([]));
    const client = new GitHubClient(async () => 'token', transport);
    for (const page of [0, -1, 1.5, NaN, 10001, Number.MAX_SAFE_INTEGER]) {
      await expect(client.commitsPage('writer', 'app', page)).rejects.toThrow('Invalid commits page');
      await expect(client.releasesPage('writer', 'app', page)).rejects.toThrow('Invalid releases page');
    }
    expect(transport).not.toHaveBeenCalled();
    for (const data of [{ items: [] }, [{ sha: 'main', commit: { message: 'wrong identity' } }], [{ sha: 'a'.repeat(40), commit: null }], Array.from({ length: 101 }, () => ({ sha: 'a'.repeat(40), commit: { message: 'too many' } }))]) {
      const malformed = new GitHubClient(async () => 'token', async () => Response.json(data));
      await expect(malformed.commitsPage('writer', 'app')).rejects.toMatchObject({ status: 502 });
    }
    for (const data of [{ items: [] }, [{ id: 0, tag_name: 'v1' }], [{ id: 1, tag_name: '' }], Array.from({ length: 31 }, (_, id) => ({ id: id + 1, tag_name: 'v1' }))]) {
      const malformed = new GitHubClient(async () => 'token', async () => Response.json(data));
      await expect(malformed.releasesPage('writer', 'app')).rejects.toMatchObject({ status: 502 });
    }
  });

  it('treats only commit 409 as an empty repository and preserves forbidden or cancelled reads', async () => {
    const empty = new GitHubClient(async () => 'token', async () => new Response('', { status: 409 }));
    expect(await empty.commitsPage('writer', 'app')).toEqual({ items: [], nextPage: null });
    await expect(empty.releasesPage('writer', 'app')).rejects.toMatchObject({ status: 409 });
    const forbidden = new GitHubClient(async () => 'token', async () => new Response('', { status: 403 }));
    await expect(forbidden.commitsPage('writer', 'app')).rejects.toMatchObject({ status: 403 });
    const controller = new AbortController();
    const cancelled = new GitHubClient(async () => 'token', async () => { controller.abort(); return new Response('', { status: 409 }); });
    await expect(cancelled.commitsPage('writer', 'app', 1, controller.signal)).rejects.toMatchObject({ status: 409 });
  });

  it('bounds full-page continuation and stops after empty final pages', async () => {
    const client = new GitHubClient(async () => 'token', async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('page') === '2') return Response.json([]);
      return Response.json(Array.from({ length: url.pathname.endsWith('/commits') ? 100 : 30 }, (_, id) => url.pathname.endsWith('/commits') ? { sha: id.toString(16).padStart(40, '0'), commit: { message: 'version' } } : { id: id + 1, tag_name: 'v1' }));
    });
    expect((await client.commitsPage('writer', 'app', 10000)).nextPage).toBeNull();
    expect((await client.releasesPage('writer', 'app', 10000)).nextPage).toBeNull();
    expect((await client.commitsPage('writer', 'app', 2)).nextPage).toBeNull();
    expect((await client.releasesPage('writer', 'app', 2)).nextPage).toBeNull();
  });
});
