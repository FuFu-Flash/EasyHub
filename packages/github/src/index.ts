export type Transport = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface GitHubUser { id?: number; login: string; name: string | null; avatar_url: string; html_url: string; bio?: string | null; company?: string | null; location?: string | null; followers?: number; following?: number; public_repos?: number; created_at?: string }
export interface GitHubSearchUser { id: number; login: string; avatar_url: string; html_url: string; type: string }
export interface GitHubSearchPage<T> { items: T[]; page: number; totalCount: number; hasNextPage: boolean; incompleteResults: boolean }
export interface GitHubRepo { id: number; name: string; full_name: string; html_url?: string; description: string | null; private: boolean; fork?: boolean; parent?: { id: number; full_name: string; default_branch: string; html_url: string; owner: { login: string }; name: string }; allow_forking?: boolean; allow_merge_commit?: boolean; allow_squash_merge?: boolean; allow_rebase_merge?: boolean; archived?: boolean; permissions?: { admin: boolean; push: boolean; pull: boolean }; updated_at: string; pushed_at?: string | null; created_at?: string; stargazers_count?: number; language?: string | null; default_branch: string; owner: { login: string; avatar_url?: string }; open_issues_count: number }
export interface GitHubBranchProtection { required_status_checks: unknown | null; required_pull_request_reviews: { required_approving_review_count?: number } | null; enforce_admins: { enabled: boolean } | null }
export interface GitHubBranch { name: string; protected: boolean }
export interface GitHubComparison { status: string; ahead_by: number; behind_by: number; total_commits: number; files?: GitHubPullFile[] }
export interface GitHubForkComparison extends GitHubComparison { openRequest: GitHubPullRequest | null }
export type TrendingPeriod = 'today' | 'week' | 'month';
export interface ContributionDay { date: string; contributionCount: number; color: string }
export interface ContributionRepository { fullName: string; isPrivate: boolean; count: number; kind: '更新' | '问题' | '合并请求' }
export interface Contributions { total: number; years: number[]; weeks: { contributionDays: ContributionDay[] }[]; repositories: ContributionRepository[] }
export interface GitHubIssue { id: number; number: number; title: string; body: string | null; state: 'open' | 'closed'; created_at: string; user: { login: string } | null; comments: number; pull_request?: unknown }
export interface GitHubIssuePage { items: GitHubIssue[]; nextPage: number | null }
export interface GitHubPage<T> { items: T[]; nextPage: number | null }
export interface GitHubActivityCount { issues: number; closedIssues: number; pullRequests: number; closedPullRequests: number }
export interface GitHubActivityRepository { id: number; owner: string; name: string }
export interface GitHubPullRepository { id: number; name: string; full_name: string; owner: { login: string } }
export interface GitHubPullRequest { id: number; number: number; title: string; body: string | null; state: 'open' | 'closed'; draft: boolean; merged: boolean; merged_at: string | null; created_at: string; html_url: string; user: { login: string } | null; comments: number; changed_files?: number; additions?: number; deletions?: number; mergeable?: boolean | null; mergeable_state?: string; head: { ref: string; label: string; sha?: string; repo?: GitHubPullRepository | null }; base: { ref: string; sha?: string; repo?: GitHubPullRepository | null } }
export interface GitHubPullFile { filename: string; status: string; additions: number; deletions: number; sha?: string; previous_filename?: string; patch?: string }
export interface GitHubPullReview { id: number; state: string; body: string | null; submitted_at: string | null; user: { login: string } | null }
export interface GitHubCheckRun { id: number; name: string; head_sha: string; status: string; conclusion: string | null; html_url: string | null; details_url: string | null; started_at: string | null; completed_at: string | null; app?: { id: number; name: string } | null; output?: { title: string | null; summary: string | null } }
export interface GitHubCommitStatus { id: number; context: string; state: string; description: string | null; target_url: string | null; created_at: string; updated_at: string }
export interface GitHubCheckPage<T> { items: T[]; nextPage: number | null }
export type GitHubCheckSourcePage<T> = (GitHubCheckPage<T> & { state: 'available' }) | { state: 'forbidden' | 'unavailable'; items: []; nextPage: number };
export interface GitHubPullChecks { headSha: string; checkRuns: GitHubCheckSourcePage<GitHubCheckRun> | null; statuses: GitHubCheckSourcePage<GitHubCommitStatus> | null }
export type GitHubReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
export function isEmptyAddedPullFile(file: GitHubPullFile): boolean {
  return file.status === 'added' && file.sha === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
}
export interface GitHubMergeResult { merged: boolean; sha: string; message: string }
export interface GitHubComment { id: number; body: string; created_at: string; user: { login: string } | null }
export interface GitHubCommit { sha: string; commit: { message: string; author: { name: string; date: string } | null }; author: { login: string } | null; stats?: { additions: number; deletions: number }; files?: { filename: string; status: string }[] }
export interface GitHubReleaseAsset { id: number; name: string; label: string | null; size: number; content_type: string; download_count: number; state: string; browser_download_url?: string; digest?: string }
export interface GitHubRelease { id: number; tag_name: string; name: string | null; body: string | null; draft: boolean; prerelease: boolean; published_at: string | null; assets: GitHubReleaseAsset[] }
export interface GitHubReleasePage { items: GitHubRelease[]; nextPage: number | null }
export interface GitHubCreatedRelease extends GitHubRelease { upload_url: string; html_url: string }
export interface TrendingPage { items: GitHubRepo[]; page: number; hasNextPage: boolean }

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
  starredRepos(page = 1, signal?: AbortSignal): Promise<GitHubRepo[]> {
    return this.request(`/user/starred?sort=created&direction=desc&per_page=100&page=${Math.max(1, Math.floor(page))}`, { signal, cache: 'no-store' });
  }
  async isStarred(owner: string, repo: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.request<void>(`/user/starred/${encodePart(owner)}/${encodePart(repo)}`, { signal, cache: 'no-store' });
      return true;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return false;
      throw error;
    }
  }
  async setStarred(owner: string, repo: string, starred: boolean): Promise<void> {
    await this.request<void>(`/user/starred/${encodePart(owner)}/${encodePart(repo)}`, {
      method: starred ? 'PUT' : 'DELETE',
      ...(starred ? { headers: { 'Content-Length': '0' } } : {}),
    });
  }
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
  async searchPublicReposPage(query: string, page = 1, signal?: AbortSignal): Promise<GitHubSearchPage<GitHubRepo>> {
    const result = await this.searchPage<GitHubRepo>('repositories', `${query.trim()} is:public`, page, 30, signal);
    return { ...result, items: result.items.filter((repo) => !repo.private) };
  }
  async searchUsersPage(query: string, page = 1, signal?: AbortSignal): Promise<GitHubSearchPage<GitHubSearchUser>> {
    const result = await this.searchPage<GitHubSearchUser>('users', `${query.trim()} type:user`, page, 12, signal);
    return { ...result, items: result.items.filter((user) => user.type === 'User') };
  }
  private async searchPage<T>(resource: 'repositories' | 'users' | 'issues', query: string, page: number, pageSize: number, signal?: AbortSignal): Promise<GitHubSearchPage<T>> {
    if (!Number.isSafeInteger(page) || page < 1 || page > Math.ceil(1000 / pageSize)) throw new Error('Invalid search page');
    const result = await this.request<{ items: T[]; total_count?: number; incomplete_results?: boolean }>(`/search/${resource}?q=${encodeURIComponent(query)}&per_page=${pageSize}&page=${page}`, { signal });
    const totalCount = Number.isSafeInteger(result.total_count) && result.total_count! >= 0 ? result.total_count! : (page - 1) * pageSize + result.items.length;
    return { items: result.items.slice(0, Math.max(0, 1000 - (page - 1) * pageSize)), page, totalCount,
      hasNextPage: result.items.length > 0 && page * pageSize < Math.min(totalCount, 1000), incompleteResults: result.incomplete_results === true };
  }
  async topStarredRepos(login: string, signal?: AbortSignal): Promise<GitHubRepo[]> {
    const search = `user:${login} is:public`;
    const result = await this.request<{ items: GitHubRepo[] }>(`/search/repositories?q=${encodeURIComponent(search)}&sort=stars&order=desc&per_page=3`, { signal });
    return result.items.filter((repo) => !repo.private && repo.owner.login.toLowerCase() === login.toLowerCase()).slice(0, 3);
  }
  async trending(period: TrendingPeriod, page = 1, signal?: AbortSignal): Promise<TrendingPage> {
    if (!Number.isInteger(page) || page < 1 || page > 34) throw new Error('Invalid trending page');
    const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const stars = period === 'today' ? 10 : period === 'week' ? 30 : 100;
    const query = `is:public archived:false pushed:>=${since} stars:>=${stars}`;
    const result = await this.request<{ items: GitHubRepo[]; total_count?: number }>(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=30&page=${page}`, { signal });
    const now = Date.now();
    const score = (repo: GitHubRepo): number => {
      const starsScore = Math.log1p(repo.stargazers_count ?? 0);
      const activityAge = Math.max(0, (now - Date.parse(repo.pushed_at || repo.updated_at)) / 86400000);
      const updateAge = Math.max(0, (now - Date.parse(repo.updated_at)) / 86400000);
      return starsScore * 0.55 + Math.exp(-activityAge / Math.max(1, days)) * 2.8 + Math.exp(-updateAge / Math.max(1, days)) * 1.2;
    };
    return { items: result.items.filter((repo) => !repo.private && !repo.archived).sort((a, b) => score(b) - score(a)),
      page, hasNextPage: page * 30 < Math.min(result.total_count ?? result.items.length, 1000) };
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
  repo(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubRepo> { return this.request(repoPath(owner, repo), { signal }); }
  createFork(owner: string, repo: string, name: string): Promise<GitHubRepo> {
    return this.request(`${repoPath(owner, repo)}/forks`, { method: 'POST', body: JSON.stringify({ name, default_branch_only: true }) });
  }
  compare(owner: string, repo: string, base: string, headOwner: string, head: string): Promise<GitHubComparison> {
    return this.request(`${repoPath(owner, repo)}/compare/${encodePart(base)}...${encodePart(`${headOwner}:${head}`)}`);
  }
  updateVisibility(owner: string, repo: string, isPrivate: boolean): Promise<GitHubRepo> {
    return this.request(repoPath(owner, repo), { method: 'PATCH', body: JSON.stringify({ private: isPrivate }) });
  }
  setArchived(owner: string, repo: string, archived: boolean): Promise<GitHubRepo> {
    return this.request(repoPath(owner, repo), { method: 'PATCH', body: JSON.stringify({ archived }) });
  }
  transferRepo(owner: string, repo: string, newOwner: string): Promise<GitHubRepo> {
    return this.request(`${repoPath(owner, repo)}/transfer`, { method: 'POST', body: JSON.stringify({ new_owner: newOwner }) });
  }
  branch(owner: string, repo: string, branch: string): Promise<GitHubBranch> {
    return this.request(`${repoPath(owner, repo)}/branches/${encodePart(branch)}`);
  }
  branchProtection(owner: string, repo: string, branch: string): Promise<GitHubBranchProtection> {
    return this.request(`${repoPath(owner, repo)}/branches/${encodePart(branch)}/protection`);
  }
  createBasicBranchProtection(owner: string, repo: string, branch: string): Promise<GitHubBranchProtection> {
    return this.request(`${repoPath(owner, repo)}/branches/${encodePart(branch)}/protection`, {
      method: 'PUT', body: JSON.stringify({ required_status_checks: null, enforce_admins: false,
        required_pull_request_reviews: { required_approving_review_count: 1 }, restrictions: null }),
    });
  }
  deleteBranchProtection(owner: string, repo: string, branch: string): Promise<void> {
    return this.request(`${repoPath(owner, repo)}/branches/${encodePart(branch)}/protection`, { method: 'DELETE' });
  }
  deleteRepository(owner: string, repo: string): Promise<void> {
    return this.request(repoPath(owner, repo), { method: 'DELETE' });
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
  async renderMarkdown(markdown: string, owner: string, repo: string, signal?: AbortSignal): Promise<string> {
    const response = await this.transport('https://api.github.com/markdown', {
      method: 'POST', signal,
      headers: { Accept: 'text/html', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${await this.token()}` },
      body: JSON.stringify({ text: markdown, mode: 'gfm', context: `${owner}/${repo}` }),
    });
    if (!response.ok) throw new GitHubError(response.status, 'GitHub Markdown request failed');
    return response.text();
  }
  async readmeImage(owner: string, repo: string, branch: string, path: string, signal?: AbortSignal): Promise<string | null> {
    if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
    const extension = path.split('.').pop()?.toLowerCase();
    const mime = ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[extension || ''];
    if (!mime) return null;
    const encodedPath = path.split('/').map(encodePart).join('/');
    const result = await this.request<{ content?: string; encoding?: string; size?: number }>(`${repoPath(owner, repo)}/contents/${encodedPath}?ref=${encodePart(branch)}`, { signal });
    if (result.encoding !== 'base64' || !result.content || !result.size || result.size > 1_000_000) return null;
    return `data:${mime};base64,${result.content.replace(/\s/g, '')}`;
  }
  async issuePage(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all', page = 1, signal?: AbortSignal): Promise<GitHubIssuePage> {
    const items: GitHubIssue[] = [];
    let currentPage = page;
    for (let fetched = 0; fetched < 5; fetched += 1) {
      const raw = await this.request<GitHubIssue[]>(`${repoPath(owner, repo)}/issues?state=${state}&per_page=100&page=${currentPage}`, { signal });
      items.push(...raw.filter((item) => !item.pull_request));
      currentPage += 1;
      if (raw.length < 100) return { items, nextPage: null };
      if (items.length >= 100) break;
    }
    return { items, nextPage: currentPage };
  }
  async issues(owner: string, repo: string, state: 'open' | 'closed' | 'all' = 'all', signal?: AbortSignal): Promise<GitHubIssue[]> {
    return (await this.issuePage(owner, repo, state, 1, signal)).items;
  }
  issue(owner: string, repo: string, number: number, signal?: AbortSignal): Promise<GitHubIssue> {
    if (!Number.isInteger(number) || number < 1) throw new Error('Invalid issue number');
    return this.request(`${repoPath(owner, repo)}/issues/${number}`, { signal });
  }
  async openIssueCount(owner: string, repo: string, signal?: AbortSignal): Promise<number> {
    const query = 'query($owner:String!,$repo:String!){repository(owner:$owner,name:$repo){issues(states:OPEN){totalCount}}}';
    const result = await this.request<{ data?: { repository: { issues: { totalCount: number } } | null }; errors?: { message: string }[] }>('/graphql', {
      method: 'POST', body: JSON.stringify({ query, variables: { owner, repo } }), signal,
    });
    if (result.errors?.length || !Number.isSafeInteger(result.data?.repository?.issues.totalCount)) throw new GitHubError(502, 'GitHub issue count unavailable');
    return result.data!.repository!.issues.totalCount;
  }
  async activityCounts(repositories: GitHubActivityRepository[], signal?: AbortSignal): Promise<Record<number, GitHubActivityCount>> {
    const counts: Record<number, GitHubActivityCount> = {};
    for (let offset = 0; offset < repositories.length; offset += 20) {
      const batch = repositories.slice(offset, offset + 20);
      const variables: Record<string, string> = {};
      const definitions: string[] = [];
      const fields = batch.map((item, index) => {
        variables[`owner${index}`] = item.owner;
        variables[`name${index}`] = item.name;
        definitions.push(`$owner${index}:String!`, `$name${index}:String!`);
        return `repo${index}:repository(owner:$owner${index},name:$name${index}){issues(states:OPEN){totalCount} closedIssues:issues(states:CLOSED){totalCount} pullRequests(states:OPEN){totalCount} closedPullRequests:pullRequests(states:CLOSED){totalCount}}`;
      });
      const response = await this.request<{ data?: Record<string, { issues: { totalCount: number }; closedIssues: { totalCount: number }; pullRequests: { totalCount: number }; closedPullRequests: { totalCount: number } } | null>; errors?: { message: string }[] }>('/graphql', {
        method: 'POST', body: JSON.stringify({ query: `query(${definitions.join(',')}){${fields.join(' ')}}`, variables }), signal,
      });
      if (!response.data) throw new GitHubError(502, 'GitHub activity counts unavailable');
      batch.forEach((item, index) => {
        const value = response.data?.[`repo${index}`];
        if (value && Number.isSafeInteger(value.issues?.totalCount) && Number.isSafeInteger(value.closedIssues?.totalCount) && Number.isSafeInteger(value.pullRequests?.totalCount) && Number.isSafeInteger(value.closedPullRequests?.totalCount)) {
          counts[item.id] = { issues: value.issues.totalCount, closedIssues: value.closedIssues.totalCount, pullRequests: value.pullRequests.totalCount, closedPullRequests: value.closedPullRequests.totalCount };
        }
      });
    }
    return counts;
  }
  createIssue(owner: string, repo: string, title: string, body: string): Promise<GitHubIssue> {
    return this.request(`${repoPath(owner, repo)}/issues`, { method: 'POST', body: JSON.stringify({ title, body }) });
  }
  updateIssue(owner: string, repo: string, number: number, state: 'open' | 'closed'): Promise<GitHubIssue> {
    return this.request(`${repoPath(owner, repo)}/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ state }) });
  }
  comments(owner: string, repo: string, number: number, signal?: AbortSignal): Promise<GitHubComment[]> { return this.request(`${repoPath(owner, repo)}/issues/${number}/comments?per_page=100`, { signal }); }
  async commentsPage(owner: string, repo: string, number: number, page = 1, signal?: AbortSignal): Promise<GitHubPage<GitHubComment>> {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid comments page');
    const items = await this.request<GitHubComment[]>(`${repoPath(owner, repo)}/issues/${number}/comments?per_page=100&page=${page}`, { signal, cache: 'no-store' });
    return { items, nextPage: items.length === 100 ? page + 1 : null };
  }
  async searchDiscussions(owner: string, repo: string, text: string, kind: 'issue' | 'pr', state: 'open' | 'closed' | 'all', page = 1, signal?: AbortSignal): Promise<GitHubSearchPage<GitHubIssue>> {
    if (!text.trim() || text.length > 200 || !['issue', 'pr'].includes(kind) || !['open', 'closed', 'all'].includes(state)) throw new Error('Invalid discussion search');
    const number = /^#?(\d+)$/.exec(text.trim());
    if (number) {
      const value = Number(number[1]);
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid issue number');
      try {
        const issue = await this.request<GitHubIssue>(`${repoPath(owner, repo)}/issues/${value}`, { signal });
        const matches = Boolean(issue.pull_request) === (kind === 'pr') && (state === 'all' || issue.state === state);
        return { items: matches ? [issue] : [], totalCount: matches ? 1 : 0, page: 1, hasNextPage: false, incompleteResults: false };
      } catch (error) { if (error instanceof GitHubError && error.status === 404) return { items: [], totalCount: 0, page: 1, hasNextPage: false, incompleteResults: false }; throw error; }
    }
    const title = text.trim().replace(/["\\\r\n]/g, ' ');
    const result = await this.searchPage<GitHubIssue>('issues', `repo:${owner}/${repo} is:${kind}${state === 'all' ? '' : ` is:${state}`} in:title "${title}"`, page, 30, signal);
    return { ...result, items: result.items.filter((item) => Boolean(item.pull_request) === (kind === 'pr')) };
  }
  createComment(owner: string, repo: string, number: number, body: string): Promise<GitHubComment> {
    return this.request(`${repoPath(owner, repo)}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  }
  pullRequests(owner: string, repo: string, page = 1, signal?: AbortSignal): Promise<GitHubPullRequest[]> {
    return this.request(`${repoPath(owner, repo)}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`, { signal });
  }
  pullRequestsPage(owner: string, repo: string, state: 'open' | 'closed', page = 1, signal?: AbortSignal): Promise<GitHubPullRequest[]> {
    return this.request(`${repoPath(owner, repo)}/pulls?state=${state}&sort=updated&direction=desc&per_page=100&page=${page}`, { signal });
  }
  pullRequest(owner: string, repo: string, number: number, signal?: AbortSignal): Promise<GitHubPullRequest> {
    return this.request(`${repoPath(owner, repo)}/pulls/${number}`, { signal });
  }
  async checkRunsPage(owner: string, repo: string, headSha: string, page = 1, signal?: AbortSignal): Promise<GitHubCheckPage<GitHubCheckRun>> {
    if (!/^[a-f0-9]{40}$/i.test(headSha) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid checks reference');
    const result = await this.request<{ total_count: number; check_runs: GitHubCheckRun[] }>(`${repoPath(owner, repo)}/commits/${headSha}/check-runs?filter=latest&per_page=100&page=${page}`, { signal, cache: 'no-store' });
    if (!Array.isArray(result.check_runs) || result.check_runs.some((run) => !run || run.head_sha !== headSha || typeof run.name !== 'string' || !Number.isSafeInteger(run.id)) || result.check_runs.length === 0 && Number.isSafeInteger(result.total_count) && (page - 1) * 100 < result.total_count) throw new GitHubError(502, 'Check revision does not match');
    return { items: result.check_runs, nextPage: result.check_runs.length > 0 && (Number.isSafeInteger(result.total_count) ? page * 100 < result.total_count : result.check_runs.length === 100) && page < 10000 ? page + 1 : null };
  }
  async statusesPage(owner: string, repo: string, headSha: string, page = 1, signal?: AbortSignal): Promise<GitHubCheckPage<GitHubCommitStatus>> {
    if (!/^[a-f0-9]{40}$/i.test(headSha) || !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid status reference');
    const items = await this.request<GitHubCommitStatus[]>(`${repoPath(owner, repo)}/commits/${headSha}/statuses?per_page=100&page=${page}`, { signal, cache: 'no-store' });
    if (!Array.isArray(items) || items.some((item) => !item || typeof item.context !== 'string' || !Number.isSafeInteger(item.id))) throw new GitHubError(502, 'Invalid check status response');
    return { items, nextPage: items.length === 100 && page < 10000 ? page + 1 : null };
  }
  pullReviews(owner: string, repo: string, number: number, signal?: AbortSignal): Promise<GitHubPullReview[]> {
    return this.request(`${repoPath(owner, repo)}/pulls/${number}/reviews?per_page=100`, { signal });
  }
  createPullReview(owner: string, repo: string, number: number, event: GitHubReviewEvent, body: string, commitId: string | undefined): Promise<GitHubPullReview> {
    if (!Number.isInteger(number) || number < 1 || !/^[a-f0-9]{40}$/i.test(commitId ?? '')) throw new Error('Invalid pull request review');
    if (event !== 'APPROVE' && event !== 'COMMENT' && event !== 'REQUEST_CHANGES') throw new Error('Invalid review event');
    return this.request(`${repoPath(owner, repo)}/pulls/${number}/reviews`, { method: 'POST', body: JSON.stringify({ event, body, commit_id: commitId }) });
  }
  pullFilesPage(owner: string, repo: string, number: number, page = 1, signal?: AbortSignal): Promise<GitHubPullFile[]> {
    if (!Number.isInteger(page) || page < 1) throw new Error('Invalid file page');
    return this.request(`${repoPath(owner, repo)}/pulls/${number}/files?per_page=100&page=${page}`, { signal });
  }
  async pullFiles(owner: string, repo: string, number: number, signal?: AbortSignal): Promise<GitHubPullFile[]> {
    const files: GitHubPullFile[] = [];
    // GitHub caps this endpoint at 3,000 files. Callers compare with changed_files.
    for (let page = 1; page <= 30; page += 1) {
      const batch = await this.request<GitHubPullFile[]>(`${repoPath(owner, repo)}/pulls/${number}/files?per_page=100&page=${page}`, { signal });
      files.push(...batch);
      if (batch.length < 100) break;
    }
    return files;
  }
  mergePullRequest(owner: string, repo: string, number: number, sha: string, method: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<GitHubMergeResult> {
    return this.request(`${repoPath(owner, repo)}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ sha, merge_method: method }) });
  }
  closePullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequest> {
    return this.request(`${repoPath(owner, repo)}/pulls/${number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) });
  }
  async downloadBlob(owner: string, repo: string, sha: string, signal?: AbortSignal, transferHeaders: Record<string, string> = {}): Promise<Response> {
    const response = await this.transport(`https://api.github.com${repoPath(owner, repo)}/git/blobs/${encodePart(sha)}`, {
      signal, redirect: 'error', headers: { ...transferHeaders, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${await this.token()}` },
    });
    if (!response.ok && !(response.status === 416 && transferHeaders.Range)) throw new GitHubError(response.status, 'GitHub changed file download failed');
    return response;
  }
  createPullRequest(owner: string, repo: string, input: { title: string; body: string; head: string; base: string }): Promise<GitHubPullRequest> {
    return this.request(`${repoPath(owner, repo)}/pulls`, { method: 'POST', body: JSON.stringify(input) });
  }
  openPullRequestForHead(owner: string, repo: string, headOwner: string, headBranch: string, base: string): Promise<GitHubPullRequest[]> {
    const query = new URLSearchParams({ state: 'open', head: `${headOwner}:${headBranch}`, base, per_page: '1' });
    return this.request(`${repoPath(owner, repo)}/pulls?${query.toString()}`);
  }
  commits(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubCommit[]> { return this.request(`${repoPath(owner, repo)}/commits?per_page=100`, { signal }); }
  async commitsPage(owner: string, repo: string, page = 1, signal?: AbortSignal): Promise<GitHubPage<GitHubCommit>> {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid history page');
    try {
      const items = await this.request<GitHubCommit[]>(`${repoPath(owner, repo)}/commits?per_page=100&page=${page}`, { signal });
      return { items, nextPage: items.length === 100 ? page + 1 : null };
    } catch (error) { if (error instanceof GitHubError && error.status === 409) return { items: [], nextPage: null }; throw error; }
  }
  commit(owner: string, repo: string, sha: string, signal?: AbortSignal): Promise<GitHubCommit> { return this.request(`${repoPath(owner, repo)}/commits/${encodePart(sha)}`, { signal }); }
  releases(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubRelease[]> { return this.request(`${repoPath(owner, repo)}/releases?per_page=30`, { signal, cache: 'no-store' }); }
  async releasesPage(owner: string, repo: string, page = 1, signal?: AbortSignal): Promise<GitHubReleasePage> {
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid release page');
    const items = await this.request<GitHubRelease[]>(`${repoPath(owner, repo)}/releases?per_page=30&page=${page}`, { signal, cache: 'no-store' });
    return { items, nextPage: items.length === 30 && page < 10000 ? page + 1 : null };
  }
  async releaseByTag(owner: string, repo: string, tag: string, signal?: AbortSignal): Promise<GitHubRelease | null> {
    if (!tag || tag.length > 255 || /[\u0000-\u0020\u007f]/u.test(tag)) throw new Error('Invalid release tag');
    try { return await this.request(`${repoPath(owner, repo)}/releases/tags/${encodePart(tag)}`, { signal, cache: 'no-store' }); }
    catch (error) { if (error instanceof GitHubError && error.status === 404) return null; throw error; }
  }
  release(owner: string, repo: string, id: number, signal?: AbortSignal): Promise<GitHubCreatedRelease> { return this.request(`${repoPath(owner, repo)}/releases/${id}`, { signal, cache: 'no-store' }); }
  createRelease(owner: string, repo: string, input: { tagName: string; target: string; name: string; body: string; prerelease: boolean }, signal?: AbortSignal): Promise<GitHubCreatedRelease> {
    return this.request(`${repoPath(owner, repo)}/releases`, { method: 'POST', body: JSON.stringify({ tag_name: input.tagName, target_commitish: input.target, name: input.name, body: input.body, draft: true, prerelease: input.prerelease }), signal });
  }
  updateRelease(owner: string, repo: string, id: number, input: { name?: string; body?: string; draft?: boolean; prerelease?: boolean }, signal?: AbortSignal): Promise<GitHubCreatedRelease> {
    return this.request(`${repoPath(owner, repo)}/releases/${id}`, { method: 'PATCH', body: JSON.stringify(input), signal });
  }
  deleteRelease(owner: string, repo: string, id: number): Promise<void> {
    return this.request(`${repoPath(owner, repo)}/releases/${id}`, { method: 'DELETE' });
  }
  deleteReleaseAsset(owner: string, repo: string, id: number): Promise<void> {
    return this.request(`${repoPath(owner, repo)}/releases/assets/${id}`, { method: 'DELETE' });
  }
  releaseAsset(owner: string, repo: string, id: number, signal?: AbortSignal): Promise<GitHubReleaseAsset> { return this.request(`${repoPath(owner, repo)}/releases/assets/${id}`, { signal }); }
  async downloadReleaseAsset(owner: string, repo: string, id: number, signal?: AbortSignal, transferHeaders: Record<string, string> = {}): Promise<Response> {
    const response = await this.transport(`https://api.github.com${repoPath(owner, repo)}/releases/assets/${id}`, {
      signal, redirect: 'follow', headers: { ...transferHeaders, Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${await this.token()}` },
    });
    if (!response.ok && !(response.status === 416 && transferHeaders.Range)) throw new GitHubError(response.status, 'GitHub release download failed');
    if (response.status !== 416 && response.headers.get('content-type')?.toLowerCase().includes('json')) throw new GitHubError(502, 'GitHub returned metadata instead of the release file');
    return response;
  }
  async archive(owner: string, repo: string, ref: string, signal?: AbortSignal, transferHeaders: Record<string, string> = {}): Promise<Response> {
    const response = await this.transport(`https://api.github.com${repoPath(owner, repo)}/zipball/${encodePart(ref)}`, {
      signal, redirect: 'follow',
      headers: { ...transferHeaders, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${await this.token()}` },
    });
    if (!response.ok && !(response.status === 416 && transferHeaders.Range)) throw new GitHubError(response.status, 'GitHub archive request failed');
    return response;
  }
}
