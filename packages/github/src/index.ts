export type Transport = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GitHubUser { id?: number; login: string; name: string | null; avatar_url: string; html_url: string; bio?: string | null; company?: string | null; location?: string | null; followers?: number; following?: number; public_repos?: number; created_at?: string }
export interface GitHubSearchUser { id: number; login: string; avatar_url: string; html_url: string; type: string }
export interface GitHubRepo { id: number; name: string; full_name: string; description: string | null; private: boolean; archived?: boolean; permissions?: { admin: boolean; push: boolean; pull: boolean }; updated_at: string; pushed_at?: string | null; created_at?: string; stargazers_count?: number; language?: string | null; default_branch: string; owner: { login: string; avatar_url?: string }; open_issues_count: number }
export type TrendingPeriod = 'today' | 'week' | 'month';
export interface ContributionDay { date: string; contributionCount: number; color: string }
export interface ContributionRepository { fullName: string; isPrivate: boolean; count: number; kind: '更新' | '问题' | '合并请求' }
export interface Contributions { total: number; years: number[]; weeks: { contributionDays: ContributionDay[] }[]; repositories: ContributionRepository[] }
export interface GitHubIssue { id: number; number: number; title: string; body: string | null; state: 'open' | 'closed'; created_at: string; user: { login: string } | null; comments: number; pull_request?: unknown }
export interface GitHubComment { id: number; body: string; created_at: string; user: { login: string } | null }
export interface GitHubCommit { sha: string; commit: { message: string; author: { name: string; date: string } | null }; author: { login: string } | null; stats?: { additions: number; deletions: number }; files?: { filename: string; status: string }[] }
export interface GitHubReleaseAsset { id: number; name: string; label: string | null; size: number; content_type: string; download_count: number; state: string }
export interface GitHubRelease { id: number; tag_name: string; name: string | null; body: string | null; draft: boolean; prerelease: boolean; published_at: string | null; assets: GitHubReleaseAsset[] }

export class GitHubError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function friendlyGitHubError(error: unknown): string {
  if (error instanceof GitHubError) {
    if (error.status === 401) return 'GitHub 登录已失效，请重新登录。';
    if (error.status === 403) return 'GitHub 暂时拒绝了操作，请稍后再试，或检查授权范围。';
    if (error.status === 404) return '找不到这个项目，或你没有访问权限。';
    if (error.status === 422) return 'GitHub 未接受这些内容。请检查名称是否重复，以及填写的信息。';
    return 'GitHub 暂时无法完成操作，请稍后再试。';
  }
  if (error instanceof Error && (error.name === 'AbortError' || 'code' in error && error.code === 'ABORT_ERR')) return '操作已取消。';
  return '无法连接 GitHub，请检查网络后重试。';
}

function encodePart(value: string): string { return encodeURIComponent(value); }
function repoPath(owner: string, repo: string): string { return `/repos/${encodePart(owner)}/${encodePart(repo)}`; }

export class GitHubClient {
  constructor(private readonly token: () => Promise<string>, private readonly transport: Transport = fetch) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.transport(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${await this.token()}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw new GitHubError(response.status, 'GitHub request failed');
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  user(signal?: AbortSignal): Promise<GitHubUser> { return this.request('/user', { signal }); }
  profile(login: string, signal?: AbortSignal): Promise<GitHubUser> { return this.request(`/users/${encodePart(login)}`, { signal }); }
  repos(page = 1, signal?: AbortSignal): Promise<GitHubRepo[]> { return this.request(`/user/repos?affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${Math.max(1, Math.floor(page))}`, { signal }); }
  async searchPublicRepos(query: string, signal?: AbortSignal): Promise<GitHubRepo[]> {
    const search = `${query.trim()} is:public`;
    const result = await this.request<{ items: GitHubRepo[] }>(`/search/repositories?q=${encodeURIComponent(search)}&per_page=30`, { signal });
    return result.items.filter((repo) => !repo.private);
  }
  async searchUsers(query: string, signal?: AbortSignal): Promise<GitHubSearchUser[]> {
    const search = `${query.trim()} type:user`;
    const result = await this.request<{ items: GitHubSearchUser[] }>(`/search/users?q=${encodeURIComponent(search)}&per_page=12`, { signal });
    return result.items.filter((user) => user.type === 'User');
  }
  async topStarredRepos(login: string, signal?: AbortSignal): Promise<GitHubRepo[]> {
    const search = `user:${login} is:public`;
    const result = await this.request<{ items: GitHubRepo[] }>(`/search/repositories?q=${encodeURIComponent(search)}&sort=stars&order=desc&per_page=3`, { signal });
    return result.items.filter((repo) => !repo.private && repo.owner.login.toLowerCase() === login.toLowerCase()).slice(0, 3);
  }
  async trending(period: TrendingPeriod, signal?: AbortSignal): Promise<GitHubRepo[]> {
    const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const stars = period === 'today' ? 10 : period === 'week' ? 30 : 100;
    const query = `is:public archived:false pushed:>=${since} stars:>=${stars}`;
    const result = await this.request<{ items: GitHubRepo[] }>(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=100`, { signal });
    const now = Date.now();
    const score = (repo: GitHubRepo): number => {
      const starsScore = Math.log1p(repo.stargazers_count ?? 0);
      const activityAge = Math.max(0, (now - Date.parse(repo.pushed_at || repo.updated_at)) / 86400000);
      const updateAge = Math.max(0, (now - Date.parse(repo.updated_at)) / 86400000);
      return starsScore * 0.55 + Math.exp(-activityAge / Math.max(1, days)) * 2.8 + Math.exp(-updateAge / Math.max(1, days)) * 1.2;
    };
    return result.items.filter((repo) => !repo.private && !repo.archived).sort((a, b) => score(b) - score(a)).slice(0, 30);
  }
  async contributions(login: string, from: string, to: string, signal?: AbortSignal): Promise<Contributions> {
    const query = `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){contributionYears contributionCalendar{totalContributions weeks{contributionDays{date contributionCount color}}} commitContributionsByRepository(maxRepositories:100){repository{nameWithOwner isPrivate} contributions{totalCount}} issueContributionsByRepository{repository{nameWithOwner isPrivate} contributions{totalCount}} pullRequestContributionsByRepository(maxRepositories:100){repository{nameWithOwner isPrivate} contributions{totalCount}}}}}`;
    type Group = { repository: { nameWithOwner: string; isPrivate: boolean }; contributions: { totalCount: number } };
    type Collection = { contributionYears: number[]; contributionCalendar: { totalContributions: number; weeks: Contributions['weeks'] }; commitContributionsByRepository: Group[]; issueContributionsByRepository: Group[]; pullRequestContributionsByRepository: Group[] };
    const response = await this.request<{ data?: { user: { contributionsCollection: Collection } | null }; errors?: { message: string }[] }>('/graphql', { method: 'POST', body: JSON.stringify({ query, variables: { login, from, to } }), signal });
    const collection = response.data?.user?.contributionsCollection;
    if (!collection || response.errors?.length) throw new GitHubError(502, 'GitHub contributions unavailable');
    const map = (groups: Group[], kind: ContributionRepository['kind']): ContributionRepository[] => groups.map((item) => ({ fullName: item.repository.nameWithOwner, isPrivate: item.repository.isPrivate, count: item.contributions.totalCount, kind }));
    return { total: collection.contributionCalendar.totalContributions, years: collection.contributionYears, weeks: collection.contributionCalendar.weeks, repositories: [...map(collection.commitContributionsByRepository, '更新'), ...map(collection.issueContributionsByRepository, '问题'), ...map(collection.pullRequestContributionsByRepository, '合并请求')] };
  }
  repo(owner: string, repo: string): Promise<GitHubRepo> { return this.request(repoPath(owner, repo)); }
  updateVisibility(owner: string, repo: string, isPrivate: boolean): Promise<GitHubRepo> {
    return this.request(repoPath(owner, repo), { method: 'PATCH', body: JSON.stringify({ private: isPrivate }) });
  }
  setArchived(owner: string, repo: string, archived: boolean): Promise<GitHubRepo> {
    return this.request(repoPath(owner, repo), { method: 'PATCH', body: JSON.stringify({ archived }) });
  }
  transferRepo(owner: string, repo: string, newOwner: string): Promise<GitHubRepo> {
    return this.request(`${repoPath(owner, repo)}/transfer`, { method: 'POST', body: JSON.stringify({ new_owner: newOwner }) });
  }
  createRepo(name: string, description: string, isPrivate: boolean, autoInit = true): Promise<GitHubRepo> {
    return this.request('/user/repos', { method: 'POST', body: JSON.stringify({ name, description, private: isPrivate, auto_init: autoInit }) });
  }
  async readme(owner: string, repo: string, signal?: AbortSignal): Promise<string> {
    const response = await this.transport(`https://api.github.com${repoPath(owner, repo)}/readme`, {
      signal,
      headers: { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${await this.token()}` },
    });
    if (response.status === 404) return '';
    if (!response.ok) throw new GitHubError(response.status, 'GitHub README request failed');
    return response.text();
  }
  issues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all', signal?: AbortSignal): Promise<GitHubIssue[]> {
    return this.request<GitHubIssue[]>(`${repoPath(owner, repo)}/issues?state=${state}&per_page=100`, { signal }).then((items) => items.filter((item) => !item.pull_request));
  }
  createIssue(owner: string, repo: string, title: string, body: string): Promise<GitHubIssue> {
    return this.request(`${repoPath(owner, repo)}/issues`, { method: 'POST', body: JSON.stringify({ title, body }) });
  }
  updateIssue(owner: string, repo: string, number: number, state: 'open' | 'closed'): Promise<GitHubIssue> {
    return this.request(`${repoPath(owner, repo)}/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ state }) });
  }
  comments(owner: string, repo: string, number: number, signal?: AbortSignal): Promise<GitHubComment[]> { return this.request(`${repoPath(owner, repo)}/issues/${number}/comments?per_page=100`, { signal }); }
  createComment(owner: string, repo: string, number: number, body: string): Promise<GitHubComment> {
    return this.request(`${repoPath(owner, repo)}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  }
  commits(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubCommit[]> { return this.request(`${repoPath(owner, repo)}/commits?per_page=100`, { signal }); }
  commit(owner: string, repo: string, sha: string, signal?: AbortSignal): Promise<GitHubCommit> { return this.request(`${repoPath(owner, repo)}/commits/${encodePart(sha)}`, { signal }); }
  releases(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubRelease[]> { return this.request(`${repoPath(owner, repo)}/releases?per_page=30`, { signal }); }
  releaseAsset(owner: string, repo: string, id: number, signal?: AbortSignal): Promise<GitHubReleaseAsset> { return this.request(`${repoPath(owner, repo)}/releases/assets/${id}`, { signal }); }
  async downloadReleaseAsset(owner: string, repo: string, id: number, signal?: AbortSignal): Promise<Response> {
    const response = await this.transport(`https://api.github.com${repoPath(owner, repo)}/releases/assets/${id}`, {
      signal, redirect: 'follow', headers: { Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${await this.token()}` },
    });
    if (!response.ok) throw new GitHubError(response.status, 'GitHub release download failed');
    if (response.headers.get('content-type')?.toLowerCase().includes('json')) throw new GitHubError(502, 'GitHub returned metadata instead of the release file');
    return response;
  }
  async archive(owner: string, repo: string, ref: string, signal?: AbortSignal): Promise<Response> {
    const response = await this.transport(`https://api.github.com${repoPath(owner, repo)}/zipball/${encodePart(ref)}`, {
      signal, redirect: 'follow',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${await this.token()}` },
    });
    if (!response.ok) throw new GitHubError(response.status, 'GitHub archive request failed');
    return response;
  }
}
