import { AsyncEntry } from '@napi-rs/keyring';
import { GitHubClient, friendlyGitHubError } from '@easyhub/github';
import type { GitHubUser } from '@easyhub/github';
import { dialog, net, shell } from 'electron';
import { createWriteStream } from 'node:fs';
import { existsSync } from 'node:fs';
import { rm, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

interface Credential { clientId: string; accessToken: string; refreshToken?: string; expiresAt?: number }
interface DeviceCode { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval?: number }
interface TokenReply { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; interval?: number }

const vault = new AsyncEntry('EasyHub GitHub OAuth', 'default');
let credential: Credential | null | undefined;
let pending: { code: string; clientId: string; expiresAt: number; interval: number } | null = null;
let polling = false;
let lastPoll = 0;
let archiveController: AbortController | null = null;
const readControllers = new Set<AbortController>();
const downloadedArchives = new Set<string>();
export interface DownloadTransferProgress { loaded: number; total: number | null; percent: number | null }

function validClientId(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_]{8,100}$/.test(value); }
function validRepoPart(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== '.' && value !== '..'; }
function validText(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function invalid(): never { throw new Error('填写的内容无效，请检查后重试。'); }

async function loadCredential(): Promise<Credential | null> {
  if (credential !== undefined) return credential;
  const raw = await vault.getPassword();
  if (!raw) return credential = null;
  try {
    const stored: unknown = JSON.parse(raw);
    if (typeof stored === 'object' && stored !== null && 'clientId' in stored && 'accessToken' in stored && validClientId(stored.clientId) && typeof stored.accessToken === 'string') {
      return credential = stored as Credential;
    }
  } catch { /* Ignore invalid old credential records. */ }
  return credential = null;
}

async function saveCredential(next: Credential): Promise<void> {
  await vault.setPassword(JSON.stringify(next));
  credential = next;
}

async function exchange(form: Record<string, string>): Promise<TokenReply> {
  const response = await net.fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
  });
  if (!response.ok) throw new Error('GitHub 登录暂时不可用，请稍后重试。');
  return response.json() as Promise<TokenReply>;
}

async function accessToken(): Promise<string> {
  const current = await loadCredential();
  if (!current) throw new Error('请先使用 GitHub 登录。');
  if (current.expiresAt && Date.now() > current.expiresAt - 60_000) {
    if (!current.refreshToken) throw new Error('GitHub 登录已过期，请重新登录。');
    const refreshed = await exchange({ client_id: current.clientId, grant_type: 'refresh_token', refresh_token: current.refreshToken });
    if (!refreshed.access_token) throw new Error('GitHub 登录已过期，请重新登录。');
    await saveCredential({ clientId: current.clientId, accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? current.refreshToken, expiresAt: refreshed.expires_in ? Date.now() + refreshed.expires_in * 1000 : undefined });
    return refreshed.access_token;
  }
  return current.accessToken;
}

export function githubAccessToken(): Promise<string> { return accessToken(); }

const client = new GitHubClient(accessToken, (input, init) => net.fetch(String(input), init));

export async function gitHubIdentity(): Promise<{ token: string; user: GitHubUser }> {
  const token = await accessToken();
  const user = await client.user();
  return { token, user };
}

export function repositoryDetails(owner: string, name: string) { return client.repo(owner, name); }
export function createEmptyRepository(name: string, description: string, isPrivate: boolean) { return client.createRepo(name, description, isPrivate, false); }

export async function authStatus(): Promise<{ user: GitHubUser | null; clientId: string | null }> {
  const current = await loadCredential();
  if (!current) return { user: null, clientId: null };
  try { return { user: await client.user(), clientId: current.clientId }; }
  catch { return { user: null, clientId: current.clientId }; }
}

export async function startDeviceLogin(clientId: unknown): Promise<{ userCode: string; verificationUri: string; expiresAt: number; interval: number }> {
  if (!validClientId(clientId)) invalid();
  const response = await net.fetch('https://github.com/login/device/code', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: 'repo read:user' }),
  });
  if (!response.ok) throw new Error('GitHub 登录暂时不可用，请稍后重试。');
  const result = await response.json() as DeviceCode & { error?: string };
  if (!result.device_code || !result.user_code || result.error) throw new Error('无法开始 GitHub 登录，请检查 Client ID 和 Device Flow 设置。');
  pending = { code: result.device_code, clientId, expiresAt: Date.now() + result.expires_in * 1000, interval: Math.max(result.interval ?? 5, 5) };
  lastPoll = 0;
  return { userCode: result.user_code, verificationUri: result.verification_uri, expiresAt: pending.expiresAt, interval: pending.interval };
}

export async function pollDeviceLogin(): Promise<{ state: 'waiting' | 'complete'; user?: GitHubUser; interval?: number }> {
  const flow = pending;
  if (!flow || flow.expiresAt <= Date.now()) { pending = null; throw new Error('登录确认已过期，请重新开始。'); }
  if (polling || Date.now() - lastPoll < flow.interval * 1000) return { state: 'waiting', interval: flow.interval };
  polling = true;
  lastPoll = Date.now();
  try {
    const result = await exchange({ client_id: flow.clientId, device_code: flow.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    if (result.error === 'authorization_pending') return { state: 'waiting', interval: flow.interval };
    if (result.error === 'slow_down') { flow.interval += 5; return { state: 'waiting', interval: flow.interval }; }
    if (result.error === 'access_denied') throw new Error('你没有允许 EasyHub 登录。');
    if (result.error || !result.access_token) throw new Error('登录确认失败，请重新尝试。');
    if (pending !== flow) return { state: 'waiting', interval: flow.interval };
    await saveCredential({ clientId: flow.clientId, accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined });
    pending = null;
    return { state: 'complete', user: await client.user() };
  } finally { polling = false; }
}

export function cancelDeviceLogin(): void { pending = null; }
export function cancelGithubReads(): void { for (const controller of readControllers) controller.abort(); }
export async function logout(): Promise<void> { pending = null; await vault.deleteCredential(); credential = null; }

export async function githubAction(action: unknown, args: unknown[]): Promise<unknown> {
  if (typeof action !== 'string' || !Array.isArray(args) || args.length > 4) invalid();
  const [owner, repo, third, fourth] = args;
  const controller = ['user', 'profile', 'contributions', 'trending', 'publicRepo', 'repos', 'myFork', 'forkComparison', 'searchPublicRepos', 'searchUsers', 'topStarredRepos', 'readme', 'issues', 'issuesPage', 'comments', 'pullRequests', 'pullRequest', 'pullFiles', 'commits', 'commit', 'releases'].includes(action) ? new AbortController() : null;
  if (controller) readControllers.add(controller);
  try {
    const assertAdmin = async (ownerName: string, repoName: string): Promise<void> => {
      const [remote, identity] = await Promise.all([client.repo(ownerName, repoName), gitHubIdentity()]);
      if (!remote.permissions?.admin && remote.owner.login.toLowerCase() !== identity.user.login.toLowerCase()) {
        throw new Error('你没有这个项目的管理权限。');
      }
    };
    switch (action) {
      case 'user': return await client.user(controller?.signal);
      case 'profile': if (validRepoPart(owner)) return await client.profile(owner, controller?.signal); invalid();
      case 'contributions': if (validRepoPart(owner) && typeof repo === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(repo) && typeof third === 'string' && /^\d{4}-\d{2}-\d{2}T23:59:59\.999Z$/.test(third) && Date.parse(third) >= Date.parse(repo) && Date.parse(third) - Date.parse(repo) <= 370 * 86400000) return await client.contributions(owner, repo, third, controller?.signal); invalid();
      case 'trending': if ((owner === 'today' || owner === 'week' || owner === 'month') && Number.isInteger(repo) && Number(repo) >= 1 && Number(repo) <= 34) return await client.trending(owner, Number(repo), controller?.signal); invalid();
      case 'publicRepo': if (validRepoPart(owner) && validRepoPart(repo)) { const item = await client.repo(owner, repo); if (item.private) throw new Error('这个项目不是公开项目。'); return item; } invalid();
      case 'repository': if (validRepoPart(owner) && validRepoPart(repo)) return await client.repo(owner, repo); invalid();
      case 'repos': return await client.repos(typeof owner === 'number' && owner > 0 && owner <= 100 ? owner : 1, controller?.signal);
      case 'myFork': {
        if (!validRepoPart(owner) || !validRepoPart(repo)) invalid();
        const [upstream, identity] = await Promise.all([client.repo(owner, repo), gitHubIdentity()]);
        for (let page = 1; page <= 10; page++) {
          const batch = await client.repos(page, controller?.signal);
          const candidates = batch.filter((item) => item.fork && item.owner.login.toLowerCase() === identity.user.login.toLowerCase());
          for (const candidate of candidates) {
            const detail = await client.repo(candidate.owner.login, candidate.name);
            if (detail.parent?.id === upstream.id) return detail;
          }
          if (batch.length < 100) break;
        }
        return null;
      }
      case 'forkRepo': {
        if (!validRepoPart(owner) || !validRepoPart(repo) || !validRepoPart(third)) invalid();
        const [upstream, identity] = await Promise.all([client.repo(owner, repo), gitHubIdentity()]);
        if (upstream.private || upstream.archived || upstream.allow_forking === false || upstream.permissions?.pull === false) throw new Error('这个项目当前不允许创建仓库副本。');
        if (upstream.owner.login.toLowerCase() === identity.user.login.toLowerCase()) throw new Error('这是你自己的项目，无需创建仓库副本。');
        const created = await client.createFork(owner, repo, third);
        if (created.owner.login.toLowerCase() !== identity.user.login.toLowerCase()) throw new Error('仓库副本尚未准备好，请稍后在我的项目中查看。');
        for (let attempt = 0; attempt < 12; attempt++) {
          try {
            const ready = await client.repo(created.owner.login, created.name);
            if (ready.fork && ready.parent?.id === upstream.id) return ready;
          } catch { /* GitHub creates the fork asynchronously. */ }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error('仓库副本尚未准备好，请稍后在我的项目中查看。');
      }
      case 'forkComparison': {
        if (!validRepoPart(owner) || !validRepoPart(repo)) invalid();
        const [fork, identity] = await Promise.all([client.repo(owner, repo), gitHubIdentity()]);
        if (fork.owner.login.toLowerCase() !== identity.user.login.toLowerCase() || !fork.fork || !fork.parent) throw new Error('找不到属于你的仓库副本。');
        const [comparison, open] = await Promise.all([
          client.compare(fork.parent.owner.login, fork.parent.name, fork.parent.default_branch, fork.owner.login, fork.default_branch),
          client.openPullRequestForHead(fork.parent.owner.login, fork.parent.name, fork.owner.login, fork.default_branch, fork.parent.default_branch),
        ]);
        return { ...comparison, openRequest: open[0] ?? null };
      }
      case 'submitForkContribution': {
        if (!validRepoPart(owner) || !validRepoPart(repo) || !validText(third, 256) || typeof fourth !== 'string' || fourth.length > 65536) invalid();
        const [fork, identity] = await Promise.all([client.repo(owner, repo), gitHubIdentity()]);
        if (fork.owner.login.toLowerCase() !== identity.user.login.toLowerCase() || !fork.fork || !fork.parent) throw new Error('找不到属于你的仓库副本。');
        const upstream = await client.repo(fork.parent.owner.login, fork.parent.name);
        if (upstream.id !== fork.parent.id || upstream.archived) throw new Error('原项目暂时无法接收改进请求。');
        const comparison = await client.compare(upstream.owner.login, upstream.name, upstream.default_branch, fork.owner.login, fork.default_branch);
        if (comparison.ahead_by < 1) throw new Error('仓库副本还没有可提交的修改，请先发布源码。');
        const open = await client.openPullRequestForHead(upstream.owner.login, upstream.name, fork.owner.login, fork.default_branch, upstream.default_branch);
        if (open[0]) return open[0];
        return await client.createPullRequest(upstream.owner.login, upstream.name, {
          title: third.trim(), body: fourth, head: `${fork.owner.login}:${fork.default_branch}`, base: upstream.default_branch,
        });
      }
      case 'searchPublicRepos': if (typeof owner === 'string' && owner.trim().length >= 2 && owner.trim().length <= 200) return await client.searchPublicRepos(owner, controller?.signal); invalid();
      case 'searchUsers': if (typeof owner === 'string' && owner.trim().length >= 2 && owner.trim().length <= 200) return await client.searchUsers(owner, controller?.signal); invalid();
      case 'topStarredRepos': if (validRepoPart(owner)) return await client.topStarredRepos(owner, controller?.signal); invalid();
      case 'createRepo': if (validRepoPart(owner) && typeof repo === 'string' && repo.length <= 350 && typeof third === 'boolean') return await client.createRepo(owner, repo, third); invalid();
      case 'updateVisibility': if (validRepoPart(owner) && validRepoPart(repo) && typeof third === 'boolean') { await assertAdmin(owner, repo); return await client.updateVisibility(owner, repo, third); } invalid();
      case 'setArchived': if (validRepoPart(owner) && validRepoPart(repo) && typeof third === 'boolean') { await assertAdmin(owner, repo); return await client.setArchived(owner, repo, third); } invalid();
      case 'transferRepo': if (validRepoPart(owner) && validRepoPart(repo) && validRepoPart(third)) { await assertAdmin(owner, repo); return await client.transferRepo(owner, repo, third); } invalid();
      case 'readme': if (validRepoPart(owner) && validRepoPart(repo)) return await client.readme(owner, repo, controller?.signal); break;
      case 'issues': if (validRepoPart(owner) && validRepoPart(repo) && (third === 'open' || third === 'closed' || third === 'all')) return await client.issues(owner, repo, third, controller?.signal); break;
      case 'issuesPage': if (validRepoPart(owner) && validRepoPart(repo) && (third === 'open' || third === 'closed' || third === 'all') && Number.isInteger(fourth) && Number(fourth) >= 1 && Number(fourth) <= 10000) return await client.issuePage(owner, repo, third, Number(fourth), controller?.signal); break;
      case 'createIssue': if (validRepoPart(owner) && validRepoPart(repo) && validText(third, 256) && typeof fourth === 'string' && fourth.length <= 65536) return await client.createIssue(owner, repo, third, fourth); invalid();
      case 'updateIssue': if (validRepoPart(owner) && validRepoPart(repo) && Number.isSafeInteger(third) && Number(third) > 0 && (fourth === 'open' || fourth === 'closed')) return await client.updateIssue(owner, repo, Number(third), fourth); break;
      case 'comments': if (validRepoPart(owner) && validRepoPart(repo) && Number.isSafeInteger(third) && Number(third) > 0) return await client.comments(owner, repo, Number(third), controller?.signal); break;
      case 'createComment': if (validRepoPart(owner) && validRepoPart(repo) && Number.isSafeInteger(third) && Number(third) > 0 && validText(fourth, 65536)) return await client.createComment(owner, repo, Number(third), fourth); break;
      case 'pullRequests': if (validRepoPart(owner) && validRepoPart(repo) && Number.isInteger(third) && Number(third) >= 1 && Number(third) <= 10000) return await client.pullRequests(owner, repo, Number(third), controller?.signal); break;
      case 'pullRequest': if (validRepoPart(owner) && validRepoPart(repo) && Number.isSafeInteger(third) && Number(third) > 0) return await client.pullRequest(owner, repo, Number(third), controller?.signal); break;
      case 'pullFiles': if (validRepoPart(owner) && validRepoPart(repo) && Number.isSafeInteger(third) && Number(third) > 0) return await client.pullFiles(owner, repo, Number(third), controller?.signal); break;
      case 'createPullRequest': {
        if (!validRepoPart(owner) || !validRepoPart(repo) || typeof third !== 'object' || third === null) invalid();
        const input = third as Record<string, unknown>;
        if (!validText(input.title, 256) || typeof input.body !== 'string' || input.body.length > 65536 || typeof input.head !== 'string' || typeof input.base !== 'string') invalid();
        const [sourceOwner, sourceBranch, extra] = input.head.split(':');
        if (extra !== undefined || !validRepoPart(sourceOwner) || !sourceBranch || !/^[A-Za-z0-9_./-]{1,200}$/.test(sourceBranch) || sourceBranch.includes('..') || sourceBranch.includes('//') || !/^[A-Za-z0-9_./-]{1,200}$/.test(input.base) || input.base.includes('..') || input.base.includes('//')) invalid();
        return await client.createPullRequest(owner, repo, { title: input.title.trim(), body: input.body, head: input.head, base: input.base });
      }
      case 'commits': if (validRepoPart(owner) && validRepoPart(repo)) return await client.commits(owner, repo, controller?.signal); break;
      case 'commit': if (validRepoPart(owner) && validRepoPart(repo) && typeof third === 'string' && /^[a-f0-9]{40}$/.test(third)) return await client.commit(owner, repo, third, controller?.signal); break;
      case 'releases': if (validRepoPart(owner) && validRepoPart(repo)) return await client.releases(owner, repo, controller?.signal); break;
    }
    invalid();
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith('填写') || error.message.startsWith('请先') || error.message.startsWith('GitHub 登录') || error.message.startsWith('你没有') || error.message.startsWith('这个项目') || error.message.startsWith('这是你') || error.message.startsWith('仓库副本') || error.message.startsWith('找不到属于') || error.message.startsWith('原项目'))) throw error;
    throw new Error(friendlyGitHubError(error));
  } finally { if (controller) readControllers.delete(controller); }
}

export function cancelArchive(): void { archiveController?.abort(); }

export function revealDownloadedArchive(path: unknown): void {
  if (typeof path !== 'string' || !downloadedArchives.has(path) || !existsSync(path)) throw new Error('找不到已下载的项目文件。');
  shell.showItemInFolder(path);
}

export async function openDownloadedFile(path: unknown): Promise<void> {
  if (typeof path !== 'string' || !downloadedArchives.has(path) || !existsSync(path)) throw new Error('找不到已下载的文件。');
  const error = await shell.openPath(path);
  if (error) throw new Error('无法打开这个文件。');
}

export async function downloadArchive(owner: unknown, repo: unknown, ref: unknown, progress: (value: DownloadTransferProgress) => void): Promise<string | null> {
  if (!validRepoPart(owner) || !validRepoPart(repo) || typeof ref !== 'string' || !/^[a-f0-9]{40}$|^[A-Za-z0-9_.\/-]{1,200}$/.test(ref)) invalid();
  if (archiveController) throw new Error('已有一个下载正在进行，请稍候。');
  const target = await dialog.showSaveDialog({ title: '保存历史版本', defaultPath: `${repo}-${ref.slice(0, 30).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}.zip`, filters: [{ name: 'ZIP 文件', extensions: ['zip'] }] });
  if (target.canceled || !target.filePath) return null;
  if (existsSync(target.filePath)) {
    const confirmation = await dialog.showMessageBox({ type: 'warning', buttons: ['取消', '覆盖'], defaultId: 0, cancelId: 0, message: '此位置已有同名文件。确定要覆盖吗？' });
    if (confirmation.response !== 1) return null;
  }
  const controller = new AbortController();
  archiveController = controller;
  const tempPath = `${target.filePath}.easyhub-${randomUUID()}.tmp`;
  try {
    const response = await client.archive(owner, repo, ref, controller.signal);
    if (!response.body) throw new Error('empty archive');
    const total = Number(response.headers.get('content-length')) || 0;
    let received = 0;
    let lastProgressAt = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (Date.now() - lastProgressAt > 100) { progress({ loaded: received, total: total || null, percent: total ? Math.min(99, Math.round(received / total * 100)) : null }); lastProgressAt = Date.now(); }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream, { signal: controller.signal }), meter, createWriteStream(tempPath, { flags: 'wx' }));
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await rename(tempPath, target.filePath);
    progress({ loaded: received, total: total || received, percent: 100 });
    downloadedArchives.add(target.filePath);
    return target.filePath;
  } catch (error) { await rm(tempPath, { force: true }).catch(() => undefined); throw new Error(controller.signal.aborted ? '操作已取消。' : friendlyGitHubError(error)); }
  finally { archiveController = null; }
}

export async function downloadReleaseAsset(owner: unknown, repo: unknown, assetId: unknown, progress: (value: DownloadTransferProgress) => void): Promise<string | null> {
  if (!validRepoPart(owner) || !validRepoPart(repo) || !Number.isSafeInteger(assetId) || Number(assetId) <= 0) invalid();
  if (archiveController) throw new Error('已有一个下载正在进行，请稍候。');
  const asset = await client.releaseAsset(owner, repo, Number(assetId));
  if (asset.state !== 'uploaded') throw new Error('这个下载文件还没有准备好。');
  const name = asset.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\.+$/, '').slice(0, 180);
  if (!name || name === '.' || name === '..') throw new Error('下载文件名称无效。');
  const target = await dialog.showSaveDialog({ title: '保存版本文件', defaultPath: name });
  if (target.canceled || !target.filePath) return null;
  if (existsSync(target.filePath)) {
    const confirmation = await dialog.showMessageBox({ type: 'warning', buttons: ['取消', '覆盖'], defaultId: 0, cancelId: 0, message: '此位置已有同名文件。确定要覆盖吗？' });
    if (confirmation.response !== 1) return null;
  }
  const controller = new AbortController();
  archiveController = controller;
  const tempPath = `${target.filePath}.easyhub-${randomUUID()}.tmp`;
  try {
    const response = await client.downloadReleaseAsset(owner, repo, Number(assetId), controller.signal);
    if (!response.body) throw new Error('empty release file');
    const total = Number(response.headers.get('content-length')) || asset.size || 0;
    let received = 0;
    let lastProgressAt = 0;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (Date.now() - lastProgressAt > 100) { progress({ loaded: received, total: total || null, percent: total ? Math.min(99, Math.round(received / total * 100)) : null }); lastProgressAt = Date.now(); }
      callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream, { signal: controller.signal }), meter, createWriteStream(tempPath, { flags: 'wx' }));
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await rename(tempPath, target.filePath);
    progress({ loaded: received, total: total || received, percent: 100 });
    downloadedArchives.add(target.filePath);
    return target.filePath;
  } catch (error) { await rm(tempPath, { force: true }).catch(() => undefined); throw new Error(controller.signal.aborted ? '操作已取消。' : friendlyGitHubError(error)); }
  finally { archiveController = null; }
}
