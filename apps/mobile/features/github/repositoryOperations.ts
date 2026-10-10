import type { GitHubClient, GitHubForkComparison, GitHubPullRequest, GitHubRepo } from '@easyhub/github';

export type RepositorySettingAction = 'visibility' | 'protection' | 'transfer' | 'archive' | 'delete';
export interface ProtectionState { branch: string; enabled: boolean; externalRules: boolean; reviewsRequired: number | null }
export interface ForkContributionBranches { headBranch: string; baseBranch: string }

const messages = {
  changed: ['项目信息或权限已变化，请刷新后重试。', 'Project details or permissions changed. Refresh and try again.'],
  permission: ['你没有这个项目的管理权限。', 'You do not have permission to manage this project.'],
  readonly: ['公开浏览模式下不能修改原项目。', 'The original project cannot be changed in public browsing mode.'],
  archived: ['这个项目已存档，请先取消存档。', 'Unarchive this project before making changes.'],
  fork: ['这个项目当前不允许创建仓库副本。', 'This project cannot be forked right now.'],
  name: ['请输入有效的副本名称。', 'Enter a valid fork name.'],
  owner: ['请输入其他用户或组织的有效名称。', 'Enter a valid different user or organization.'],
  contribution: ['找不到属于你的可写仓库副本。', 'Could not find a writable fork owned by you.'],
  upstream: ['原项目暂时无法接收改进请求。', 'The original project cannot accept contributions right now.'],
  empty: ['仓库副本还没有可提交的修改，请先在 GitHub 更新副本。', 'Update your fork on GitHub before submitting a contribution.'],
  protection: ['默认分支受其他规则保护，不能在这里覆盖这些规则。', 'Other rules protect this branch and cannot be overwritten here.'],
  confirmation: ['请输入完整的项目名称以确认。', 'Enter the complete project name to confirm.'],
  title: ['请填写改进标题，最多 256 个字符。', 'Enter a contribution title of up to 256 characters.'],
  branch: ['请输入有效的来源分支和目标分支名称。', 'Enter valid source and target branch names.'],
  branchMissing: ['分支不存在或已改名，请检查名称后重新对比。', 'A branch is missing or was renamed. Check its name and compare again.'],
  account: ['授权账号与当前登录账号不同，请使用同一 GitHub 账号。', 'Authorize with the same GitHub account you are signed in with.'],
  deletionExpired: ['删除授权已过期，请重新授权并再次确认。', 'Deletion authorization expired. Authorize and confirm again.'],
} as const;
type ErrorCode = keyof typeof messages;
class RepositoryOperationError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode) { super(messages[code][0]); this.code = code; }
}
const fail = (code: ErrorCode): never => { throw new RepositoryOperationError(code); };
export function repositoryErrorMessage(error: unknown, t: (zh: string, en: string) => string): string {
  if (error instanceof RepositoryOperationError) return t(messages[error.code][0], messages[error.code][1]);
  if (isStatus(error, 401)) return t('GitHub 登录已失效，请重新登录。', 'Your GitHub session expired. Sign in again.');
  if (isStatus(error, 403)) return t('GitHub 拒绝了操作，请检查权限或稍后重试。', 'GitHub declined the action. Check permissions or try again later.');
  if (isStatus(error, 404)) return t('找不到这个项目，或你没有访问权限。', 'This project was not found, or you do not have access.');
  if (isStatus(error, 422)) return t('GitHub 未接受这些内容，请检查名称和填写的信息。', 'GitHub did not accept these details. Check the name and form fields.');
  return t('操作暂时无法完成，请检查网络后重试。', 'The action could not be completed. Check your connection and try again.');
}
function isStatus(error: unknown, status: number): boolean { return typeof error === 'object' && error !== null && 'status' in error && error.status === status; }
export function isValidRepositoryName(name: string): boolean { return /^[A-Za-z0-9_.-]{1,100}$/.test(name) && name !== '.' && name !== '..'; }
/** Git branch names, rather than arbitrary revision expressions or owner:ref values. */
export function isValidContributionBranch(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '@' && !name.startsWith('-')
    && !/[\u0000-\u0020\u007f~^:?*\[\\]/u.test(name) && !name.includes('..') && !name.includes('@{')
    && !name.endsWith('.') && name.split('/').every((part) => !!part && !part.startsWith('.') && !part.endsWith('.lock'));
}
export function canManageRepository(repo: GitHubRepo, login: string | undefined, publicMode = false): boolean {
  return !publicMode && !!login && (repo.permissions ? repo.permissions.admin : repo.owner.login.toLowerCase() === login.toLowerCase());
}
export function canForkRepository(repo: GitHubRepo, login: string | undefined): boolean {
  return !!login && !repo.private && !repo.archived && repo.allow_forking !== false && repo.permissions?.pull !== false && repo.owner.login.toLowerCase() !== login.toLowerCase();
}
export function canContributeFork(repo: GitHubRepo, login: string | undefined, publicMode = false): boolean {
  return !publicMode && !!login && !!repo.fork && !!repo.parent && !repo.archived && repo.permissions?.push !== false && repo.owner.login.toLowerCase() === login.toLowerCase();
}
function assertSameRepository(current: GitHubRepo, expected: GitHubRepo): void {
  if (current.id !== expected.id || current.full_name !== expected.full_name) fail('changed');
}
function abortIfNeeded(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('Aborted'); }
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    abortIfNeeded(signal);
    const cancel = () => { clearTimeout(timer); reject(new Error('Aborted')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

export async function findExistingFork(client: GitHubClient, source: GitHubRepo, login: string, signal?: AbortSignal): Promise<GitHubRepo | null> {
  for (let page = 1; page <= 10; page++) {
    abortIfNeeded(signal);
    const batch = await client.repos(page, signal);
    abortIfNeeded(signal);
    for (const candidate of batch.filter((item) => item.fork && item.owner.login.toLowerCase() === login.toLowerCase())) {
      const detail = await client.repo(candidate.owner.login, candidate.name, signal);
      abortIfNeeded(signal);
      if (detail.parent?.id === source.id) return detail;
    }
    if (batch.length < 100) break;
  }
  return null;
}

/** GitHub returns 202 before the fork relationship becomes available. */
export async function waitForForkReady(client: GitHubClient, created: GitHubRepo, source: GitHubRepo, login: string, signal?: AbortSignal, attempts = 12, delayMs = 1000): Promise<GitHubRepo | null> {
  if (created.owner.login.toLowerCase() !== login.toLowerCase()) fail('changed');
  for (let attempt = 0; attempt < attempts; attempt++) {
    abortIfNeeded(signal);
    try {
      const detail = await client.repo(created.owner.login, created.name, signal);
      if (detail.id !== created.id || detail.owner.login.toLowerCase() !== login.toLowerCase()) fail('changed');
      if (detail.fork && detail.parent?.id === source.id) return detail;
    } catch (error) { if (!isStatus(error, 404)) throw error; }
    if (attempt + 1 < attempts) await pause(delayMs, signal);
  }
  return null;
}

export async function createRepositoryFork(client: GitHubClient, source: GitHubRepo, name: string, signal?: AbortSignal): Promise<{ fork: GitHubRepo; ready: boolean }> {
  if (!isValidRepositoryName(name)) fail('name');
  const [current, user] = await Promise.all([client.repo(source.owner.login, source.name, signal), client.user(signal)]);
  assertSameRepository(current, source);
  if (!canForkRepository(current, user.login)) fail('fork');
  const existing = await findExistingFork(client, current, user.login, signal);
  if (existing) return { fork: existing, ready: true };
  abortIfNeeded(signal);
  const created = await client.createFork(current.owner.login, current.name, name);
  const fork = await waitForForkReady(client, created, current, user.login, signal);
  return { fork: fork ?? created, ready: !!fork };
}

export async function loadForkComparison(client: GitHubClient, expected: GitHubRepo, publicMode = false, selected?: ForkContributionBranches, signal?: AbortSignal): Promise<{ fork: GitHubRepo; comparison: GitHubForkComparison; branches: ForkContributionBranches }> {
  const requested = selected ? { ...selected } : undefined;
  if (requested && (!isValidContributionBranch(requested.headBranch) || !isValidContributionBranch(requested.baseBranch))) fail('branch');
  abortIfNeeded(signal);
  const [fork, user] = await Promise.all([client.repo(expected.owner.login, expected.name, signal), client.user(signal)]);
  abortIfNeeded(signal);
  assertSameRepository(fork, expected);
  if (!canContributeFork(fork, user.login, publicMode)) fail('contribution');
  const parent = fork.parent!;
  if (expected.parent?.id !== parent.id) fail('changed');
  const upstream = await client.repo(parent.owner.login, parent.name, signal);
  abortIfNeeded(signal);
  if (upstream.id !== parent.id) fail('changed');
  const branches = requested ?? { headBranch: fork.default_branch, baseBranch: upstream.default_branch };
  if (!isValidContributionBranch(branches.headBranch) || !isValidContributionBranch(branches.baseBranch)) fail('branch');
  try {
    const [head, base] = await Promise.all([
      signal ? client.branch(fork.owner.login, fork.name, branches.headBranch, signal) : client.branch(fork.owner.login, fork.name, branches.headBranch),
      signal ? client.branch(upstream.owner.login, upstream.name, branches.baseBranch, signal) : client.branch(upstream.owner.login, upstream.name, branches.baseBranch),
    ]);
    abortIfNeeded(signal);
    if (head.name !== branches.headBranch || base.name !== branches.baseBranch) fail('branchMissing');
  } catch (cause) { if (isStatus(cause, 404)) fail('branchMissing'); throw cause; }
  const [comparison, requests] = await Promise.all([
    signal ? client.compare(upstream.owner.login, upstream.name, branches.baseBranch, fork.owner.login, branches.headBranch, signal) : client.compare(upstream.owner.login, upstream.name, branches.baseBranch, fork.owner.login, branches.headBranch),
    signal ? client.openPullRequestForHead(upstream.owner.login, upstream.name, fork.owner.login, branches.headBranch, branches.baseBranch, signal) : client.openPullRequestForHead(upstream.owner.login, upstream.name, fork.owner.login, branches.headBranch, branches.baseBranch),
  ]);
  abortIfNeeded(signal);
  return { fork: { ...fork, parent: { ...parent, default_branch: upstream.default_branch } }, comparison: { ...comparison, openRequest: requests[0] ?? null }, branches };
}

export async function submitForkContribution(client: GitHubClient, expected: GitHubRepo, title: string, body: string, publicMode = false, branches?: ForkContributionBranches): Promise<GitHubPullRequest> {
  if (!title.trim() || title.trim().length > 256 || body.length > 65536) fail('title');
  const { fork, comparison, branches: selected } = await loadForkComparison(client, expected, publicMode, branches);
  const parent = fork.parent!;
  const upstream = await client.repo(parent.owner.login, parent.name);
  if (upstream.id !== parent.id || upstream.archived || (!branches && upstream.default_branch !== parent.default_branch)) fail('upstream');
  if (comparison.ahead_by < 1) fail('empty');
  if (comparison.openRequest) return comparison.openRequest;
  return client.createPullRequest(upstream.owner.login, upstream.name, { title: title.trim(), body: body.trim(), head: `${fork.owner.login}:${selected.headBranch}`, base: selected.baseBranch });
}

export async function loadProtectionState(client: GitHubClient, repo: GitHubRepo, signal?: AbortSignal): Promise<ProtectionState> {
  abortIfNeeded(signal);
  const branch = signal ? await client.branch(repo.owner.login, repo.name, repo.default_branch, signal) : await client.branch(repo.owner.login, repo.name, repo.default_branch);
  abortIfNeeded(signal);
  try {
    const protection = signal ? await client.branchProtection(repo.owner.login, repo.name, repo.default_branch, signal) : await client.branchProtection(repo.owner.login, repo.name, repo.default_branch);
    abortIfNeeded(signal);
    return { branch: repo.default_branch, enabled: true, externalRules: false, reviewsRequired: protection.required_pull_request_reviews?.required_approving_review_count ?? null };
  } catch (error) {
    abortIfNeeded(signal);
    if (!isStatus(error, 404)) throw error;
    return { branch: repo.default_branch, enabled: false, externalRules: branch.protected, reviewsRequired: null };
  }
}
export function settingConfirmation(repo: GitHubRepo, action: RepositorySettingAction): string { return action === 'visibility' || action === 'archive' ? repo.name : repo.full_name; }
export function assertDeletionAccount(expectedLogin: string, actualLogin: string): void { if (expectedLogin.toLowerCase() !== actualLogin.toLowerCase()) fail('account'); }
export function requireDeletionAuthorization(valid: boolean): void { if (!valid) fail('deletionExpired'); }

export async function applyRepositorySetting(client: GitHubClient, expected: GitHubRepo, input: { action: RepositorySettingAction; confirmation: string; publicMode?: boolean; targetOwner?: string; protection?: ProtectionState | null }): Promise<GitHubRepo | ProtectionState | null> {
  if (input.publicMode) fail('readonly');
  if (input.confirmation !== settingConfirmation(expected, input.action)) fail('confirmation');
  const [current, user] = await Promise.all([client.repo(expected.owner.login, expected.name), client.user()]);
  assertSameRepository(current, expected);
  if (!canManageRepository(current, user.login)) fail('permission');
  if (input.action !== 'archive' && input.action !== 'delete' && current.archived) fail('archived');
  if (input.action === 'visibility') {
    if (current.private !== expected.private) fail('changed');
    return client.updateVisibility(current.owner.login, current.name, !current.private);
  }
  if (input.action === 'archive') {
    if (!!current.archived !== !!expected.archived) fail('changed');
    return client.setArchived(current.owner.login, current.name, !current.archived);
  }
  if (input.action === 'transfer') {
    const owner = input.targetOwner?.trim() ?? '';
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) || owner.toLowerCase() === current.owner.login.toLowerCase()) fail('owner');
    return client.transferRepo(current.owner.login, current.name, owner);
  }
  if (input.action === 'protection') {
    const previous = input.protection;
    if (!previous) return fail('changed');
    if (current.default_branch !== previous.branch) fail('changed');
    const protection = await loadProtectionState(client, current);
    if (protection.externalRules) fail('protection');
    if (protection.enabled !== previous.enabled) fail('changed');
    if (protection.enabled) await client.deleteBranchProtection(current.owner.login, current.name, protection.branch);
    else await client.createBasicBranchProtection(current.owner.login, current.name, protection.branch);
    return loadProtectionState(client, current);
  }
  await client.deleteRepository(current.owner.login, current.name);
  return null;
}
