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
    await client.release('writer', 'app', 42);
    await client.deleteReleaseAsset('writer', 'app', 7);
    const [assetUrl, assetInit] = transport.mock.calls[4] as unknown as [string, RequestInit];
    expect(assetUrl).toBe('https://api.github.com/repos/writer/app/releases/assets/7');
    expect(assetInit.method).toBe('DELETE');
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

  it('loads starred repositories and distinguishes an unstarred project from an API failure', async () => {
    const transport = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/user/starred?')) return Response.json([{ id: 8, name: 'sample' }]);
      return new Response(null, { status: url.endsWith('/writer/missing') ? 404 : 204 });
    });
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.starredRepos(2))[0]?.id).toBe(8);
    expect(await client.isStarred('writer', 'sample')).toBe(true);
    expect(await client.isStarred('writer', 'missing')).toBe(false);
    expect(transport.mock.calls[0]?.[0]).toBe('https://api.github.com/user/starred?sort=created&direction=desc&per_page=100&page=2');
    const unavailable = new GitHubClient(async () => 'token', async () => new Response(null, { status: 403 }));
    await expect(unavailable.isStarred('writer', 'sample')).rejects.toMatchObject({ status: 403 });
  });

  it('stars and unstars with the methods required by GitHub', async () => {
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    const client = new GitHubClient(async () => 'token', transport);
    await client.setStarred('writer', 'sample', true);
    await client.setStarred('writer', 'sample', false);
    const requests = transport.mock.calls as unknown as [string, RequestInit][];
    expect(requests.map(([url, init]) => [url, init.method])).toEqual([
      ['https://api.github.com/user/starred/writer/sample', 'PUT'],
      ['https://api.github.com/user/starred/writer/sample', 'DELETE'],
    ]);
    expect((requests.at(0)?.[1].headers as Record<string, string>)['Content-Length']).toBe('0');
  });

  it('omits pull requests from the problem list', async () => {
    const transport = vi.fn(async () => Response.json([{ id: 1, number: 1, title: 'Issue' }, { id: 2, number: 2, title: 'PR', pull_request: {} }]));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.issues('owner', 'repo')).map((item) => item.title)).toEqual(['Issue']);
  });

  it('continues past pull requests to load later issue pages', async () => {
    const issue = (number: number) => ({ id: number, number, title: `Issue ${number}` });
    const pull = (number: number) => ({ id: number, number, title: `PR ${number}`, pull_request: {} });
    const transport = vi.fn(async (input: string | URL) => {
      const page = new URL(String(input)).searchParams.get('page');
      return Response.json(page === '2'
        ? Array.from({ length: 50 }, (_, index) => issue(index + 51))
        : [...Array.from({ length: 50 }, (_, index) => issue(index + 1)), ...Array.from({ length: 50 }, (_, index) => pull(index + 1))]);
    });
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.issues('owner', 'repo')).length).toBe(100);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('gets separate issue and improvement counts without using the combined repository count', async () => {
    const transport = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, string> };
      expect(body.query).toContain('issues(states:OPEN){totalCount} closedIssues:issues(states:CLOSED){totalCount} pullRequests(states:OPEN){totalCount} closedPullRequests:pullRequests(states:CLOSED){totalCount}');
      expect(body.variables).toEqual({ owner0: 'writer', name0: 'app', owner1: 'team', name1: 'website' });
      return Response.json({ data: { repo0: { issues: { totalCount: 2 }, closedIssues: { totalCount: 3 }, pullRequests: { totalCount: 5 }, closedPullRequests: { totalCount: 1 } }, repo1: { issues: { totalCount: 0 }, closedIssues: { totalCount: 0 }, pullRequests: { totalCount: 1 }, closedPullRequests: { totalCount: 0 } } } });
    });
    const client = new GitHubClient(async () => 'token', transport);
    expect(await client.activityCounts([{ id: 11, owner: 'writer', name: 'app' }, { id: 12, owner: 'team', name: 'website' }])).toEqual({ 11: { issues: 2, closedIssues: 3, pullRequests: 5, closedPullRequests: 1 }, 12: { issues: 0, closedIssues: 0, pullRequests: 1, closedPullRequests: 0 } });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('lists pull requests separately and creates one from an existing source', async () => {
    const transport = vi.fn(async (input: string | URL, init?: RequestInit) => Response.json(init?.method === 'POST'
      ? { number: 12, title: 'Improve search' }
      : String(input).includes('/pulls/12') ? { number: 12, title: 'Improve search', changed_files: 2 } : [{ number: 12, title: 'Improve search' }]));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.pullRequests('owner', 'repo'))[0]?.number).toBe(12);
    expect((await client.pullRequest('owner', 'repo', 12)).changed_files).toBe(2);
    await client.createPullRequest('owner', 'repo', { title: 'Improve search', body: 'Details', head: 'writer:fix-search', base: 'main' });
    const [url, init] = transport.mock.calls[2] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/owner/repo/pulls');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Improve search', body: 'Details', head: 'writer:fix-search', base: 'main' });
  });

  it('creates a personal repository copy and compares it with the original', async () => {
    const transport = vi.fn(async (input: string | URL, init?: RequestInit) => Response.json(
      init?.method === 'POST' ? { id: 42, name: 'Search', fork: true, owner: { login: 'writer' } }
        : { status: 'ahead', ahead_by: 1, behind_by: 0, files: [{ filename: 'fix.txt', additions: 1, deletions: 0 }] },
    ));
    const client = new GitHubClient(async () => 'token', transport);
    expect((await client.createFork('author', 'Search', 'Search')).fork).toBe(true);
    expect((await client.compare('author', 'Search', 'main', 'writer', 'main')).ahead_by).toBe(1);
    await client.openPullRequestForHead('author', 'Search', 'writer', 'main', 'main');
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/author/Search/forks',
      'https://api.github.com/repos/author/Search/compare/main...writer%3Amain',
      'https://api.github.com/repos/author/Search/pulls?state=open&head=writer%3Amain&base=main&per_page=1',
    ]);
    expect(JSON.parse((transport.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ name: 'Search', default_branch_only: true });
  });

  it('loads changed files after the first hundred and stops at the GitHub limit', async () => {
    const transport = vi.fn(async (input: string | URL) => {
      const page = Number(new URL(String(input)).searchParams.get('page'));
      return Response.json(Array.from({ length: page === 2 ? 1 : 100 }, (_, index) => ({ filename: `${page}-${index}.ts`, status: 'modified', additions: 1, deletions: 0 })));
    });
    const client = new GitHubClient(async () => 'token', transport);
    const files = await client.pullFiles('owner', 'repo', 7);
    expect(files).toHaveLength(101);
    expect(files.at(-1)?.filename).toBe('2-0.ts');
    const cappedTransport = vi.fn(async () => Response.json(Array.from({ length: 100 }, () => ({ filename: 'file.ts' }))));
    expect(await new GitHubClient(async () => 'token', cappedTransport).pullFiles('owner', 'repo', 7)).toHaveLength(3000);
    expect(cappedTransport).toHaveBeenCalledTimes(30);
  });

  it('pins merges to the reviewed revision and uses close for rejection', async () => {
    const transport = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json({ merged: true }));
    const client = new GitHubClient(async () => 'token', transport);
    await client.mergePullRequest('owner', 'repo', 7, 'a'.repeat(40), 'squash');
    await client.closePullRequest('owner', 'repo', 7);
    expect(transport.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/owner/repo/pulls/7/merge');
    expect(transport.mock.calls[0]?.[1]?.method).toBe('PUT');
    expect(JSON.parse(transport.mock.calls[0]?.[1]?.body as string)).toEqual({ sha: 'a'.repeat(40), merge_method: 'squash' });
    expect(transport.mock.calls[1]?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(transport.mock.calls[1]?.[1]?.body as string)).toEqual({ state: 'closed' });
  });

  it('downloads raw immutable file bytes without following redirected token requests', async () => {
    const transport = vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(new Uint8Array([0, 1, 255])));
    const client = new GitHubClient(async () => 'token', transport);
    expect([...new Uint8Array(await (await client.downloadBlob('writer', 'copy', 'a'.repeat(40))).arrayBuffer())]).toEqual([0, 1, 255]);
    expect(transport.mock.calls[0]?.[0]).toBe(`https://api.github.com/repos/writer/copy/git/blobs/${'a'.repeat(40)}`);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', headers: { Accept: 'application/vnd.github.raw+json' } });
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

  it('uses the protected-branch and repository deletion endpoints without unrelated settings', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const client = new GitHubClient(async () => 'token', async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return init?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ name: 'main', protected: false });
    });
    await client.branch('owner', 'app', 'main');
    await client.branchProtection('owner', 'app', 'main');
    await client.createBasicBranchProtection('owner', 'app', 'main');
    await client.deleteBranchProtection('owner', 'app', 'main');
    await client.deleteRepository('owner', 'app');
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', 'https://api.github.com/repos/owner/app/branches/main'],
      ['GET', 'https://api.github.com/repos/owner/app/branches/main/protection'],
      ['PUT', 'https://api.github.com/repos/owner/app/branches/main/protection'],
      ['DELETE', 'https://api.github.com/repos/owner/app/branches/main/protection'],
      ['DELETE', 'https://api.github.com/repos/owner/app'],
    ]);
    expect(JSON.parse(calls[2]!.body!)).toEqual({ required_status_checks: null, enforce_admins: false,
      required_pull_request_reviews: { required_approving_review_count: 1 }, restrictions: null });
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

  it('paginates releases without treating draft filtering as the end of the list', async () => {
    const transport = vi.fn(async (input: string | URL) => Response.json(String(input).endsWith('page=1')
      ? Array.from({ length: 30 }, (_, id) => ({ id, draft: id < 10 })) : [{ id: 30, draft: false }]));
    const client = new GitHubClient(async () => 'token', transport);
    const first = await client.releasesPage('owner', 'app', 1);
    expect(first.items).toHaveLength(30);
    expect(first.nextPage).toBe(2);
    expect(await client.releasesPage('owner', 'app', 2)).toEqual({ items: [{ id: 30, draft: false }], nextPage: null });
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/owner/app/releases?per_page=30&page=1',
      'https://api.github.com/repos/owner/app/releases?per_page=30&page=2',
    ]);
    await expect(client.releasesPage('owner', 'app', 0)).rejects.toThrow('Invalid release page');
    await expect(client.releasesPage('owner', 'app', 1.5)).rejects.toThrow('Invalid release page');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('loads an older release directly by encoded tag and distinguishes not found from network errors', async () => {
    const transport = vi.fn(async (input: string | URL) => String(input).endsWith('older%2F0.1')
      ? Response.json({ id: 8, tag_name: 'older/0.1' }) : new Response(null, { status: String(input).endsWith('missing') ? 404 : 403 }));
    const client = new GitHubClient(async () => 'token', transport);
    expect(await client.releaseByTag('owner', 'app', 'older/0.1')).toMatchObject({ id: 8 });
    expect(transport.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/owner/app/releases/tags/older%2F0.1');
    expect(await client.releaseByTag('owner', 'app', 'missing')).toBeNull();
    await expect(client.releaseByTag('owner', 'app', 'denied')).rejects.toMatchObject({ status: 403 });
    await expect(client.releaseByTag('owner', 'app', 'bad\ntag')).rejects.toThrow('Invalid release tag');
    expect(transport).toHaveBeenCalledTimes(3);
  });
});
