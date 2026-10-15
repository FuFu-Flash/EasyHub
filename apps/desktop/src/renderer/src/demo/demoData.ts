import type {
  GitHubComment,
  GitHubCommit,
  GitHubCreatedRelease,
  GitHubIssue,
  GitHubPullFile,
  GitHubPullRequest,
  GitHubRepo,
  GitHubUser,
} from '@easyhub/github';
import type { ChangedFile, LocalProjectLink } from '@easyhub/types';
import { initialIssues, initialProjects } from '../data/mock';
import appIcon from '../assets/easyhub-icon.svg';
import minecraftIcon from '../assets/minecraft-grass-block.png';

export const DEMO_USER: GitHubUser = {
  id: 910000,
  login: 'easyhub-demo',
  name: 'EasyHub Demo',
  avatar_url: appIcon,
  html_url: 'https://github.com/easyhub-demo',
  bio: 'EasyHub demo account',
  followers: 12,
  following: 8,
  public_repos: 3,
};
export const copy = <T>(value: T): T => structuredClone(value);
export const sha = (number: number): string => Math.max(1, number).toString(16).padStart(40, '0');
export interface DemoRepository {
  repo: GitHubRepo;
  readme: string;
  issues: GitHubIssue[];
  comments: Record<number, GitHubComment[]>;
  pulls: GitHubPullRequest[];
  pullFiles: Record<number, GitHubPullFile[]>;
  commits: GitHubCommit[];
  releases: GitHubCreatedRelease[];
  protected: boolean;
}
export interface DemoLocal {
  link: LocalProjectLink;
  files: ChangedFile[];
  revision: number;
  remote: boolean;
  readme: string;
}
export interface DemoState {
  repositories: DemoRepository[];
  locals: DemoLocal[];
  nextId: number;
  starred: Set<number>;
}

export function demoCommit(
  id: number,
  message: string,
  paths: string[],
  date = new Date().toISOString(),
): GitHubCommit {
  return {
    sha: sha(id),
    commit: { message, author: { name: DEMO_USER.name!, date } },
    author: { login: DEMO_USER.login },
    stats: { additions: paths.length * 2, deletions: paths.length },
    files: paths.map((filename) => ({
      filename,
      status: 'modified',
      additions: 2,
      deletions: 1,
      patch: '@@ -1 +1,2 @@\n-old value\n+new value\n+// Demo change',
    })),
  };
}
export function makeRepository(
  id: number,
  owner: string,
  name: string,
  description: string,
  privateRepo = false,
): DemoRepository {
  const own = owner === DEMO_USER.login;
  return {
    repo: {
      id,
      name,
      full_name: `${owner}/${name}`,
      html_url: `https://github.com/${owner}/${encodeURIComponent(name)}`,
      description,
      private: privateRepo,
      default_branch: 'main',
      owner: { login: owner, avatar_url: appIcon },
      updated_at: new Date().toISOString(),
      open_issues_count: 0,
      stargazers_count: own ? 12 : 1200,
      language: 'TypeScript',
      allow_forking: true,
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
      archived: false,
      permissions: { admin: own, push: own, pull: true },
    },
    readme: `# ${name}\n\n${description}`,
    issues: [],
    comments: {},
    pulls: [],
    pullFiles: {},
    commits: [demoCommit(id, 'Create project', ['README.md'])],
    releases: [],
    protected: false,
  };
}
export function createDemoState(): DemoState {
  const locals: DemoLocal[] = [];
  const names = ['MyTool', 'MinecraftMod', 'PersonalSite', 'TravelNotes'];
  const repositories = initialProjects.map((source, index) => {
    const item = makeRepository(
      910001 + index,
      DEMO_USER.login,
      names[index]!,
      source.description,
      source.visibility === 'private',
    );
    item.readme = source.readme;
    item.protected = source.branchProtectionEnabled;
    item.repo.updated_at = source.updatedAt;
    if (source.id === 'minecraft') item.repo.owner.avatar_url = minecraftIcon;
    item.commits = source.history.map((entry, offset) =>
      demoCommit(item.repo.id + offset * 100, entry.message, entry.changedFiles, entry.createdAt),
    );
    item.issues = initialIssues
      .filter((issue) => issue.projectId === source.id)
      .map((issue, offset) => {
        const number = offset + 1;
        item.comments[number] = issue.comments.map((comment, n) => ({
          id: 920000 + n,
          body: comment.body,
          created_at: comment.createdAt,
          user: { login: DEMO_USER.login },
        }));
        return {
          id: 920100 + index * 10 + number,
          number,
          title: issue.title,
          body: issue.body,
          state: issue.state,
          created_at: issue.createdAt,
          user: { login: issue.author },
          comments: issue.comments.length,
        };
      });
    item.repo.open_issues_count = item.issues.filter((issue) => issue.state === 'open').length;
    if (source.downloaded)
      locals.push({
        link: {
          id: `demo-local-${item.repo.id}`,
          repositoryId: item.repo.id,
          owner: DEMO_USER.login,
          name: item.repo.name,
          localPath: source.localPath!,
          lastOpenedAt: source.updatedAt,
        },
        files: copy(source.changedFiles),
        revision: 1,
        remote: source.health === 'remote',
        readme: source.readme,
      });
    return item;
  });
  // Demonstrate the exact sensitive-file selection and confirmation used in real projects.
  locals
    .find((local) => local.link.name === 'MinecraftMod')!
    .files.push({ path: '.env', kind: 'added', sensitiveReasons: ['environment'] });
  const first = repositories[0]!;
  first.releases.push({
    id: 930001,
    tag_name: 'v1.0.0',
    name: 'MyTool 1.0.0',
    body: '## 更新内容\n\n首个演示发行版。',
    draft: false,
    prerelease: false,
    published_at: first.repo.updated_at,
    assets: [
      {
        id: 930002,
        name: 'MyTool.exe',
        label: null,
        size: 2048,
        content_type: 'application/octet-stream',
        download_count: 8,
        state: 'uploaded',
      },
    ],
    upload_url: 'demo://uploads/930001',
    html_url: `${first.repo.html_url}/releases/tag/v1.0.0`,
  });
  const publicRepo = makeRepository(
    910101,
    'sample-author',
    'StarterKit',
    'A small starter project for learning and collaboration.',
  );
  publicRepo.readme +=
    '\n\n## Installation\n\nDownload a release or open the source code.\n\n[Releases](https://github.com/sample-author/StarterKit/releases)';
  publicRepo.issues.push({
    id: 921001,
    number: 1,
    title: 'Add a keyboard shortcut',
    body: 'Could we add a shortcut for the main action?',
    state: 'open',
    created_at: first.repo.updated_at,
    user: { login: 'contributor' },
    comments: 0,
  });
  publicRepo.repo.open_issues_count = 1;
  repositories.push(
    publicRepo,
    makeRepository(910102, 'sample-author', 'CodeGarden', 'Tools and examples for creative coding.'),
  );
  const pull: GitHubPullRequest = {
    id: 940001,
    number: 10,
    title: '修复窗口缩小时的按钮排版',
    body: '让操作按钮在较窄的窗口里自动换行。',
    state: 'open',
    draft: false,
    merged: false,
    merged_at: null,
    created_at: first.repo.updated_at,
    html_url: `${first.repo.html_url}/pull/10`,
    user: { login: 'contributor' },
    comments: 0,
    changed_files: 1,
    additions: 2,
    deletions: 1,
    mergeable: true,
    mergeable_state: 'clean',
    head: {
      ref: 'fix-layout',
      label: 'contributor:fix-layout',
      sha: sha(940001),
      repo: { ...first.repo, owner: { login: 'contributor' }, full_name: 'contributor/MyTool' },
    },
    base: { ref: 'main', sha: first.commits[0]!.sha, repo: first.repo },
  };
  first.pulls.push(pull);
  first.comments[10] = [];
  first.pullFiles[10] = [
    {
      filename: 'src/styles.css',
      status: 'modified',
      additions: 2,
      deletions: 1,
      sha: sha(940002),
      patch: '@@ -1 +1,2 @@\n-.actions { display: flex; }\n+.actions { display: flex;\n+  flex-wrap: wrap; }',
    },
  ];
  return { repositories, locals, nextId: 950000, starred: new Set([publicRepo.repo.id]) };
}
