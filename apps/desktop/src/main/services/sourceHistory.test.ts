import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '@easyhub/github';

const sha = 'a'.repeat(40);
const commit = { sha, commit: { message: 'Update', author: null }, author: null };
const file = { filename: 'src/app.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' };

describe('source history GitHub reads', () => {
  it('encodes branch and file filters and continues past 100 commits without dropping cancellation', async () => {
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => Response.json(new URL(String(input)).searchParams.get('page') === '1' ? Array.from({ length: 100 }, () => commit) : [commit]));
    const client = new GitHubClient(async () => 'fixture', fetcher);
    const signal = new AbortController().signal;
    expect((await client.sourceHistory('owner', 'repo', { branch: 'feature/中文', path: 'src/中文 & a.ts', page: 1 }, signal)).nextPage).toBe(2);
    expect((await client.sourceHistory('owner', 'repo', { branch: 'feature/中文', path: 'src/中文 & a.ts', page: 2 }, signal)).nextPage).toBeNull();
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get('sha')).toBe('feature/中文');
    expect(url.searchParams.get('path')).toBe('src/中文 & a.ts');
    expect(url.searchParams.get('per_page')).toBe('100');
    expect(fetcher.mock.calls.every(([, init]) => init?.signal === signal && init.cache === 'no-store' && !init.method)).toBe(true);
  });
  it('reads every branch page and rejects malformed branch responses', async () => {
    const fetcher = vi.fn(async (input: string | URL) => Response.json(new URL(String(input)).searchParams.get('page') === '1' ? Array.from({ length: 100 }, (_, index) => ({ name: `branch-${index}`, commit: { sha }, protected: false })) : []));
    const client = new GitHubClient(async () => 'fixture', fetcher);
    expect((await client.branchesPage('owner', 'repo', 1)).nextPage).toBe(2);
    expect((await client.branchesPage('owner', 'repo', 2)).nextPage).toBeNull();
    const broken = new GitHubClient(async () => 'fixture', async () => Response.json([{ name: 'refs/../bad', commit: { sha } }]));
    await expect(broken.branchesPage('owner', 'repo', 1)).rejects.toMatchObject({ status: 502 });
  });
  it('distinguishes empty repositories from authorization failures', async () => {
    const empty = new GitHubClient(async () => 'fixture', async () => new Response('', { status: 409 }));
    expect(await empty.sourceHistory('owner', 'repo', { branch: 'main', page: 1 })).toEqual({ items: [], nextPage: null });
    expect(await empty.branchesPage('owner', 'repo', 1)).toEqual({ items: [], nextPage: null });
    const denied = new GitHubClient(async () => 'fixture', async () => new Response('', { status: 403 }));
    await expect(denied.sourceHistory('owner', 'repo', { branch: 'main', page: 1 })).rejects.toMatchObject({ status: 403 });
  });
  it('rejects malformed history payloads rather than pretending there are no commits', async () => {
    for (const payload of [{}, [{ ...commit, sha: '../other' }], [{ sha }]]) {
      const client = new GitHubClient(async () => 'fixture', async () => Response.json(payload));
      await expect(client.sourceHistory('owner', 'repo', { branch: 'main', page: 1 })).rejects.toMatchObject({ status: 502 });
    }
  });
  it('paginates commit files and signals the 3000-file API limit', async () => {
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => Response.json({ ...commit, files: new URL(String(input)).searchParams.get('page') === '2' ? [file] : Array.from({ length: 100 }, (_, index) => ({ ...file, filename: `src/${index}.ts` })) }));
    const client = new GitHubClient(async () => 'fixture', fetcher);
    const signal = new AbortController().signal;
    expect(await client.commitChangesPage('owner', 'repo', sha, 1, signal)).toMatchObject({ nextPage: 2, limited: false });
    expect(await client.commitChangesPage('owner', 'repo', sha, 2, signal)).toMatchObject({ nextPage: null, limited: false });
    expect(await client.commitChangesPage('owner', 'repo', sha, 30, signal)).toMatchObject({ nextPage: null, limited: true });
    expect(fetcher.mock.calls[0]![0]).toBe(`https://api.github.com/repos/owner/repo/commits/${sha}?per_page=100&page=1`);
    expect(fetcher.mock.calls.every(([, init]) => init?.signal === signal && init.cache === 'no-store' && !init.method)).toBe(true);
  });
  it('does not mix files from a different commit or accept invalid patch data', async () => {
    for (const payload of [{ ...commit, sha: 'b'.repeat(40), files: [file] }, { ...commit, files: [{ ...file, additions: -1 }] }, { ...commit, files: [{ ...file, patch: {} }] }, { ...commit, files: [{ ...file, filename: '../../outside' }] }]) {
      const client = new GitHubClient(async () => 'fixture', async () => Response.json(payload));
      await expect(client.commitChangesPage('owner', 'repo', sha, 1)).rejects.toMatchObject({ status: 502 });
    }
  });
  it('rejects invalid filters and pagination before sending requests', async () => {
    const fetcher = vi.fn(async () => Response.json([]));
    const client = new GitHubClient(async () => 'fixture', fetcher);
    for (const branch of ['', '../main', 'refs/heads/.hidden', 'bad branch', 'main.lock']) await expect(client.sourceHistory('owner', 'repo', { branch, page: 1 })).rejects.toThrow();
    for (const path of ['/absolute', '../outside', 'src/../outside', 'a\\b', 'x\u0000y']) await expect(client.sourceHistory('owner', 'repo', { branch: 'main', path, page: 1 })).rejects.toThrow();
    await expect(client.sourceHistory('owner', 'repo', { branch: 'main', page: 0 })).rejects.toThrow();
    await expect(client.branchesPage('owner', 'repo', 0)).rejects.toThrow();
    await expect(client.commitChangesPage('owner', 'repo', '../other', 1)).rejects.toThrow();
    await expect(client.commitChangesPage('owner', 'repo', sha, 31)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
