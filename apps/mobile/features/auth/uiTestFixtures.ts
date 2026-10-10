import { GitHubClient, type GitHubComment, type GitHubCommit, type GitHubIssue, type GitHubPullFile, type GitHubPullRequest, type GitHubPullReview, type GitHubRelease, type GitHubRepo, type GitHubUser, type Transport } from '@easyhub/github';

// Only SessionProvider's __DEV__ + EXPO_PUBLIC_UI_TEST guard can activate this transport.
// It has no network fallback, and every mutation affects this in-memory fixture instance only.
const avatar = 'data:image/png;base64,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';
const createdAt = '2026-10-07T06:00:00.000Z';
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const paginationHeadSha = '1'.repeat(40);
// Exact generated program fixtures: native analysis must inspect these real bytes.
const nativeExe = { name: 'easyhub-x64.exe', size: 2560, sha256: '36e75236158600a3e62b120c1362d2f00465397bcf34877d5827b5ef10a2cec3', blobSha: '051f676ebab6d771acbd8478d3366b143fa9a076',
  base64: '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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAALBAAAIwgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==' };
const dalvikApk = { name: 'easyhub-dalvik.apk', size: 1616, sha256: '4647fdca8ffcd130a30c309ef4f1e79b3fb66f44ec216245fab24329d42344db', blobSha: '3decced0f84b5cfd09ca426a8868304a3bece13b',
  base64: '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' };
export const uiFixtureUser: GitHubUser = {
  id: 91000, login: 'easyhub-ui', name: 'FuFu · Android 界面测试', avatar_url: avatar,
  html_url: 'https://github.com/easyhub-ui', bio: '用于检查小屏幕、长项目名称与中英文排版的本地模拟账号。',
  location: 'Shanghai · 上海', company: 'EasyHub UI Test', followers: 1234, following: 56, public_repos: 4,
};

function repository(id: number, name: string, owner = uiFixtureUser.login, isPrivate = false): GitHubRepo {
  const own = owner === uiFixtureUser.login;
  return { id, name, full_name: `${owner}/${name}`, html_url: `https://github.com/${owner}/${name}`, private: isPrivate,
    description: '让创作和分享更简单。A friendly companion for publishing projects, managing feedback and reviewing changes on Android.',
    default_branch: 'main', owner: { login: owner, avatar_url: avatar }, updated_at: createdAt, pushed_at: createdAt,
    created_at: '2024-02-10T00:00:00.000Z', language: 'TypeScript', stargazers_count: id === 91001 ? 123456 : 128,
    open_issues_count: 3, archived: false, fork: false, allow_forking: true, allow_merge_commit: true,
    allow_squash_merge: true, allow_rebase_merge: true, permissions: { admin: own, push: own, pull: true } };
}
const upstream = repository(91005, 'creator-studio', 'open-source-lab');
export const uiFixtureRepos: GitHubRepo[] = [
  repository(91001, 'EasyHub'),
  repository(91002, 'minecraft-navigation-companion-with-a-long-project-name'),
  repository(91003, 'personal-notes', uiFixtureUser.login, true),
  { ...repository(91004, 'community-contribution'), fork: true, parent: { id: upstream.id, full_name: upstream.full_name, owner: upstream.owner, name: upstream.name, default_branch: 'main', html_url: upstream.html_url! } },
  upstream,
];
const discoveryUsers = Array.from({ length: 27 }, (_, index) => ({ id: 92000 + index, login: `easyhub-creator-${String(index + 1).padStart(2, '0')}`, avatar_url: avatar, html_url: `https://github.com/easyhub-creator-${String(index + 1).padStart(2, '0')}`, type: 'User' }));
const discoveryRepos = Array.from({ length: 63 }, (_, index) => repository(92000 + index, `EasyHub-pagination-project-${String(index + 1).padStart(2, '0')}`, discoveryUsers[index % discoveryUsers.length].login));
function pageItems<T>(items: T[], url: URL, defaultSize = 100): T[] {
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page')) || defaultSize));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  return items.slice((page - 1) * size, page * size);
}

const readme = `# EasyHub · 让 GitHub 更简单

在手机上查看项目、回复问题、下载版本，并审阅别人提交的改进。

## 功能与平台

| 功能 | Android | 桌面 |
| --- | --- | --- |
| 项目管理 | 支持 | 支持 |
| 审查代码 | 支持 | 支持 |

- 浏览公开和私有项目
- 查看长项目名和多行说明在窄屏上的表现
- [下载最新版本](https://github.com/easyhub-ui/EasyHub/releases/tag/v1.2.0)

\`\`\`ts
const veryLongVariableNameForHorizontalScrolling = 'UI layout verification';
\`\`\`

<details><summary>更多介绍</summary><p>折叠内容和普通文字均可阅读。</p></details>
`;
const readmeHtml = '<h1 align="center">EasyHub · 让 GitHub 更简单</h1><p>在手机上查看项目、回复问题、下载版本，并审阅别人提交的改进。</p><h2>功能与平台</h2><table><thead><tr><th>功能</th><th>Android</th><th>桌面</th></tr></thead><tbody><tr><td>项目管理</td><td>支持</td><td>支持</td></tr><tr><td>审查代码</td><td>支持</td><td>支持</td></tr></tbody></table><ul><li>浏览公开和私有项目</li><li>查看长项目名和多行说明在窄屏上的表现</li><li><a href="https://github.com/easyhub-ui/EasyHub/releases/tag/v1.2.0">下载最新版本</a></li></ul><pre><code>const veryLongVariableNameForHorizontalScrolling = &quot;UI layout verification&quot;;</code></pre><details><summary>更多介绍</summary><p>折叠内容和普通文字均可阅读。</p></details>';
const issues: GitHubIssue[] = [
  { id: 91007, number: 7, title: '在较窄的手机屏幕中，长文件名与操作按钮是否能够完整显示？', body: '## 复现步骤\n\n1. 打开一个名称很长的项目。\n2. 切换到代码提交审查。\n3. 检查按钮和正文是否越过屏幕。\n\nExpected: readable content with comfortable spacing.\n\n| 设备 | 宽度 |\n| --- | --- |\n| 小屏手机 | 320 dp |', state: 'open', created_at: createdAt, user: { login: 'contributor-with-a-long-name' }, comments: 2 },
  { id: 91008, number: 8, title: 'Release download progress and cancellation on Android', body: '下载速度、剩余时间和取消按钮需要保持可读。', state: 'open', created_at: createdAt, user: { login: 'design-reviewer' }, comments: 0 },
  { id: 91006, number: 6, title: '已解决：内容翻译开关的状态保留', body: '问题已经解决。', state: 'closed', created_at: createdAt, user: { login: uiFixtureUser.login }, comments: 1 },
  { id: 91101, number: 101, title: 'EasyHub pagination validation · 101 replies / 分页检查', body: '这个问题保留 101 条实际模拟回复，用于验证第二页加载、回复排序与失败重试。原问题 #7 的数据不受影响。', state: 'open', created_at: createdAt, user: { login: 'design-reviewer' }, comments: 101 },
];
function pull(number: number, owner: string, name: string): GitHubPullRequest {
  const open = number === 12 || number === 102;
  return { id: 95000 + number, number, title: number === 12 ? '优化 Android 小屏幕中长文件名、审查按钮与多行项目描述的显示' : number === 102 ? 'EasyHub pagination review · 101 reviews / 审查分页检查' : 'Improve download progress and empty states', body: '## 修改说明\n\n这次改进包括移动端排版、按钮响应范围和较长正文的显示。\n\n- Keep long paths readable\n- Prevent action buttons from overflowing\n- Preserve Markdown tables and code blocks', state: open ? 'open' : 'closed', draft: false,
    merged: !open, merged_at: !open ? createdAt : null, created_at: createdAt, html_url: `https://github.com/${owner}/${name}/pull/${number}`,
    user: { login: 'contributor-with-a-long-name' }, comments: number === 102 ? 101 : 2, changed_files: 4, additions: 52, deletions: 17, mergeable: true, mergeable_state: 'clean',
    head: { ref: 'mobile-layout-improvements', label: 'contributor-with-a-long-name:mobile-layout-improvements', sha: number === 102 ? paginationHeadSha : headSha,
      repo: { id: 91099, name, full_name: `contributor-with-a-long-name/${name}`, owner: { login: 'contributor-with-a-long-name' } } },
    base: { ref: 'main', sha: baseSha, repo: { id: 91001, name, full_name: `${owner}/${name}`, owner: { login: owner } } } };
}
const pullFiles: GitHubPullFile[] = [
  { filename: 'apps/mobile/components/ProjectCardWithAnIntentionallyLongFileName.tsx', previous_filename: 'apps/mobile/components/ProjectCard.tsx', status: 'renamed', additions: 18, deletions: 6, sha: 'c'.repeat(40), patch: '@@ -12,3 +12,5 @@\n-<Text>{project.name}</Text>\n+<Text numberOfLines={2} style={{ flexShrink: 1 }}>\n+  {project.name}\n+</Text>\n // 项目名称可以正常换行' },
  { filename: 'apps/mobile/features/downloads/progress.ts', status: 'modified', additions: 24, deletions: 8, sha: 'd'.repeat(40), patch: '@@ -7,2 +7,4 @@\n-const progress = bytes / total;\n+const progress = total > 0 ? bytes / total : 0;\n+const label = formatDownloadedBytesWithAnIntentionallyLongFunctionName(bytes);' },
  { filename: 'resources/EasyHub-Windows-x64-with-a-long-asset-name.exe', status: 'added', additions: 0, deletions: 0, sha: nativeExe.blobSha },
  { filename: 'apps/mobile/components/DeprecatedDownloadButton.tsx', status: 'removed', additions: 0, deletions: 3, sha: 'f'.repeat(40), patch: '@@ -1,3 +0,0 @@\n-export function Button() {\n-  return null;\n-}' },
];
const releases: GitHubRelease[] = [
  { id: 101, tag_name: 'v1.2.0', name: 'EasyHub 1.2.0 · 更完整的 Android 体验', body: '## 本次更新\n\n- 项目管理、代码审查和内容翻译\n- 下载速度与剩余时间显示\n- 改进手机界面排版\n\n**请选择适合你设备的文件。**\n\n| 安装包 | 适合设备 |\n| --- | --- |\n| arm64 APK | 现代 Android 手机 |\n| universal APK | 其他 Android 设备 |', draft: false, prerelease: false, published_at: createdAt,
    assets: [
      { id: 201, name: 'EasyHub-Android-1.2.0-arm64.apk', label: null, size: 44_459_622, content_type: 'application/vnd.android.package-archive', download_count: 1234, state: 'uploaded' },
      { id: 202, name: 'EasyHub-Windows-1.2.0-x64-portable-with-an-intentionally-long-file-name.exe', label: null, size: 181_403_648, content_type: 'application/octet-stream', download_count: 789, state: 'uploaded' },
      { id: 203, name: '调试符号与详细更新说明.zip', label: null, size: 104_857, content_type: 'application/zip', download_count: 12, state: 'uploaded' },
      { id: 404, name: 'easyhub-analysis-x64.exe', label: 'Native PE analysis fixture', size: nativeExe.size, content_type: 'application/octet-stream', download_count: 1, state: 'uploaded', digest: `sha256:${nativeExe.sha256}` },
      { id: 405, name: 'easyhub-dalvik.apk', label: 'Dalvik analysis fixture', size: dalvikApk.size, content_type: 'application/vnd.android.package-archive', download_count: 1, state: 'uploaded', digest: `sha256:${dalvikApk.sha256}` },
      { id: 406, name: 'easyhub-invalid-sha.exe', label: 'Intentionally mismatched digest fixture', size: nativeExe.size, content_type: 'application/octet-stream', download_count: 0, state: 'uploaded', digest: `sha256:${'0'.repeat(64)}` },
    ] },
  { id: 102, tag_name: 'v1.1.1-beta.2', name: 'Preview release · 预览版', body: '这个发行版没有额外下载附件，可下载项目源码。', draft: false, prerelease: true, published_at: '2026-09-24T09:00:00.000Z', assets: [] },
];
const commits: GitHubCommit[] = [
  { sha: headSha, commit: { message: '改进移动端排版与代码审查体验', author: { name: 'FuFu', date: createdAt } }, author: { login: uiFixtureUser.login }, stats: { additions: 52, deletions: 17 }, files: pullFiles.map((file) => ({ filename: file.filename, status: file.status })) },
  { sha: baseSha, commit: { message: 'Support Markdown tables, comments and source downloads', author: { name: 'contributor-with-a-long-name', date: '2026-10-06T04:00:00.000Z' } }, author: { login: 'contributor-with-a-long-name' }, stats: { additions: 124, deletions: 9 }, files: [{ filename: 'README.md', status: 'modified' }] },
];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const text = (value: string, type = 'text/plain') => new Response(value, { headers: { 'Content-Type': type } });
const binary = (value: { base64: string; size: number }, type = 'application/octet-stream', signal?: AbortSignal | null) => {
  const bytes = Uint8Array.from(atob(value.base64), (character) => character.charCodeAt(0));
  const response = new Response(bytes.buffer, { headers: { 'Content-Type': type, 'Content-Length': String(value.size) } });
  let offset = 0;
  let cancelled = false;
  let abort = () => {};
  const chunkSize = Math.ceil(bytes.length / 10);
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      abort = () => {
        const error = new Error('The UI fixture download was cancelled');
        error.name = 'AbortError';
        controller.error(error);
      };
      signal?.addEventListener('abort', abort);
      if (signal?.aborted) abort();
    },
    async pull(controller) {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      if (cancelled || signal?.aborted) return;
      const end = Math.min(bytes.length, offset + chunkSize);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
      if (offset === bytes.length) {
        signal?.removeEventListener('abort', abort);
        controller.close();
      }
    },
    cancel() { cancelled = true; signal?.removeEventListener('abort', abort); },
  }, { highWaterMark: 0 });
  // React Native's default Response lacks a readable body; provide the real bytes
  // through the same streaming interface used by production expo/fetch downloads.
  Object.defineProperty(response, 'body', { value: stream });
  return response;
};

function discussion(pull: GitHubPullRequest): GitHubIssue {
  return { id: pull.id, number: pull.number, title: pull.title, body: pull.body, state: pull.state, created_at: pull.created_at, user: pull.user, comments: pull.comments, pull_request: {} };
}

export function createUiTestTransport(): Transport {
  const repos = clone([...uiFixtureRepos, ...discoveryRepos]);
  const starred = new Set([upstream.full_name.toLowerCase(), repos[0].full_name.toLowerCase()]);
  const extraQuestions: GitHubIssue[] = Array.from({ length: 58 }, (_, index) => ({ id: 96000 + index, number: 200 + index,
    title: `EasyHub pagination search result ${String(index + 1).padStart(2, '0')} · 标题搜索检查`, body: 'This discussion verifies paginated title searches.', state: index % 3 === 0 ? 'closed' : 'open', created_at: createdAt, user: { login: 'design-reviewer' }, comments: 0 }));
  const questions = new Map(repos.map((repo) => [repo.id, clone(repo.id === 91001 ? [...issues, ...extraQuestions] : issues)]));
  const replies = new Map<string, GitHubComment[]>();
  const reviews = new Map<string, GitHubPullReview[]>();
  let nextCommentId = 99000;
  let nextReviewId = 99500;
  const discussionKey = (repo: GitHubRepo, number: number) => `${repo.id}:${number}`;
  const pullList = (repo: GitHubRepo) => {
    const normal = [12, 102, 13].map((number) => pull(number, repo.owner.login, repo.name));
    const extra = repo.id === 91001 ? Array.from({ length: 58 }, (_, index) => {
      const item = pull(300 + index, repo.owner.login, repo.name);
      const open = index % 3 !== 0;
      return { ...item, title: `EasyHub review search pagination ${String(index + 1).padStart(2, '0')} · 审查搜索检查`, state: open ? 'open' as const : 'closed' as const, merged: !open, merged_at: open ? null : createdAt, comments: 0 };
    }) : [];
    return [...normal, ...extra].map((item) => ({ ...item, comments: replies.get(discussionKey(repo, item.number))?.length ?? item.comments,
      base: { ...item.base, repo: { id: repo.id, name: repo.name, full_name: repo.full_name, owner: { login: repo.owner.login } } } }));
  };
  const commentList = (repo: GitHubRepo, number: number): GitHubComment[] => {
    const key = discussionKey(repo, number);
    if (!replies.has(key)) {
      const count = number === 101 || number === 102 ? 101 : number === 7 || number === 12 || number === 13 ? 2 : number === 6 ? 1 : 0;
      replies.set(key, Array.from({ length: count }, (_, index) => ({ id: 1000000 + number * 1000 + index,
        body: count > 2 ? `Reply ${index + 1} / ${count} · 分页回复，${index === 100 ? '成功读取第 101 条回复。' : '用于确认按时间排序与逐页加载。'}` : index === 0 ? '感谢反馈！我在 320 dp 和较大的字体设置下检查了按钮换行。' : '**Additional context:** long file names should remain selectable and readable.\n\n```text\napps/mobile/components/LongProjectName.tsx\n```',
        created_at: new Date(Date.parse(createdAt) + index * 60000).toISOString(), user: { login: index % 2 === 0 ? uiFixtureUser.login : 'contributor-with-a-long-name' } })));
    }
    return replies.get(key)!;
  };
  const reviewList = (repo: GitHubRepo, number: number): GitHubPullReview[] => {
    const key = discussionKey(repo, number);
    if (!reviews.has(key)) reviews.set(key, Array.from({ length: number === 102 ? 101 : 1 }, (_, index) => ({ id: 2000000 + number * 1000 + index,
      state: index % 3 === 0 ? 'APPROVED' : 'COMMENTED', body: number === 102 ? `Review ${index + 1} / 101 · ${index === 100 ? '成功读取第 101 条审查。' : '审查分页测试。'}` : '整体方案清晰，请继续检查小屏幕下的操作按钮。',
      submitted_at: new Date(Date.parse(createdAt) + index * 60000).toISOString(), user: { login: 'design-reviewer' } })));
    return reviews.get(key)!;
  };
  return async (input, init = {}) => {
    if (init.signal?.aborted) {
      const cause = new Error('The UI fixture request was cancelled');
      cause.name = 'AbortError';
      throw cause;
    }
    const url = new URL(String(input));
    if (url.origin !== 'https://api.github.com') return json({ message: 'UI fixture has no external network access' }, 403);
    const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = init.method?.toUpperCase() || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (path[0] === 'graphql' && method === 'POST') {
      const variables = body.variables as Record<string, string>;
      if (variables.login) {
        const year = Number(variables.from.slice(0, 4));
        const weeks = Array.from({ length: 52 }, (_, week) => ({ contributionDays: Array.from({ length: 7 }, (_, day) => ({ date: new Date(Date.UTC(year, 0, 1 + week * 7 + day)).toISOString().slice(0, 10), contributionCount: (week + day) % 5, color: ['#ebf0f6', '#ace7c0', '#72c996', '#3caa74', '#18814f'][(week + day) % 5] })) }));
        const group = (count: number) => [{ repository: { nameWithOwner: repos[0].full_name, isPrivate: false }, contributions: { totalCount: count } }];
        return json({ data: { user: { contributionsCollection: { contributionYears: [2026, 2025, 2024], contributionCalendar: { totalContributions: 728, weeks }, commitContributionsByRepository: group(128), issueContributionsByRepository: group(9), pullRequestContributionsByRepository: group(4) } } } });
      }
      const activity = (owner: string, name: string) => {
        const repo = repos.find((item) => item.full_name.toLowerCase() === `${owner}/${name}`.toLowerCase());
        const list = questions.get(repo?.id ?? 0) ?? issues;
        const pulls = repo ? pullList(repo) : [];
        return { issues: { totalCount: list.filter((item) => item.state === 'open').length }, closedIssues: { totalCount: list.filter((item) => item.state === 'closed').length }, pullRequests: { totalCount: pulls.filter((item) => item.state === 'open').length }, closedPullRequests: { totalCount: pulls.filter((item) => item.state === 'closed').length } };
      };
      if (variables.owner) return json({ data: { repository: activity(variables.owner, variables.repo) } });
      return json({ data: Object.fromEntries(Object.keys(variables).filter((key) => /^owner\d+$/u.test(key)).map((key) => { const index = key.slice(5); return [`repo${index}`, activity(variables[key], variables[`name${index}`])]; })) });
    }
    if (path[0] === 'markdown' && method === 'POST') return text(readmeHtml, 'text/html');
    if (path[0] === 'user' && path.length === 1 && method === 'GET') return json(uiFixtureUser);
    if (path[0] === 'users' && path.length === 2 && method === 'GET') return json({ ...uiFixtureUser, login: path[1], name: path[1] === uiFixtureUser.login ? uiFixtureUser.name : 'Contributor · 社区创作者' });
    if (path[0] === 'users' && path[2] === 'repos' && path.length === 3 && method === 'GET') return json(pageItems(repos.filter((repo) => !repo.private && repo.owner.login.toLowerCase() === path[1].toLowerCase()), url));
    if (path[0] === 'user' && path[1] === 'repos' && method === 'GET') return json(url.searchParams.get('page') === '1' ? repos.filter((repo) => repo.owner.login === uiFixtureUser.login) : []);
    if (path[0] === 'user' && path[1] === 'starred') {
      if (path.length === 2) return json(repos.filter((repo) => starred.has(repo.full_name.toLowerCase())));
      const identity = `${path[2]}/${path[3]}`.toLowerCase();
      if (method === 'PUT') starred.add(identity);
      if (method === 'DELETE') starred.delete(identity);
      return json({}, method !== 'GET' || starred.has(identity) ? 204 : 404);
    }
    if (path[0] === 'search' && method === 'GET') {
      const query = url.searchParams.get('q') || '';
      const words = query.split(/\s+/u).filter((word) => word && !/^[a-z_-]+:/iu.test(word)).map((word) => word.toLowerCase());
      if (path[1] === 'users') {
        const all = [{ ...uiFixtureUser, type: 'User' }, { id: 91020, login: 'contributor-with-a-long-name', avatar_url: avatar, html_url: 'https://github.com/contributor-with-a-long-name', type: 'User' }, ...discoveryUsers];
        const found = all.filter((item) => words.every((word) => item.login.toLowerCase().includes(word)));
        return json({ items: pageItems(found, url, 12), total_count: found.length, incomplete_results: false });
      }
      if (path[1] === 'repositories') {
        const login = query.match(/(?:^|\s)user:([^\s]+)/u)?.[1];
        const found = repos.filter((repo) => !repo.private && (!login || repo.owner.login.toLowerCase() === login.toLowerCase()) && words.every((word) => `${repo.name} ${repo.description}`.toLowerCase().includes(word)));
        return json({ items: pageItems(found, url, 30), total_count: found.length, incomplete_results: false });
      }
      if (path[1] === 'issues') {
        const name = query.match(/(?:^|\s)repo:([^\s]+)/u)?.[1];
        const repo = repos.find((item) => item.full_name.toLowerCase() === name?.toLowerCase());
        const kind = query.match(/(?:^|\s)is:(issue|pr)(?:\s|$)/u)?.[1];
        const state = query.match(/(?:^|\s)is:(open|closed)(?:\s|$)/u)?.[1];
        const title = query.match(/in:title\s+"([^"]*)"/u)?.[1] ?? query.replace(/(?:repo|is|in):[^\s]+/gu, '').replace(/"/gu, '').trim();
        const number = /^#?(\d+)$/u.exec(title.trim());
        const candidates = repo ? [...(questions.get(repo.id) || []), ...pullList(repo).map(discussion)] : [];
        const found = candidates.filter((item) => (!kind || Boolean(item.pull_request) === (kind === 'pr')) && (!state || item.state === state) && (number ? item.number === Number(number[1]) : item.title.toLowerCase().includes(title.toLowerCase())));
        return json({ items: pageItems(found, url, 30), total_count: found.length, incomplete_results: false });
      }
      console.warn(`[EasyHub UI fixture] Unsupported request: ${method} ${url.pathname}`);
      return json({ message: 'UI fixture search endpoint unavailable' }, 404);
    }
    if (path[0] !== 'repos') {
      console.warn(`[EasyHub UI fixture] Unsupported request: ${method} ${url.pathname}`);
      return json({ message: 'UI fixture endpoint unavailable' }, 404);
    }
    const repo = repos.find((item) => item.full_name.toLowerCase() === `${path[1]}/${path[2]}`.toLowerCase())
      ?? (path[1] === 'contributor-with-a-long-name' ? repository(91099, path[2], path[1]) : null)
      ?? (path[1] === uiFixtureUser.login && path[2] === 'history-pagination' ? repository(91101, path[2]) : null);
    if (!repo) return json({ message: 'UI fixture project unavailable' }, 404);
    const list = questions.get(repo.id) ?? clone(issues);
    const endpoint = path[3];
    if (!endpoint && method === 'GET') return json(repo);
    if (!endpoint && method === 'PATCH') { Object.assign(repo, body); return json(repo); }
    if (!endpoint && method === 'DELETE') { repos.splice(repos.indexOf(repo), 1); return json({}, 204); }
    if (endpoint === 'readme' && method === 'GET') return text(readme);
    if (endpoint === 'contents' && method === 'GET') return json({ encoding: 'base64', content: '', size: 0 });
    if (endpoint === 'compare' && method === 'GET') return json({ status: 'ahead', ahead_by: 2, behind_by: 0, total_commits: 2, files: pullFiles });
    if (endpoint === 'branches') {
      if (path[5] === 'protection') return json({ message: 'No protection in fixture' }, 404);
      const name = decodeURIComponent(path.slice(4).join('/'));
      return ['main', 'feature/fix-ui', 'develop'].includes(name)
        ? json({ name, protected: false }) : json({ message: 'UI fixture branch unavailable' }, 404);
    }
    if (endpoint === 'issues') {
      const number = Number(path[4]);
      const foundPull = pullList(repo).find((item) => item.number === number);
      const item = list.find((issue) => issue.number === number) ?? (foundPull ? discussion(foundPull) : null);
      if (path[5] === 'comments' && item) {
        const comments = commentList(repo, number);
        if (method === 'POST') {
          const comment: GitHubComment = { id: nextCommentId++, body: String(body.body || ''), created_at: new Date().toISOString(), user: { login: uiFixtureUser.login } };
          comments.push(comment); item.comments = comments.length;
          return json(comment, 201);
        }
        if (method === 'GET') return json(pageItems(comments, url));
      }
      if (method === 'GET' && !path[4]) return json(pageItems([...list, ...pullList(repo).map(discussion)].filter((issue) => !url.searchParams.get('state') || url.searchParams.get('state') === 'all' || issue.state === url.searchParams.get('state')), url));
      if (method === 'POST' && !path[4]) {
        const nextNumber = Math.max(...list.map((item) => item.number), ...pullList(repo).map((item) => item.number)) + 1;
        const created: GitHubIssue = { id: nextCommentId++, number: nextNumber, title: String(body.title || ''), body: String(body.body || ''), created_at: new Date().toISOString(), state: 'open', user: { login: uiFixtureUser.login }, comments: 0 };
        list.push(created); questions.set(repo.id, list);
        return json(created, 201);
      }
      if (item && method === 'PATCH' && path.length === 5) Object.assign(item, body);
      if (item && (method === 'GET' || method === 'PATCH') && path.length === 5) return json(item);
      return json({ message: 'UI fixture issue unavailable' }, 404);
    }
    if (endpoint === 'pulls') {
      const number = Number(path[4]);
      const item = pullList(repo).find((item) => item.number === number);
      if (path[5] === 'files' && method === 'GET' && item) return json(pageItems(pullFiles, url));
      if (path[5] === 'reviews' && item) {
        const history = reviewList(repo, number);
        if (method === 'POST') {
          const review: GitHubPullReview = { id: nextReviewId++, state: body.event === 'APPROVE' ? 'APPROVED' : body.event === 'REQUEST_CHANGES' ? 'CHANGES_REQUESTED' : 'COMMENTED', body: String(body.body || ''), submitted_at: new Date().toISOString(), user: { login: uiFixtureUser.login } };
          history.push(review);
          return json(review, 201);
        }
        if (method === 'GET') return json(pageItems(history, url));
      }
      if (path[5] === 'merge') return json({ merged: true, sha: headSha, message: 'Merged in UI fixture only' });
      if (!path[4] && method === 'GET') return json(pageItems(pullList(repo).filter((item) => !url.searchParams.get('state') || url.searchParams.get('state') === 'all' || item.state === url.searchParams.get('state')), url));
      return item ? json(item) : json({ message: 'UI fixture pull request unavailable' }, 404);
    }
    if (endpoint === 'commits' && method === 'GET') {
      const sha = path[4];
      if (path[5] === 'check-runs' && (sha === headSha || sha === paginationHeadSha)) {
        const checks = Array.from({ length: sha === paginationHeadSha ? 101 : 3 }, (_, index) => ({ id: 97000 + index, head_sha: sha,
          name: index === 0 ? 'Android arm64 build · 构建通过' : index === 1 ? 'Small-screen layout review · 等待人工检查' : index === 2 ? 'Regression tests · 测试失败' : `Pagination check ${index + 1} / 101`,
          status: index === 1 ? 'in_progress' : 'completed', conclusion: index === 1 ? null : index === 2 ? 'failure' : 'success',
          html_url: `${repo.html_url}/actions/runs/${97000 + index}`, details_url: `${repo.html_url}/actions/runs/${97000 + index}`, started_at: createdAt, completed_at: index === 1 ? null : createdAt,
          app: { id: 15000, name: 'EasyHub fixture CI' }, output: { title: index === 2 ? 'One layout assertion failed' : 'Local UI fixture check', summary: index === 2 ? 'This simulated failure exercises the failed-check row; no real GitHub workflow ran.' : null } }));
        return json({ check_runs: pageItems(checks, url), total_count: checks.length });
      }
      if (path[5] === 'statuses' && (sha === headSha || sha === paginationHeadSha)) {
        const statuses = Array.from({ length: sha === paginationHeadSha ? 101 : 3 }, (_, index) => ({ id: 98000 + index,
          context: index === 0 ? 'legacy/unit-tests' : index === 1 ? 'legacy/manual-device-review' : index === 2 ? 'legacy/security-regression' : `legacy/pagination-${index + 1}`,
          state: index === 1 ? 'pending' : index === 2 ? 'failure' : 'success', description: index === 1 ? 'Waiting for a local device check' : index === 2 ? 'Simulated check failure for UI QA' : 'Checks passed',
          target_url: `${repo.html_url}/actions/runs/${98000 + index}`, created_at: createdAt, updated_at: createdAt }));
        return json(pageItems(statuses, url));
      }
      if (!path[5]) {
        const catalog = repo.name === 'history-pagination' ? Array.from({ length: 101 }, (_, index) => ({ ...commits[0], sha: (index + 1).toString(16).padStart(40, '0'), commit: { ...commits[0].commit, message: `History ${index + 1} / 101 · 分页测试` } })) : commits;
        return json(sha ? catalog.find((commit) => commit.sha === sha) || { ...commits[0], sha } : pageItems(catalog, url));
      }
    }
    if (endpoint === 'releases' && method === 'GET') {
      if (!path[4]) {
        const catalog = repo.name === 'history-pagination' ? Array.from({ length: 31 }, (_, index) => ({ ...releases[1], id: 12000 + index, tag_name: `v0.${index + 1}.0`, name: `Release ${index + 1} / 31 · 分页测试`, prerelease: false })) : releases;
        return json(pageItems(catalog, url));
      }
      if (path[4] === 'assets') {
        const asset = releases.flatMap((release) => release.assets).find((asset) => asset.id === Number(path[5]));
        if (!asset) return json({ message: 'UI fixture asset unavailable' }, 404);
        const accept = new Headers(init.headers).get('Accept') || '';
        if (!accept.includes('application/octet-stream')) return json(asset);
        if (asset.id === 404 || asset.id === 406) return binary(nativeExe, 'application/octet-stream', init.signal);
        if (asset.id === 405) return binary(dalvikApk, asset.content_type, init.signal);
        return json({ message: 'This visual-only fixture asset has no program bytes; use analysis assets 404 or 405' }, 404);
      }
      const release = path[4] === 'latest' ? releases[0] : path[4] === 'tags' ? releases.find((item) => item.tag_name === path[5]) : releases.find((item) => item.id === Number(path[4]));
      return release ? json({ ...release, upload_url: 'https://invalid.local/ui-test', html_url: `${repo.html_url}/releases/tag/${release.tag_name}` }) : json({}, 404);
    }
    if (endpoint === 'git' && path[4] === 'blobs' && method === 'GET') {
      if (path[5] === nativeExe.blobSha) return binary(nativeExe, 'application/octet-stream', init.signal);
      if (pullFiles.some((file) => file.sha === path[5])) return text('// Local UI fixture file\nexport const layoutTest = true;\n');
      return json({ message: 'UI fixture blob unavailable' }, 404);
    }
    console.warn(`[EasyHub UI fixture] Unsupported request: ${method} ${url.pathname}`);
    return json({ message: 'This operation is disabled in the local UI fixture' }, 403);
  };
}

export function createUiTestClient(): GitHubClient {
  return new GitHubClient(async () => 'easyhub-ui-test-in-memory-only', createUiTestTransport());
}

// SessionProvider calls this only inside its development UI-test branch.
// Keep the transfer in memory so UI tests can inspect progress and cancellation.
export async function simulateUiTestDownload(onProgress: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const total = 44_459_622;
  const startedAt = Date.now();
  const duration = 15_000;
  let loaded = 0;
  while (loaded < total) {
    if (signal?.aborted) {
      const cause = new Error('The UI fixture download was cancelled');
      cause.name = 'AbortError';
      throw cause;
    }
    loaded = Math.min(total, Math.round(total * (Date.now() - startedAt) / duration));
    onProgress(loaded, total);
    if (loaded < total) await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}
