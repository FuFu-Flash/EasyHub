import { describe, expect, it, vi } from 'vitest';
import { GitHubClient } from '@easyhub/github';

describe('shared GitHub features used by Android', () => {
  it('opens older release tags directly including tags with slashes', async () => {
    const transport = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json({ id: 99 }));
    const client = new GitHubClient(async () => 'token', transport);
    await client.releaseByTag('writer', 'app', 'build/v1');
    await client.releaseByTag('writer', 'app');
    expect(transport.mock.calls.map(([url]) => url)).toEqual(['https://api.github.com/repos/writer/app/releases/tags/build%2Fv1', 'https://api.github.com/repos/writer/app/releases/latest']);
  });
  it('loads exact issue counts and individual issues', async () => {
    const transport = vi.fn(async (input: string | URL, _init?: RequestInit) => String(input).endsWith('/graphql')
      ? Response.json({ data: { repository: { issues: { totalCount: 127 } } } })
      : Response.json({ id: 125, number: 125, title: 'Older issue' }));
    const client = new GitHubClient(async () => 'token', transport);
    expect(await client.openIssueCount('writer', 'app')).toBe(127);
    expect((await client.issue('writer', 'app', 125)).title).toBe('Older issue');
    expect(transport.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/writer/app/issues/125');
    const variables = JSON.parse((transport.mock.calls[0]?.[1] as RequestInit).body as string).variables;
    expect(variables).toEqual({ owner: 'writer', repo: 'app' });
  });

  it('loads one changed-file page and submits a review pinned to the selected revision', async () => {
    const transport = vi.fn(async (_input: string | URL, _init?: RequestInit) => Response.json([]));
    const client = new GitHubClient(async () => 'token', transport);
    await client.pullFilesPage('writer', 'app', 7, 2);
    await client.pullReviews('writer', 'app', 7);
    await client.createPullReview('writer', 'app', 7, 'REQUEST_CHANGES', 'Please adjust this', 'a'.repeat(40));
    expect(transport.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/writer/app/pulls/7/files?per_page=100&page=2',
      'https://api.github.com/repos/writer/app/pulls/7/reviews?per_page=100',
      'https://api.github.com/repos/writer/app/pulls/7/reviews',
    ]);
    expect(JSON.parse((transport.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({ event: 'REQUEST_CHANGES', body: 'Please adjust this', commit_id: 'a'.repeat(40) });
    expect(() => client.createPullReview('writer', 'app', 7, 'APPROVE', '', undefined)).toThrow();
  });

  it('renders repository Markdown and safely reads relative README images', async () => {
    const transport = vi.fn(async (input: string | URL) => String(input).endsWith('/markdown')
      ? new Response('<h1>EasyHub</h1>')
      : Response.json({ content: 'PHN2Zz4=', encoding: 'base64', size: 5 }));
    const client = new GitHubClient(async () => 'token', transport);
    expect(await client.renderMarkdown('# EasyHub', 'writer', 'app')).toBe('<h1>EasyHub</h1>');
    expect(await client.readmeImage('writer', 'app', 'main', 'images/logo.svg')).toBe('data:image/svg+xml;base64,PHN2Zz4=');
    expect(await client.readmeImage('writer', 'app', 'main', '../secret.svg')).toBeNull();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/writer/app/contents/images/logo.svg?ref=main');
  });
});
