import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError } from '@easyhub/github';

describe('pinned revision check endpoints', () => {
  const sha = 'a'.repeat(40);
  it('uses the supplied immutable revision and follows check pagination', async () => {
    const transport = vi.fn(async (url: string | URL) => Response.json({ total_count: 101, check_runs: Array.from({ length: new URL(url).searchParams.get('page') === '1' ? 100 : 1 }, (_, id) => ({ id, name: `test-${id}`, head_sha: sha, status: 'completed', conclusion: 'success' })) }));
    const client = new GitHubClient(async () => 'fixture-token', transport);
    const signal = new AbortController().signal;
    expect((await client.checkRunsPage('owner', 'repo', sha, 1, signal)).nextPage).toBe(2);
    expect((await client.checkRunsPage('owner', 'repo', sha, 2, signal)).nextPage).toBeNull();
    expect(transport).toHaveBeenLastCalledWith(`https://api.github.com/repos/owner/repo/commits/${sha}/check-runs?filter=latest&per_page=100&page=2`, expect.objectContaining({ signal, cache: 'no-store' }));
  });
  it('keeps commit status history pageable for correct latest-context selection', async () => {
    const transport = vi.fn(async (url: string | URL) => Response.json(Array.from({ length: new URL(url).searchParams.get('page') === '1' ? 100 : 1 }, (_, id) => ({ id, context: 'build', state: 'success' }))));
    const client = new GitHubClient(async () => 'fixture-token', transport);
    expect((await client.statusesPage('o', 'r', sha, 1)).nextPage).toBe(2);
    expect((await client.statusesPage('o', 'r', sha, 2)).nextPage).toBeNull();
    expect(transport).toHaveBeenLastCalledWith(`https://api.github.com/repos/o/r/commits/${sha}/statuses?per_page=100&page=2`, expect.anything());
  });
  it('rejects mutable references, invalid pages, mismatched revisions and malformed results', async () => {
    const transport = vi.fn(async () => Response.json({ total_count: 1, check_runs: [{ id: 1, name: 'wrong', head_sha: 'b'.repeat(40) }] }));
    const client = new GitHubClient(async () => 'fixture-token', transport);
    await expect(client.checkRunsPage('o', 'r', 'main')).rejects.toThrow('Invalid');
    await expect(client.statusesPage('o', 'r', sha, 0)).rejects.toThrow('Invalid');
    expect(transport).not.toHaveBeenCalled();
    await expect(client.checkRunsPage('o', 'r', sha)).rejects.toBeInstanceOf(GitHubError);
    await expect(client.statusesPage('o', 'r', sha)).rejects.toBeInstanceOf(GitHubError);
    const missing = new GitHubClient(async () => 'fixture', async () => Response.json({ total_count: 1, check_runs: [] }));
    await expect(missing.checkRunsPage('o', 'r', sha)).rejects.toBeInstanceOf(GitHubError);
  });
  it('preserves empty, denied and failed responses as distinct outcomes', async () => {
    const empty = new GitHubClient(async () => 'fixture', async () => Response.json({ total_count: 0, check_runs: [] }));
    expect(await empty.checkRunsPage('o', 'r', sha)).toEqual({ items: [], nextPage: null });
    for (const status of [401, 403, 404, 500]) {
      const client = new GitHubClient(async () => 'fixture', async () => new Response('', { status }));
      await expect(client.checkRunsPage('o', 'r', sha)).rejects.toMatchObject({ status });
      await expect(client.statusesPage('o', 'r', sha)).rejects.toMatchObject({ status });
    }
  });
});
