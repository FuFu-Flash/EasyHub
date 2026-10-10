import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError, type GitHubCheckRun, type GitHubCommitStatus } from '@easyhub/github';

const sha = 'a'.repeat(40);
const run = (id: number): GitHubCheckRun => ({ id, head_sha: sha, name: `Build ${id}`, status: 'completed', conclusion: 'success', html_url: null, details_url: null, started_at: null, completed_at: null });
const status = (id: number): GitHubCommitStatus => ({ id, context: 'Tests', state: 'success', description: null, target_url: null, created_at: '', updated_at: '' });

describe('Android PR check reads', () => {
  it('pins checks to a commit SHA, bypasses cache, forwards cancellation and exposes later pages', async () => {
    const controller = new AbortController();
    const transport = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json({ total_count: 101, check_runs: String(url).endsWith('page=1') ? Array.from({ length: 100 }, (_, index) => run(index + 1)) : [run(101)] }));
    const client = new GitHubClient(async () => 'test-token', transport);
    const first = await client.checkRunsPage('owner', 'repo', sha.toUpperCase(), 1, controller.signal);
    expect(first.items).toHaveLength(100); expect(first.nextPage).toBe(2);
    const second = await client.checkRunsPage('owner', 'repo', sha, 2, controller.signal);
    expect(second.items).toHaveLength(1); expect(second.nextPage).toBeNull();
    expect(transport.mock.calls[0]?.[0]).toBe(`https://api.github.com/repos/owner/repo/commits/${sha}/check-runs?filter=latest&per_page=100&page=1`);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal, cache: 'no-store' });
    expect(new Headers(transport.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer test-token');
  });

  it('paginates legacy status history without discarding old contexts', async () => {
    const transport = vi.fn(async (url: string | URL, _init?: RequestInit) => Response.json(String(url).endsWith('page=1') ? Array.from({ length: 100 }, (_, index) => status(index + 1)) : [status(101)]));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.statusesPage('owner', 'repo', sha, 1)).nextPage).toBe(2);
    expect((await client.statusesPage('owner', 'repo', sha, 2)).nextPage).toBeNull();
    expect(transport.mock.calls[1]?.[0]).toBe(`https://api.github.com/repos/owner/repo/commits/${sha}/statuses?per_page=100&page=2`);
    expect(transport.mock.calls[1]?.[1]?.cache).toBe('no-store');
  });

  it('does not report completion when total count requires another check page', async () => {
    const transport = vi.fn(async () => Response.json({ total_count: 101, check_runs: Array.from({ length: 100 }, (_, index) => run(index + 1)) }));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.checkRunsPage('owner', 'repo', sha)).nextPage).toBe(2);
    transport.mockImplementation(async () => Response.json({ total_count: 101, check_runs: [] }));
    await expect(client.checkRunsPage('owner', 'repo', sha, 2)).rejects.toMatchObject({ status: 502 });
  });

  it('rejects a different check revision, malformed pages and invalid response sizes', async () => {
    const transport = vi.fn(async () => Response.json({ total_count: 1, check_runs: [{ ...run(1), head_sha: 'b'.repeat(40) }] }));
    const client = new GitHubClient(async () => 'token', transport);
    await expect(client.checkRunsPage('owner', 'repo', sha)).rejects.toBeInstanceOf(GitHubError);
    for (const payload of [{ check_runs: null }, { total_count: -1, check_runs: [] }, { total_count: 1.5, check_runs: [] }, { check_runs: Array.from({ length: 101 }, (_, id) => run(id)) }]) {
      transport.mockImplementation(async () => Response.json(payload));
      await expect(client.checkRunsPage('owner', 'repo', sha)).rejects.toMatchObject({ status: 502 });
    }
    for (const payload of [{}, [null], [{ ...status(1), context: null }], Array.from({ length: 101 }, (_, id) => status(id))]) {
      transport.mockImplementation(async () => Response.json(payload));
      await expect(client.statusesPage('owner', 'repo', sha)).rejects.toMatchObject({ status: 502 });
    }
  });

  it('rejects invalid SHA, page and path before making an HTTP request', async () => {
    const transport = vi.fn(async () => Response.json([]));
    const client = new GitHubClient(async () => 'token', transport);
    for (const method of [client.checkRunsPage.bind(client), client.statusesPage.bind(client)]) {
      for (const [owner, repo, ref, page] of [['owner', 'repo', 'main', 1], ['owner', 'repo', sha, 0], ['owner', 'repo', sha, 10001], ['owner', '..', sha, 1], ['../owner', 'repo', sha, 1]] as const) await expect(method(owner, repo, ref, page)).rejects.toThrow('Invalid');
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves permission and transport errors for independent source retry', async () => {
    const transport = vi.fn(async () => Response.json({ message: 'Denied' }, { status: 403 }));
    const client = new GitHubClient(async () => 'token', transport);
    await expect(client.checkRunsPage('owner', 'repo', sha)).rejects.toMatchObject({ status: 403 });
    transport.mockImplementation(async () => Response.json({ message: 'Not found' }, { status: 404 }));
    await expect(client.statusesPage('owner', 'repo', sha)).rejects.toMatchObject({ status: 404 });
  });
});
