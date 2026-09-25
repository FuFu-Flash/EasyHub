import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, friendlyGitHubError } from '@easyhub/github';

describe('GitHubClient', () => {
  it('creates a draft release and publishes it only after assets are ready', async () => {
    const transport = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return Response.json({ id: 42, tag_name: 'v0.01', upload_url: 'https://uploads.github.com/example{?name,label}', draft: init?.method === 'POST' });
    });
    const client = new GitHubClient(async () => 'test-token', transport);
    await client.createRelease('writer', 'app', { tagName: 'v0.01', target: 'main', name: 'First', body: 'Details', prerelease: false });
    const [createUrl, createInit] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(createUrl).toBe('https://api.github.com/repos/writer/app/releases');
    expect(JSON.parse(createInit.body as string)).toMatchObject({ draft: true, tag_name: 'v0.01', target_commitish: 'main' });
    await client.updateRelease('writer', 'app', 42, { body: 'Final details', draft: false });
    const [updateUrl, updateInit] = transport.mock.calls[1] as unknown as [string, RequestInit];
    expect(updateUrl).toBe('https://api.github.com/repos/writer/app/releases/42');
    expect(JSON.parse(updateInit.body as string)).toEqual({ body: 'Final details', draft: false });
    await client.deleteRelease('writer', 'app', 42);
  });
  it('sends a token only to the GitHub API and paginates repositories', async () => {
    const transport = vi.fn(async () => Response.json([{ id: 1, name: 'A' }]));
    const client = new GitHubClient(async () => 'private-token', transport);
    await client.repos(2);
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=2');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer private-token');
  });

  it('omits pull requests from the problem list', async () => {
    const transport = vi.fn(async () => Response.json([{ id: 1, number: 1, title: 'Issue' }, { id: 2, number: 2, title: 'PR', pull_request: {} }]));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.issues('owner', 'repo')).map((item) => item.title)).toEqual(['Issue']);
  });

  it('searches only public repositories and excludes unexpected private results', async () => {
    const transport = vi.fn(async () => Response.json({ items: [
      { id: 1, name: 'EasyHub', private: false },
      { id: 2, name: 'Hidden', private: true },
    ] }));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.searchPublicRepos('easy hub')).map((repo) => repo.name)).toEqual(['EasyHub']);
    const [url] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/search/repositories?q=easy%20hub%20is%3Apublic&per_page=30');
  });

  it('searches user accounts with avatars and excludes organizations', async () => {
    const transport = vi.fn(async () => Response.json({ items: [
      { id: 1, login: 'writer', avatar_url: 'https://avatars.githubusercontent.com/u/1', html_url: 'https://github.com/writer', type: 'User' },
      { id: 2, login: 'writer-org', avatar_url: '', html_url: 'https://github.com/writer-org', type: 'Organization' },
    ] }));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.searchUsers('writer')).map((item) => item.login)).toEqual(['writer']);
    const [url] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/search/users?q=writer%20type%3Auser&per_page=12');
  });

  it('loads only the searched user’s three highest-star public projects', async () => {
    const transport = vi.fn(async () => Response.json({ items: [
      { id: 1, name: 'first', private: false, owner: { login: 'writer' }, stargazers_count: 99 },
      { id: 2, name: 'other', private: false, owner: { login: 'other' }, stargazers_count: 88 },
      { id: 3, name: 'hidden', private: true, owner: { login: 'writer' }, stargazers_count: 77 },
      { id: 4, name: 'second', private: false, owner: { login: 'writer' }, stargazers_count: 66 },
    ] }));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.topStarredRepos('writer')).map((item) => item.name)).toEqual(['first', 'second']);
    const [url] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/search/repositories?q=user%3Awriter%20is%3Apublic&sort=stars&order=desc&per_page=3');
  });

  it('ranks recent public projects with EasyHub metrics and excludes archived results', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
    const transport = vi.fn(async () => Response.json({ total_count: 65, items: [
      { id: 1, private: false, archived: false, stargazers_count: 200, pushed_at: '2026-09-25T11:00:00Z', updated_at: '2026-09-25T11:00:00Z' },
      { id: 2, private: false, archived: false, stargazers_count: 100, pushed_at: '2026-09-25T10:00:00Z', updated_at: '2026-09-25T10:00:00Z' },
      { id: 3, private: true, stargazers_count: 10000, pushed_at: '2026-09-25T10:00:00Z', updated_at: '2026-09-25T10:00:00Z' },
      { id: 4, private: false, archived: true, stargazers_count: 10000, pushed_at: '2026-09-25T10:00:00Z', updated_at: '2026-09-25T10:00:00Z' },
    ] }));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.trending('today')).items.map((item) => item.id)).toEqual([1, 2]);
    expect((await client.trending('today', 2)).hasNextPage).toBe(true);
    const [url] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain('pushed:>=2026-09-24 stars:>=10');
    const [nextUrl] = transport.mock.calls[1] as unknown as [string, RequestInit];
    expect(nextUrl).toContain('per_page=30&page=2');
    vi.useRealTimers();
  });

  it('loads the contribution calendar and repository activity through GraphQL', async () => {
    const transport = vi.fn(async () => Response.json({ data: { user: { contributionsCollection: {
      contributionYears: [2026, 2025], contributionCalendar: { totalContributions: 4, weeks: [{ contributionDays: [{ date: '2026-09-25', contributionCount: 4, color: '#40c463' }] }] },
      commitContributionsByRepository: [{ repository: { nameWithOwner: 'owner/app', isPrivate: false }, contributions: { totalCount: 3 } }],
      issueContributionsByRepository: [{ repository: { nameWithOwner: 'owner/app', isPrivate: false }, contributions: { totalCount: 1 } }],
      pullRequestContributionsByRepository: [],
    } } } }));
    const client = new GitHubClient(async () => 'token', transport);
    const result = await client.contributions('owner', '2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z');
    expect(result.total).toBe(4);
    expect(result.repositories).toEqual([{ fullName: 'owner/app', isPrivate: false, kind: '更新', count: 3 }, { fullName: 'owner/app', isPrivate: false, kind: '问题', count: 1 }]);
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/graphql');
    expect(JSON.parse(init.body as string).variables.login).toBe('owner');
  });

  it('returns an empty introduction when GitHub has no README', async () => {
    const client = new GitHubClient(async () => 'token', async () => new Response('', { status: 404 }));
    expect(await client.readme('owner', 'repo')).toBe('');
  });

  it('turns API failures into human language without exposing server text', async () => {
    const client = new GitHubClient(async () => 'token', async () => new Response('{"message":"secret"}', { status: 403 }));
    await expect(client.user()).rejects.toMatchObject({ status: 403 });
    try { await client.user(); } catch (error) { expect(friendlyGitHubError(error)).toContain('GitHub 暂时拒绝'); }
  });

  it('sends only the intended repository changes for danger actions', async () => {
    const requests: { url: string; method: string; body: string | undefined }[] = [];
    const transport = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return Response.json({ id: 1, name: 'sample' });
    });
    const client = new GitHubClient(async () => 'token', transport);
    await client.updateVisibility('owner', 'sample', true);
    await client.setArchived('owner', 'sample', true);
    await client.transferRepo('owner', 'sample', 'new-owner');
    expect(requests).toEqual([
      { url: 'https://api.github.com/repos/owner/sample', method: 'PATCH', body: '{"private":true}' },
      { url: 'https://api.github.com/repos/owner/sample', method: 'PATCH', body: '{"archived":true}' },
      { url: 'https://api.github.com/repos/owner/sample/transfer', method: 'POST', body: '{"new_owner":"new-owner"}' },
    ]);
  });

  it('lists release choices and downloads a selected asset as binary data', async () => {
    const transport = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      if ((init?.headers as Record<string, string>)?.Accept === 'application/octet-stream') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } });
      return Response.json([{ id: 7, tag_name: 'v1.0.0', assets: [{ id: 41, name: 'app.exe' }] }]);
    });
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.releases('owner', 'repo'))[0]?.tag_name).toBe('v1.0.0');
    const response = await client.downloadReleaseAsset('owner', 'repo', 41);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    const [releaseUrl] = transport.mock.calls[0] as unknown as [string, RequestInit];
    const [assetUrl, assetInit] = transport.mock.calls[1] as unknown as [string, RequestInit];
    expect(releaseUrl).toBe('https://api.github.com/repos/owner/repo/releases?per_page=30');
    expect(assetUrl).toBe('https://api.github.com/repos/owner/repo/releases/assets/41');
    expect((assetInit.headers as Record<string, string>).Accept).toBe('application/octet-stream');
  });

  it('does not save release metadata as a downloadable file', async () => {
    const client = new GitHubClient(async () => 'token', async () => Response.json({ id: 41, name: 'app.exe' }, { headers: { 'content-type': 'application/vnd.github+json' } }));
    await expect(client.downloadReleaseAsset('owner', 'repo', 41)).rejects.toMatchObject({ status: 502 });
  });
});
