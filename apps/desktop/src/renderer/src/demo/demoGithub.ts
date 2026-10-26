import type { GitHubComment, GitHubIssue, GitHubPullRequest } from '@easyhub/github';
import { copy, DEMO_USER, demoCommit, makeRepository, sha, type DemoRepository, type DemoState } from './demoData';

export function demoError(message: string, code = 'VALIDATION'): Error {
  return Object.assign(new Error(message), { code });
}
const text = (value: unknown): string => String(value ?? '');
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
export function findRepository(state: DemoState, owner: unknown, name: unknown): DemoRepository {
  const item = state.repositories.find(
    (entry) => entry.repo.full_name.toLowerCase() === `${text(owner)}/${text(name)}`.toLowerCase(),
  );
  if (!item) throw demoError('这个演示项目不存在。', 'NOT_FOUND');
  return item;
}
export function writable(item: DemoRepository): void {
  if (item.repo.owner.login !== DEMO_USER.login || !item.repo.permissions?.push)
    throw demoError('这个演示项目没有写入权限。', 'FORBIDDEN');
  if (item.repo.archived) throw demoError('请先取消项目存档。', 'FORBIDDEN');
}
function page<T>(items: T[], raw: unknown, size = 30): { items: T[]; nextPage: number | null } {
  const number = Number(raw ?? 1);
  if (!Number.isInteger(number) || number < 1) throw demoError('页码无效。');
  return {
    items: items.slice((number - 1) * size, number * size),
    nextPage: items.length > number * size ? number + 1 : null,
  };
}
function searchPage<T>(items: T[], number: unknown) {
  const result = page(items, number);
  return {
    ...result,
    page: Number(number ?? 1),
    totalCount: items.length,
    hasNextPage: result.nextPage !== null,
    incompleteResults: false,
  };
}

/** Only this in-memory state is reachable. Unknown actions never fall through to native IPC. */
export function demoGithub(state: DemoState, action: string, ...args: unknown[]): unknown {
  const [owner, name, third, fourth] = args;
  const own = state.repositories.filter((entry) => entry.repo.owner.login === DEMO_USER.login);
  const publicRepos = state.repositories.filter((entry) => !entry.repo.private);
  const newId = (): number => ++state.nextId;
  if (action === 'user') return DEMO_USER;
  if (action === 'appUpdate')
    return { available: false, currentVersion: '1.4.0', latestVersion: '1.4.0', releaseUrl: '' };
  if (action === 'repos')
    return page(
      own.map((entry) => entry.repo),
      owner,
      100,
    ).items;
  if (action === 'activityCounts')
    return Object.fromEntries(
      state.repositories.map((entry) => [
        entry.repo.id,
        {
          issues: entry.issues.filter((issue) => issue.state === 'open').length,
          closedIssues: entry.issues.filter((issue) => issue.state === 'closed').length,
          pullRequests: entry.pulls.filter((pull) => pull.state === 'open').length,
          closedPullRequests: entry.pulls.filter((pull) => pull.state === 'closed').length,
        },
      ]),
    );
  if (action === 'profile')
    return text(owner) === DEMO_USER.login
      ? DEMO_USER
      : { ...DEMO_USER, id: 910100, login: text(owner), name: text(owner), public_repos: publicRepos.length };
  if (action === 'contributions') {
    const year = Number(text(name).slice(0, 4)) || new Date().getUTCFullYear();
    return {
      total: 12,
      years: [year, year - 1],
      weeks: Array.from({ length: 12 }, (_, week) => ({
        contributionDays: Array.from({ length: 7 }, (_, day) => ({
          date: new Date(Date.UTC(year, 0, week * 7 + day + 1)).toISOString().slice(0, 10),
          contributionCount: day % 3,
          color: day % 3 ? '#40c463' : '#ebedf0',
        })),
      })),
      repositories: publicRepos
        .slice(0, 3)
        .map((entry) => ({ fullName: entry.repo.full_name, isPrivate: false, count: 4, kind: '更新' })),
    };
  }
  if (action === 'trending')
    return {
      ...page(
        publicRepos.map((entry) => entry.repo),
        name,
      ),
      page: Number(name ?? 1),
      hasNextPage: false,
    };
  if (action === 'searchPublicRepos' || action === 'searchPublicReposPage') {
    const matches = publicRepos
      .filter((entry) =>
        `${entry.repo.full_name} ${entry.repo.description}`.toLowerCase().includes(text(owner).toLowerCase()),
      )
      .map((entry) => entry.repo);
    return action.endsWith('Page') ? searchPage(matches, name) : matches;
  }
  if (action === 'searchUsers' || action === 'searchUsersPage') {
    const users = [
      DEMO_USER,
      { ...DEMO_USER, id: 910100, login: 'sample-author' },
      { ...DEMO_USER, id: 910200, login: 'contributor' },
    ]
      .filter((user) => user.login.includes(text(owner).toLowerCase()))
      .map((user) => ({ ...user, type: 'User' }));
    return action.endsWith('Page') ? searchPage(users, name) : users;
  }
  if (action === 'topStarredRepos')
    return publicRepos
      .filter((entry) => entry.repo.owner.login === text(owner))
      .map((entry) => entry.repo)
      .slice(0, 3);
  if (action === 'starredRepos')
    return page(
      publicRepos.filter((entry) => state.starred.has(entry.repo.id)).map((entry) => entry.repo),
      owner,
    ).items;
  if (action === 'createRepo') {
    if (
      !/^[\w.-]{1,100}$/u.test(text(owner)) ||
      own.some((entry) => entry.repo.name.toLowerCase() === text(owner).toLowerCase())
    )
      throw demoError('请使用一个未被占用的项目名称。');
    const created = makeRepository(newId(), DEMO_USER.login, text(owner), text(name), Boolean(third));
    state.repositories.unshift(created);
    return created.repo;
  }
  const item = findRepository(state, owner, name);
  const repo = item.repo;
  const pull = (): GitHubPullRequest => {
    const value = item.pulls.find((entry) => entry.number === Number(third));
    if (!value) throw demoError('找不到这个合并请求。', 'NOT_FOUND');
    return value;
  };
  const commit = () => {
    const value = item.commits.find((entry) => entry.sha === text(third));
    if (!value) throw demoError('找不到这条修改记录。', 'NOT_FOUND');
    return value;
  };
  const addComment = (number: number, body: string): GitHubComment => {
    if (!body.trim()) throw demoError('请填写回复内容。');
    const result = { id: newId(), body, created_at: new Date().toISOString(), user: { login: DEMO_USER.login } };
    (item.comments[number] ??= []).push(result);
    const topic =
      item.issues.find((entry) => entry.number === number) ?? item.pulls.find((entry) => entry.number === number);
    if (topic) topic.comments++;
    return result;
  };
  switch (action) {
    case 'repository':
      return repo;
    case 'publicRepo':
      if (repo.private) throw demoError('这个项目不是公开项目。', 'FORBIDDEN');
      return repo;
    case 'isStarred':
      return state.starred.has(repo.id);
    case 'setStarred':
      if (third) state.starred.add(repo.id);
      else state.starred.delete(repo.id);
      return undefined;
    case 'myFork':
      return own.find((entry) => entry.repo.parent?.id === repo.id)?.repo ?? null;
    case 'forkRepo': {
      if (repo.owner.login === DEMO_USER.login || repo.archived || repo.allow_forking === false)
        throw demoError('这个项目暂时不能创建仓库副本。');
      const existing = own.find((entry) => entry.repo.parent?.id === repo.id);
      if (existing) return existing.repo;
      const fork = makeRepository(newId(), DEMO_USER.login, text(third) || repo.name, repo.description ?? '');
      if (own.some((entry) => entry.repo.name.toLowerCase() === fork.repo.name.toLowerCase()))
        throw demoError('请使用一个未被占用的项目名称。');
      fork.repo.fork = true;
      fork.repo.parent = {
        id: repo.id,
        full_name: repo.full_name,
        owner: { login: repo.owner.login },
        name: repo.name,
        default_branch: repo.default_branch,
        html_url: repo.html_url ?? '',
      };
      fork.readme = item.readme;
      fork.commits = copy(item.commits);
      state.repositories.push(fork);
      return fork.repo;
    }
    case 'forkComparison': {
      const parent = repo.parent && findRepository(state, repo.parent.owner.login, repo.parent.name);
      return {
        status: item.commits.length > (parent?.commits.length ?? 0) ? 'ahead' : 'identical',
        ahead_by: Math.max(0, item.commits.length - (parent?.commits.length ?? 0)),
        behind_by: 0,
        total_commits: item.commits.length,
        openRequest: parent?.pulls.find((entry) => entry.state === 'open' && entry.head.repo?.id === repo.id) ?? null,
      };
    }
    case 'submitForkContribution': {
      writable(item);
      if (!repo.parent) throw demoError('这个项目不是仓库副本。');
      const parent = findRepository(state, repo.parent.owner.login, repo.parent.name);
      if (parent.pulls.some((entry) => entry.state === 'open' && entry.head.repo?.id === repo.id))
        throw demoError('已经有一个等待处理的合并请求。');
      const created: GitHubPullRequest = {
        id: newId(),
        number: newId(),
        title: text(third),
        body: text(fourth),
        state: 'open',
        draft: false,
        merged: false,
        merged_at: null,
        created_at: new Date().toISOString(),
        html_url: `${parent.repo.html_url}/pull/${state.nextId}`,
        user: { login: DEMO_USER.login },
        comments: 0,
        changed_files: item.commits[0]?.files?.length ?? 0,
        mergeable: true,
        head: {
          ref: repo.default_branch,
          label: `${DEMO_USER.login}:${repo.default_branch}`,
          sha: item.commits[0]!.sha,
          repo,
        },
        base: { ref: parent.repo.default_branch, sha: parent.commits[0]!.sha, repo: parent.repo },
      };
      parent.pulls.push(created);
      parent.pullFiles[created.number] = copy(item.commits[0]?.files ?? []);
      return created;
    }
    case 'updateVisibility':
      writable(item);
      repo.private = Boolean(third);
      return repo;
    case 'setArchived':
      if (repo.owner.login !== DEMO_USER.login) throw demoError('你没有这个项目的管理权限。', 'FORBIDDEN');
      repo.archived = Boolean(third);
      return repo;
    case 'transferRepo':
      writable(item);
      repo.owner = { login: text(third) };
      repo.full_name = `${third}/${repo.name}`;
      repo.permissions = { admin: false, push: false, pull: true };
      return repo;
    case 'branchProtectionStatus':
      return {
        branch: repo.default_branch,
        enabled: item.protected,
        externalRules: false,
        reviewsRequired: item.protected ? 1 : null,
      };
    case 'setDefaultBranchProtection':
      writable(item);
      item.protected = Boolean(object(third).enabled);
      return {
        branch: repo.default_branch,
        enabled: item.protected,
        externalRules: false,
        reviewsRequired: item.protected ? 1 : null,
      };
    case 'deleteRepoScope':
      return true;
    case 'deleteRepo':
      writable(item);
      if (Number(third) !== repo.id || fourth !== repo.full_name) throw demoError('请输入正确的项目名称确认。');
      state.repositories = state.repositories.filter((entry) => entry !== item);
      return undefined;
    case 'readme':
      return item.readme;
    case 'issues':
      return item.issues.filter((issue) => third === 'all' || issue.state === third);
    case 'issuesPage':
      return page(
        item.issues.filter((issue) => third === 'all' || issue.state === third),
        fourth,
      );
    case 'createIssue': {
      if (repo.archived || !text(third).trim()) throw demoError('请填写问题标题，并确认项目未存档。');
      const issue: GitHubIssue = {
        id: newId(),
        number:
          Math.max(0, ...item.issues.map((entry) => entry.number), ...item.pulls.map((entry) => entry.number)) + 1,
        title: text(third),
        body: text(fourth),
        state: 'open',
        user: { login: DEMO_USER.login },
        created_at: new Date().toISOString(),
        comments: 0,
      };
      item.issues.unshift(issue);
      repo.open_issues_count++;
      return issue;
    }
    case 'updateIssue': {
      writable(item);
      const issue = item.issues.find((entry) => entry.number === Number(third));
      if (!issue || !['open', 'closed'].includes(text(fourth))) throw demoError('找不到这个问题。');
      issue.state = fourth as 'open' | 'closed';
      repo.open_issues_count = item.issues.filter((entry) => entry.state === 'open').length;
      return issue;
    }
    case 'comments':
      return item.comments[Number(third)] ?? [];
    case 'commentsPage':
      return page(item.comments[Number(third)] ?? [], fourth);
    case 'createComment':
      if (repo.archived) throw demoError('存档项目不能回复。');
      return addComment(Number(third), text(fourth));
    case 'searchDiscussions': {
      const query = object(third);
      const entries = query.kind === 'pulls' ? item.pulls : item.issues;
      return searchPage(
        entries.filter(
          (entry) =>
            (query.state === 'all' || entry.state === query.state) &&
            `${entry.number} ${entry.title}`.toLowerCase().includes(text(query.query).replace(/^#/u, '').toLowerCase()),
        ),
        query.page,
      );
    }
    case 'pullRequests':
      return page(item.pulls, third).items;
    case 'pullRequestsPage':
      return page(
        item.pulls.filter((entry) => entry.state === third),
        fourth,
      ).items;
    case 'pullRequest':
      return pull();
    case 'pullFiles':
      return item.pullFiles[pull().number] ?? [];
    case 'pullReviewContext': {
      const value = pull();
      if (fourth !== value.head.sha) throw demoError('修改内容已更新，请刷新后重试。', 'CONFLICT');
      return { repository: repo, pullRequest: value, files: item.pullFiles[value.number] ?? [], filesTruncated: false };
    }
    case 'pullChecks': {
      const value = pull();
      const query = object(fourth);
      if (query.headSha !== value.head.sha) throw demoError('修改内容已更新，请刷新后重试。', 'CONFLICT');
      return {
        headSha: value.head.sha,
        checkRuns: query.checkPage === null ? null : { state: 'available', items: [], nextPage: null },
        statuses: query.statusPage === null ? null : { state: 'available', items: [], nextPage: null },
      };
    }
    case 'acceptPullRequest':
    case 'rejectPullRequest': {
      writable(item);
      const value = pull();
      const expected = object(fourth);
      if (
        value.state !== 'open' ||
        expected.expectedHeadSha !== value.head.sha ||
        expected.expectedBaseSha !== value.base.sha ||
        expected.expectedBaseRef !== value.base.ref
      )
        throw demoError('修改内容已更新，请刷新后重试。', 'CONFLICT');
      value.state = 'closed';
      if (action === 'rejectPullRequest') {
        if (text(expected.reason).trim()) addComment(value.number, text(expected.reason));
        return value;
      }
      value.merged = true;
      value.merged_at = new Date().toISOString();
      const saved = demoCommit(
        newId(),
        value.title,
        (item.pullFiles[value.number] ?? []).map((file) => file.filename),
      );
      item.commits.unshift(saved);
      repo.updated_at = saved.commit.author!.date;
      return { merged: true, sha: saved.sha, message: 'Merged in demo memory' };
    }
    case 'createPullRequest': {
      const input = object(third);
      if (!text(input.title).trim() || !text(input.head).trim() || input.base !== repo.default_branch)
        throw demoError('请填写标题，并选择有效的分支。');
      const value: GitHubPullRequest = {
        id: newId(),
        number: newId(),
        title: text(input.title),
        body: text(input.body),
        state: 'open',
        draft: Boolean(input.draft),
        merged: false,
        merged_at: null,
        created_at: new Date().toISOString(),
        html_url: `${repo.html_url}/pull/${state.nextId}`,
        user: { login: DEMO_USER.login },
        comments: 0,
        mergeable: true,
        head: { ref: text(input.head), label: text(input.head), sha: sha(newId()), repo },
        base: { ref: repo.default_branch, sha: item.commits[0]!.sha, repo },
      };
      item.pulls.push(value);
      item.pullFiles[value.number] = copy(item.commits[0]?.files ?? []);
      return value;
    }
    case 'commits':
      return item.commits;
    case 'commitsPage':
      return page(item.commits, third).items;
    case 'commit':
      return commit();
    case 'commitChangesPage':
      return { commit: Number(fourth) === 1 ? commit() : { ...commit(), files: [] }, nextPage: null, limited: false };
    case 'sourceHistory': {
      const query = object(third);
      return page(
        item.commits.filter((entry) => !query.path || entry.files?.some((file) => file.filename === query.path)),
        query.page,
      );
    }
    case 'branchesPage':
      return page(
        [{ name: repo.default_branch, commit: { sha: item.commits[0]!.sha }, protected: item.protected }],
        third,
      );
    case 'releases':
      return item.releases;
    case 'releasesPage':
      return page(item.releases, third);
    case 'releaseByTag': {
      const release = item.releases.find((entry) => entry.tag_name === third);
      if (!release) throw demoError('找不到这个发行版。', 'NOT_FOUND');
      return release;
    }
    default:
      throw demoError(`演示模式暂不支持这个操作：${action}`, 'VALIDATION');
  }
}
