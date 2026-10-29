import * as git from 'isomorphic-git';
import nodeHttp from 'isomorphic-git/http/node';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { GitHubOriginAgent } from '../services/githubProxyOrigin';
import type { OriginRule } from '../services/githubProxyOrigin';
import fs from 'node:fs';
import { chmod, lstat, mkdir, open as openFile, readFile, realpath, stat, writeFile, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { OperationStep, ChangedFile, LocalPublishSelection, LocalPublishPreview, LocalFileDiff, LocalPushBranchResult, LocalBranchList, SyncDecision, SyncFileReview, SyncPreview } from '@easyhub/types';
import { clearPendingPublication, commitSelectedChanges, fileDifference, pendingPublication, safeChangePath, snapshotChanges, markSensitiveFiles } from './LocalChanges';

export interface GitProgress { step?: OperationStep; phase: string; loaded?: number; total?: number; cancelable?: boolean }
export interface GitProjectInfo { root: string; isGit: boolean; owner?: string; repo?: string; branch?: string }
export interface GitProjectStatus { files: ChangedFile[]; head: string | null; hasPreparedChanges: boolean; pendingPublish?: boolean; pendingMessage?: string; branch?: string; pushable?: boolean }
export interface GitRepository { owner: string; name: string; defaultBranch: string }
export interface GitAuthor { name: string; email: string }

export class GitEngineError extends Error {
  constructor(public readonly code: 'remoteChanged' | 'unsupported' | 'empty' | 'invalid' | 'sensitive', message: string) { super(message); }
}

const omittedDirs = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.next', '.turbo', 'dist', 'build']);
function isOmitted(path: string): boolean { return path.split('/').some((part) => omittedDirs.has(part)); }
function repositoryUrl(repo: GitRepository): string { return `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}.git`; }
function auth(token: string): { username: string; password: string } { return { username: token, password: 'x-oauth-basic' }; }

export function parseGithubOrigin(origin: string): { owner: string; repo: string } | null {
  const match = origin.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

async function currentHead(dir: string): Promise<string | null> {
  try { return await git.resolveRef({ fs, dir, ref: 'HEAD' }); }
  catch { return null; }
}

/** Every local branch plus the branches on GitHub (when `onGithub` is unknown, the ones this folder has seen).
 *  Local branches GitHub does not have are reported in `localOnly`, so a new branch never disappears from the list. */
export async function branchList(dir: string, onGithub: string[] | null): Promise<LocalBranchList> {
  const current = (await git.currentBranch({ fs, dir })) ?? null;
  const usable = (branch: string) => branch !== 'HEAD' && safeChangePath(branch);
  const remote = new Set((onGithub ?? await git.listBranches({ fs, dir, remote: 'origin' })).filter(usable));
  const local = (await git.listBranches({ fs, dir })).filter(usable);
  return {
    current,
    branches: [...new Set([...local, ...remote])].sort(),
    localOnly: local.filter((branch) => !remote.has(branch)).sort(),
  };
}

/** Every publish, push and download of new content goes to the branch the folder is on. */
/** Only index version 2 can be read. Folders that check out part of a project (skip-worktree) use version 3. */
async function assertReadableIndex(dir: string): Promise<void> {
  let header: Buffer;
  try {
    const handle = await openFile(join(dir, '.git', 'index'), 'r');
    try { header = Buffer.alloc(8); await handle.read(header, 0, 8, 0); } finally { await handle.close(); }
  } catch { return; }
  if (header.subarray(0, 4).toString('latin1') === 'DIRC' && header.readUInt32BE(4) > 2)
    throw new GitEngineError('unsupported', '这个文件夹只检出了项目的一部分文件，EasyHub 暂时读不了它的状态。请改用完整下载的文件夹。');
}

async function targetBranch(dir: string): Promise<string> {
  const branch = await git.currentBranch({ fs, dir });
  if (!branch || !safeChangePath(branch)) throw new GitEngineError('unsupported', '暂时无法确认项目的当前工作版本，请先在其他工具中切换到一个分支。');
  return branch;
}

/** One saved version per batch, in order; a publish without batches is a single batch. */
function publishBatches(selection: LocalPublishSelection, fallback: string): Array<{ paths: string[]; message: string }> {
  const given = selection.batches;
  if (!given?.length) return [{ paths: selection.paths, message: fallback }];
  const flat = given.flatMap((batch) => batch.paths);
  if (given.some((batch) => !batch.paths.length) || flat.length !== selection.paths.length || flat.some((path, index) => path !== selection.paths[index]) || new Set(flat).size !== flat.length)
    throw new GitEngineError('invalid', '分批发布的文件选择无效，请重新选择。');
  return given.map((batch) => {
    const message = (batch.message ?? '').trim() || fallback;
    if (message.length > 200) throw new GitEngineError('invalid', '请用一句话说明这次修改。');
    return { paths: batch.paths, message };
  });
}

async function incompleteSyncPath(dir: string): Promise<string> {
  const dotgit = join(dir, '.git');
  const details = await lstat(dotgit);
  if (details.isDirectory()) return join(dotgit, 'easyhub-sync-incomplete');
  if (details.isFile()) {
    const pointer = (await readFile(dotgit, 'utf8')).match(/^gitdir:\s*(.+)\s*$/m)?.[1];
    if (pointer) return join(resolve(dir, pointer.trim()), 'easyhub-sync-incomplete');
  }
  throw new GitEngineError('unsupported', '这个项目的本地保存方式暂时无法安全同步。');
}
async function ensureSyncComplete(dir: string): Promise<void> {
  try { await lstat(join(dir, '.git', 'easyhub-publish-incomplete')); throw new GitEngineError('unsupported', '上次本地版本保存没有完成。为保护文件，请先备份项目并检查后再发布。'); }
  catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error; }
  try { await lstat(await incompleteSyncPath(dir)); }
  catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return; throw error; }
  throw new GitEngineError('unsupported', '上次获取最新内容没有完成。为保护本地文件，EasyHub 已暂停这个项目的发布。请先备份文件夹并检查内容。');
}

function touches(a: string, b: string): boolean { return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
function safePath(path: string): boolean { return path !== '.' && !path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git'); }

async function changedBetween(dir: string, before: string, after: string): Promise<Array<{ path: string; added: boolean; removed: boolean; unsafe: boolean; oid?: string; mode?: number }>> {
  return git.walk({ fs, dir, trees: [git.TREE({ ref: before }), git.TREE({ ref: after })],
    map: async (path, [oldEntry, newEntry]) => {
      const oldType = await oldEntry?.type(); const newType = await newEntry?.type();
      if (oldType === 'tree' && newType === 'tree') return undefined;
      if (!oldEntry && !newEntry) return undefined;
      if (oldType === newType && await oldEntry?.oid() === await newEntry?.oid() && await oldEntry?.mode() === await newEntry?.mode()) return undefined;
      const oldMode = await oldEntry?.mode(); const newMode = await newEntry?.mode();
      return { path, added: !oldType, removed: !newType, oid: await newEntry?.oid(), mode: newMode,
        unsafe: !safePath(path) || oldType === 'tree' || newType === 'tree' || oldType === 'commit' || newType === 'commit' ||
          oldMode === 0o120000 || newMode === 0o120000 };
    } });
}

async function inspectDestination(dir: string, path: string): Promise<{ exists: boolean; unsafe: boolean }> {
  const parts = path.split('/');
  let parent = dir;
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    try { if (!(await lstat(parent)).isDirectory()) return { exists: false, unsafe: true }; }
    catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return { exists: false, unsafe: false }; throw error; }
  }
  try { const found = await lstat(join(dir, path)); return { exists: true, unsafe: !found.isFile() }; }
  catch (error) { if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return { exists: false, unsafe: false }; throw error; }
}

async function previewFile(dir: string, path: string, remoteHead: string): Promise<SyncFileReview> {
  let mine: string | null = null; let github: string | null = null; let previewable = true;
  try { const details = await lstat(join(dir, path)); if (!details.isFile() || details.size > 128 * 1024) previewable = false;
    else { const bytes = await readFile(join(dir, path)); if (bytes.includes(0)) previewable = false; else mine = bytes.toString('utf8'); } }
  catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) previewable = false; }
  try { const bytes = Buffer.from((await git.readBlob({ fs, dir, oid: remoteHead, filepath: path })).blob);
    if (bytes.length > 128 * 1024 || bytes.includes(0)) previewable = false; else github = bytes.toString('utf8'); }
  catch { github = null; }
  return { path, mine: previewable ? mine : null, github: previewable ? github : null, previewable };
}

export class GitEngine {
  private readonly http: git.HttpClient;

  constructor(proxy?: string, githubRules?: Record<string, OriginRule>) {
    const agent = proxy ? new HttpsProxyAgent(proxy) : githubRules ? new GitHubOriginAgent({ rules: githubRules }) : undefined;
    this.http = agent ? { request: (options) => nodeHttp.request({ ...options, agent }) } : nodeHttp;
  }

  async openProject(path: string): Promise<GitProjectInfo> {
    const selected = await realpath(path);
    if (!(await stat(selected)).isDirectory()) throw new GitEngineError('invalid', '请选择项目文件夹。');
    let root: string;
    try { root = await git.findRoot({ fs, filepath: selected }); }
    catch { return { root: selected, isGit: false }; }
    const origin = await git.getConfig({ fs, dir: root, path: 'remote.origin.url' }) as string | undefined;
    const github = origin ? parseGithubOrigin(origin) : null;
    const branch = await git.currentBranch({ fs, dir: root }) ?? undefined;
    return { root, isGit: true, owner: github?.owner, repo: github?.repo, branch };
  }

  async getStatus(dir: string, onProgress?: (value: GitProgress) => void): Promise<GitProjectStatus> {
    onProgress?.({ step: 'checking-files', phase: '正在检查文件' });
    await assertReadableIndex(dir);
    const tracked = new Set(await git.listFiles({ fs, dir }));
    // Status and previews must stay read-only so terminating a scan cannot
    // interrupt an index rewrite, or interfere with another tool's staging.
    const rows = await git.statusMatrix({ fs, dir, ignored: false, refresh: false, filter: (path) => tracked.has(path) || !isOmitted(path) });
    const changed: ChangedFile[] = [];
    let hasPreparedChanges = false;
    const headOid = await currentHead(dir);
    for (const [path, head, workdir, stage] of rows) {
      if (head === workdir && head === stage) {
        // Filesystem timestamps can have coarse resolution. Check recently written
        // files by content so an immediate save after creation is not missed.
        if (headOid && head === 1) {
          try {
            const filePath = join(dir, path);
            const details = await stat(filePath);
            if (details.isFile() && details.size <= 8 * 1024 * 1024 && Date.now() - details.mtimeMs < 2000) {
              const previous = await git.readBlob({ fs, dir, oid: headOid, filepath: path });
              const current = await git.hashBlob({ object: await readFile(filePath) });
              if (previous.oid !== current.oid) changed.push({ path, kind: 'modified' });
            }
          } catch { /* A file may disappear during the scan; the next scan will catch it. */ }
        }
        continue;
      }
      if (stage !== head) hasPreparedChanges = true;
      changed.push({ path, kind: head === 0 ? 'added' : workdir === 0 ? 'deleted' : 'modified' });
    }
    if (headOid && changed.length > 1) await this.detectRenames(dir, headOid, changed);
    const branch = await git.currentBranch({ fs, dir }) ?? undefined;
    const pending = await pendingPublication(dir, headOid, branch);
    let ahead = false;
    let neverPushed = false;
    if (headOid && !pending) {
      let remote: string | null = null;
      try { remote = await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` }); } catch { /* A branch GitHub has never seen has no remote copy yet. */ }
      if (remote) {
        try { ahead = remote !== headOid && await git.isDescendent({ fs, dir, oid: headOid, ancestor: remote }); } catch { /* History this copy cannot read is left to the explicit push check. */ }
      } else neverPushed = Boolean(branch);
    }
    return { files: await markSensitiveFiles(dir, changed), head: headOid, hasPreparedChanges, pendingPublish: Boolean(pending) || ahead, pendingMessage: pending?.message, branch,
      pushable: !pending && (ahead || neverPushed) };
  }

  async getPublishPreview(dir: string, onProgress?: (value: GitProgress) => void): Promise<LocalPublishPreview> {
    await ensureSyncComplete(dir);
    return (await snapshotChanges(dir, await this.getStatus(dir, onProgress))).preview;
  }

  async getFileDiff(dir: string, path: string, expectedSnapshot: string, onProgress?: (value: GitProgress) => void): Promise<LocalFileDiff> {
    const snapshot = await snapshotChanges(dir, await this.getStatus(dir, onProgress));
    if (snapshot.preview.snapshot !== expectedSnapshot) throw new GitEngineError('invalid', '文件在你查看后又发生了变化，请刷新修改列表后重新选择。');
    return fileDifference(dir, snapshot, path);
  }

  private async detectRenames(dir: string, head: string, files: ChangedFile[]): Promise<void> {
    const removed = files.filter((file) => file.kind === 'deleted');
    const added = files.filter((file) => file.kind === 'added');
    if (!removed.length || !added.length || removed.length * added.length > 400) return;
    const oldByOid = new Map<string, ChangedFile>();
    for (const file of removed) {
      try { const result = await git.readBlob({ fs, dir, oid: head, filepath: file.path }); oldByOid.set(result.oid, file); }
      catch { /* Some index-only entries are absent from the previous version. */ }
    }
    for (const file of added) {
      try {
        const filePath = join(dir, file.path);
        if ((await stat(filePath)).size > 8 * 1024 * 1024) continue;
        const { oid } = await git.hashBlob({ object: await readFile(filePath) });
        const previous = oldByOid.get(oid);
        if (!previous) continue;
        file.kind = 'renamed'; file.previousPath = previous.path;
        files.splice(files.indexOf(previous), 1);
        oldByOid.delete(oid);
      } catch { /* A file may disappear while a project is being scanned. */ }
    }
  }

  async createProject(dir: string, repo: GitRepository, author: GitAuthor, token: string, onProgress?: (value: GitProgress) => void): Promise<{ head: string }> {
    const info = await this.openProject(dir);
    if (!info.isGit) {
      onProgress?.({ step: 'preparing-project', phase: '正在准备项目' });
      await git.init({ fs, dir: info.root, defaultBranch: repo.defaultBranch });
    } else if (info.branch && info.branch !== repo.defaultBranch) {
      throw new GitEngineError('unsupported', '这个文件夹使用了不同的工作版本，暂时无法直接连接。');
    }
    const origin = await git.getConfig({ fs, dir: info.root, path: 'remote.origin.url' }) as string | undefined;
    if (origin) throw new GitEngineError('unsupported', '这个文件夹已连接其他云端项目，请先检查项目设置。');
    await git.addRemote({ fs, dir: info.root, remote: 'origin', url: repositoryUrl(repo) });
    // Creating the repository never publishes working files. The UI opens the
    // same reviewed selection flow used for subsequent updates.
    return { head: await currentHead(info.root) ?? '' };
  }

  async downloadProject(parent: string, repo: GitRepository, token: string, onProgress?: (value: GitProgress) => void): Promise<{ path: string }> {
    const destination = join(parent, repo.name);
    try { await mkdir(destination); }
    catch { throw new GitEngineError('invalid', '保存位置已有同名文件夹，请选择其他位置。'); }
    onProgress?.({ step: 'downloading-project', phase: '正在下载项目' });
    await git.clone({ fs, http: this.http, dir: destination, url: repositoryUrl(repo), ref: repo.defaultBranch, singleBranch: true,
      onAuth: () => auth(token), onProgress: (event) => onProgress?.({ step: 'downloading-project', phase: '正在下载项目', loaded: event.loaded, total: event.total }) });
    return { path: destination };
  }

  async publishUpdate(dir: string, repo: GitRepository, author: GitAuthor, token: string, message: string, onProgress?: (value: GitProgress) => void, selection?: LocalPublishSelection): Promise<{ head: string; changed: number }> {
    if (!message.trim() || message.length > 200) throw new GitEngineError('invalid', '请用一句话说明这次修改。');
    if (selection) return this.publishSelected(dir, repo, author, token, message.trim(), selection, onProgress);
    const status = await this.getStatus(dir);
    if (status.pendingPublish && status.head) {
      const preview = await this.getPublishPreview(dir);
      return this.publishSelected(dir, repo, author, token, message.trim(), { snapshot: preview.snapshot, paths: [] }, onProgress);
    }
    if (status.files.some((file) => file.sensitiveReasons?.length))
      throw new GitEngineError('sensitive', '[SENSITIVE_FILES] 项目中有可能包含密码或密钥的文件，请先查看并选择本次发布的文件。');
    return this.publishInternal(dir, repo, author, token, message.trim(), false, onProgress);
  }

  private async publishSelected(dir: string, repo: GitRepository, author: GitAuthor, token: string, message: string, selection: LocalPublishSelection, onProgress?: (value: GitProgress) => void): Promise<{ head: string; changed: number }> {
    await ensureSyncComplete(dir);
    const branch = await targetBranch(dir);
    const rescan = async () => {
      const snapshot = await snapshotChanges(dir, await this.getStatus(dir));
      if (snapshot.branch !== branch) throw new GitEngineError('invalid', '当前工作版本发生了变化，请重新打开项目并检查要发布的文件。');
      return snapshot;
    };
    const current = await rescan();
    if (current.preview.needsReview) throw new GitEngineError('unsupported', '这个文件夹有其他工具准备的修改，请先在该工具中完成或取消。');
    const pending = await pendingPublication(dir, current.head, branch);
    const retryPending = pending && selection.snapshot === pending.snapshot && JSON.stringify(selection.paths) === JSON.stringify(pending.paths);
    if (current.preview.snapshot !== selection.snapshot && !retryPending) throw new GitEngineError('invalid', '文件在你查看后又发生了变化，请刷新修改列表后重新选择。');
    const batches = publishBatches(selection, message);
    if (!pending) {
      // Check the whole selection before the first saved version exists, so a bad later batch cannot leave a partial publish.
      if (selection.paths.some((path) => !current.files.some((entry) => entry.file.path === path)))
        throw new GitEngineError('invalid', '请重新选择本次要发布的文件。');
      if (!selection.sensitiveConfirmed && current.preview.files.some((file) => selection.paths.includes(file.path) && file.sensitiveReasons?.length))
        throw new GitEngineError('sensitive', '[SENSITIVE_FILES] 选中的文件可能包含密码或密钥，请查看文件选择并确认后再发布。');
    }
    let remoteHead = await this.fetchRemote(dir, repo, branch, token, onProgress);
    const push = (head: string): Promise<void> => this.pushHead(dir, repo, token, head, branch, onProgress, { phase: '正在发布到 GitHub', cancelable: false });
    if (pending) {
      // A failed upload has already created a safe local version. Retry that exact
      // version before considering additional selected changes; never create it twice.
      try { await push(pending.head); }
      catch { throw new GitEngineError('remoteChanged', '本地保存的版本还没有上传成功。请检查网络后重试发布，文件会继续保留。'); }
      remoteHead = pending.head;
      return { head: pending.head, changed: pending.paths.length };
    }
    if (remoteHead && remoteHead !== current.head) {
      if (current.head && await git.isDescendent({ fs, dir, oid: current.head, ancestor: remoteHead })) {
        try { await push(current.head); remoteHead = current.head; }
        catch { throw new GitEngineError('remoteChanged', '本地还有已保存但未上传的版本，请检查网络后重试发布。'); }
      } else throw new GitEngineError('remoteChanged', 'GitHub 上有新内容，请先获取最新，再重新查看并选择本次发布的文件。');
    }
    if (selection.paths.length === 0 && current.head) {
      if (!remoteHead) await push(current.head);
      return { head: current.head, changed: 0 };
    }
    onProgress?.({ step: 'saving-selection', phase: '正在保存选中的修改', cancelable: false });
    const reviewed = new Map(current.files.map((entry) => [entry.file.path, entry]));
    const saved: string[] = [];
    let result: { head: string; changed: number } | undefined;
    for (const [index, batch] of batches.entries()) {
      try {
        // Later batches are saved against the new version, but only if their files are still exactly what was reviewed.
        const latest = index === 0 ? current : await rescan();
        if (index > 0) {
          if (latest.preview.needsReview) throw new GitEngineError('unsupported', '这个文件夹有其他工具准备的修改，请先在该工具中完成或取消。');
          for (const path of batch.paths) {
            const now = latest.files.find((entry) => entry.file.path === path); const before = reviewed.get(path);
            if (!now || !before || now.fingerprint !== before.fingerprint || now.file.kind !== before.file.kind || now.file.previousPath !== before.file.previousPath)
              throw new GitEngineError('invalid', '文件在你查看后又发生了变化。');
          }
        }
        const saving = { snapshot: latest.preview.snapshot, paths: batch.paths, ...(selection.sensitiveConfirmed ? { sensitiveConfirmed: true } : {}) };
        const done = await commitSelectedChanges(dir, author, batch.message, saving, rescan, saved);
        saved.push(...batch.paths);
        result = { head: done.head, changed: saved.length };
        if (batches.length > 1) onProgress?.({ step: 'saving-selection', phase: `正在保存选中的修改（${index + 1}/${batches.length}）`, loaded: index + 1, total: batches.length, cancelable: false });
      } catch (error) {
        if (index === 0) throw error;
        // The earlier versions are already saved and recorded as waiting to upload; they are never created twice.
        const reason = error instanceof GitEngineError ? error.message : '请刷新后重试';
        throw new GitEngineError('remoteChanged', `前 ${index} 批已安全保存到本地，第 ${index + 1} 批没有完成：${reason}。已保存的版本不会重复生成，请点击“重试发布”上传；其余文件仍保留在电脑上。`);
      }
    }
    if (!result) throw new GitEngineError('invalid', '请重新选择本次要发布的文件。');
    try { await push(result.head); }
    catch { throw new GitEngineError('remoteChanged', '选中的修改已安全保存到本地，但还没有上传成功。请点击“重试发布”，未选文件仍保留在电脑上。'); }
    return result;
  }

  /** GitHub's current head of `branch`, or null when GitHub has no such branch yet. */
  protected async remoteBranchHead(repo: GitRepository, branch: string, token: string): Promise<string | null> {
    const refs = await git.listServerRefs({ http: this.http, url: repositoryUrl(repo), prefix: `refs/heads/${branch}`, onAuth: () => auth(token) });
    return refs.find((entry) => entry.ref === `refs/heads/${branch}`)?.oid ?? null;
  }

  /** Pushes `head` to GitHub's branch of the same name, never forcing, and forgets the waiting upload once GitHub accepted it. */
  private async pushHead(dir: string, repo: GitRepository, token: string, head: string, branch: string, onProgress?: (value: GitProgress) => void,
    options: { phase: string; cancelable?: boolean } = { phase: '正在发布到 GitHub' }): Promise<void> {
    await this.sendPush(dir, repo, token, head, branch, onProgress, options);
    await clearPendingPublication(dir, branch, head);
  }

  /** The upload itself, with the result check every push shares. */
  protected async sendPush(dir: string, repo: GitRepository, token: string, head: string, branch: string, onProgress: ((value: GitProgress) => void) | undefined,
    options: { phase: string; cancelable?: boolean }): Promise<void> {
    const cancelable = options.cancelable === undefined ? {} : { cancelable: options.cancelable };
    onProgress?.({ step: 'publishing-source', phase: options.phase, ...cancelable });
    const result = await git.push({ fs, http: this.http, dir, url: repositoryUrl(repo), remote: 'origin', ref: head, remoteRef: `refs/heads/${branch}`, force: false,
      onAuth: () => auth(token), onProgress: (event) => onProgress?.({ step: 'publishing-source', phase: options.phase, loaded: event.loaded, total: event.total, ...cancelable }) });
    if (!result.ok || result.error || Object.values(result.refs).some((value) => !value.ok)) throw new GitEngineError('remoteChanged', 'GitHub 没有接受这次发布，请检查项目权限和最新内容后重试。');
  }

  /** Names of the branches GitHub has. */
  protected async remoteBranchNames(repo: GitRepository, token: string): Promise<string[]> {
    const refs = await git.listServerRefs({ http: this.http, url: repositoryUrl(repo), prefix: 'refs/heads/', onAuth: () => auth(token) });
    return refs.map((entry) => entry.ref.slice('refs/heads/'.length));
  }

  /** The branches that exist on GitHub, plus the one the folder is on, so the list never fills up with local-only branches.
   *  Without a connection it falls back to the GitHub branches this folder already knows about. */
  async listBranches(dir: string, repo?: GitRepository, token?: string): Promise<LocalBranchList> {
    let names: string[] | null = null;
    if (repo && token) {
      try { names = await this.remoteBranchNames(repo, token); } catch { /* offline: keep what is known locally */ }
    }
    return branchList(dir, names);
  }

  /** Moves the folder to another branch. Only done when nothing is waiting to be published, so no file is ever overwritten.
   *  A branch that exists only on GitHub is downloaded first and becomes a local branch of the same name. */
  async switchBranch(dir: string, name: string, repo?: GitRepository, token?: string): Promise<LocalBranchList> {
    await ensureSyncComplete(dir);
    if (name === (await git.currentBranch({ fs, dir }))) return this.listBranches(dir, repo, token);
    const isLocal = (await git.listBranches({ fs, dir })).includes(name);
    if (!isLocal && !(repo && token)) throw new GitEngineError('invalid', '找不到这个分支，请刷新后重试。');
    const status = await this.getStatus(dir);
    if (status.hasPreparedChanges || status.files.length) throw new GitEngineError('unsupported', '项目里还有没发布的修改。请先发布这些修改，再切换分支，EasyHub 不会丢掉你的文件。');
    if (!isLocal) {
      const remoteHead = await this.fetchRemote(dir, repo!, name, token!);
      if (!remoteHead) throw new GitEngineError('invalid', 'GitHub 上找不到这个分支，请刷新后重试。');
      await git.branch({ fs, dir, ref: name, object: remoteHead });
    }
    await git.checkout({ fs, dir, ref: name });
    return this.listBranches(dir, repo, token);
  }

  /** Starts a new branch from the saved version the folder is on and moves to it. Unpublished edits stay as they are. */
  async createBranch(dir: string, name: string): Promise<LocalBranchList> {
    await ensureSyncComplete(dir);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name) || /\.\.|\/\/|\/$|\.lock$|\.$/.test(name) || !safeChangePath(name))
      throw new GitEngineError('invalid', '分支名只能用字母、数字、点、横线、下划线和斜杠，并且不能以符号开头。');
    if (!(await currentHead(dir))) throw new GitEngineError('unsupported', '项目还没有保存过版本，暂时不能新建分支。');
    if ((await git.listBranches({ fs, dir })).includes(name)) throw new GitEngineError('invalid', '已经有叫这个名字的分支了。');
    await git.branch({ fs, dir, ref: name, checkout: true });
    return this.listBranches(dir);
  }

  /** Uploads saved versions that are already on this branch (for example made with another Git tool), exactly as they are. */
  async pushBranch(dir: string, repo: GitRepository, token: string, onProgress?: (value: GitProgress) => void): Promise<LocalPushBranchResult> {
    await ensureSyncComplete(dir);
    const branch = await targetBranch(dir);
    const status = await this.getStatus(dir, onProgress);
    if (status.hasPreparedChanges) throw new GitEngineError('unsupported', '这个文件夹有其他工具准备的修改，请先在该工具中完成或取消。');
    if (status.files.length) throw new GitEngineError('invalid', '项目里还有没发布的修改。请先发布或处理这些修改，再推送分支。');
    const head = status.head;
    if (!head) throw new GitEngineError('empty', '这个分支还没有可以推送的版本。');
    onProgress?.({ step: 'checking-remote', phase: '正在检查 GitHub 上的新内容' });
    const remoteHead = await this.remoteBranchHead(repo, branch, token);
    if (remoteHead === head) {
      if (await pendingPublication(dir, head, branch)) await clearPendingPublication(dir, branch, head);
      return { state: 'current', branch };
    }
    if (remoteHead) {
      let descends = false;
      try { descends = await git.isDescendent({ fs, dir, oid: head, ancestor: remoteHead }); } catch { descends = false; }
      if (!descends) throw new GitEngineError('remoteChanged', 'GitHub 上这个分支有新内容，请先获取最新后再推送。EasyHub 不会覆盖 GitHub 上的内容。');
    }
    try { await this.pushHead(dir, repo, token, head, branch, onProgress, { phase: '正在推送分支到 GitHub' }); }
    catch (error) { throw error instanceof GitEngineError ? error : new GitEngineError('remoteChanged', '分支没有推送成功，请检查网络和项目权限后重试。'); }
    return { state: remoteHead ? 'pushed' : 'created', branch };
  }

  protected async fetchRemote(dir: string, repo: GitRepository, branch: string, token: string, onProgress?: (value: GitProgress) => void): Promise<string | null> {
    onProgress?.({ step: 'checking-remote', phase: '正在检查 GitHub 上的新内容' });
    const remoteHead = await this.remoteBranchHead(repo, branch, token);
    if (!remoteHead) return null;
    const fetched = await git.fetch({ fs, http: this.http, dir, url: repositoryUrl(repo), ref: branch, singleBranch: true,
      onAuth: () => auth(token), onProgress: (event) => onProgress?.({ step: 'checking-remote', phase: '正在检查 GitHub 上的新内容', loaded: event.loaded, total: event.total }) });
    return fetched.fetchHead ?? remoteHead;
  }

  async checkSync(dir: string, repo: GitRepository, token: string, onProgress?: (value: GitProgress) => void): Promise<SyncPreview> {
    await ensureSyncComplete(dir);
    const remoteHead = await this.fetchRemote(dir, repo, await targetBranch(dir), token, onProgress);
    if (!remoteHead) return { state: 'current', changedFiles: 0, files: [] };
    return this.inspectSync(dir, remoteHead, onProgress);
  }

  async inspectSync(dir: string, remoteHead: string, onProgress?: (value: GitProgress) => void): Promise<SyncPreview> {
    await ensureSyncComplete(dir);
    const before = await currentHead(dir);
    if (before === remoteHead) return { state: 'current', remoteRevision: remoteHead, changedFiles: 0, files: [] };
    if (!before || !(await git.isDescendent({ fs, dir, oid: remoteHead, ancestor: before })))
      return { state: 'blocked', remoteRevision: remoteHead, changedFiles: 0, files: [], message: '两边的历史内容都发生了变化，需要先由你确认；当前不会改动本地文件。' };
    const status = await this.getStatus(dir, onProgress);
    if (status.hasPreparedChanges) return { state: 'blocked', remoteRevision: remoteHead, changedFiles: 0, files: [], message: '这个文件夹中有其他工具准备的修改，请先在那个工具中完成或取消。' };
    const remoteFiles = await changedBetween(dir, before, remoteHead);
    if (remoteFiles.some((file) => file.unsafe)) return { state: 'blocked', remoteRevision: remoteHead, changedFiles: remoteFiles.length, files: [], message: 'GitHub 上的文件结构较复杂，暂时无法安全获取最新内容。' };
    const destinations = await Promise.all(remoteFiles.map((file) => inspectDestination(dir, file.path)));
    if (destinations.some((item) => item.unsafe)) return { state: 'blocked', remoteRevision: remoteHead, changedFiles: remoteFiles.length, files: [], message: '本地文件结构较复杂，暂时无法安全获取最新内容。' };
    if (status.files.some((file) => file.kind === 'renamed' && file.previousPath && remoteFiles.some((remote) => touches(remote.path, file.previousPath!))))
      return { state: 'blocked', remoteRevision: remoteHead, changedFiles: remoteFiles.length, files: [], message: '有文件同时被重命名和修改，请先在其他工具中处理。' };
    const reviewPaths = remoteFiles.filter((file, index) => (file.removed && destinations[index]?.exists) || (file.added && destinations[index]?.exists) ||
      status.files.some((local) => touches(local.path, file.path) || local.previousPath && touches(local.previousPath, file.path)));
    const files = await Promise.all(reviewPaths.map((file) => previewFile(dir, file.path, remoteHead)));
    if (files.some((file) => !file.previewable)) return { state: 'blocked', remoteRevision: remoteHead, changedFiles: remoteFiles.length, files: [], message: '有文件无法安全预览。请先备份并在其他工具中处理，EasyHub 不会覆盖它。' };
    return { state: files.length ? 'review' : 'ready', remoteRevision: remoteHead, changedFiles: remoteFiles.length, files };
  }

  async syncProject(dir: string, repo: GitRepository, token: string, expectedRevision?: string, decisions: SyncDecision[] = [], onProgress?: (value: GitProgress) => void): Promise<{ updated: number }> {
    await ensureSyncComplete(dir);
    const branch = await targetBranch(dir);
    const remoteHead = await this.fetchRemote(dir, repo, branch, token, onProgress);
    if (!remoteHead) return { updated: 0 };
    if (expectedRevision && remoteHead !== expectedRevision) throw new GitEngineError('remoteChanged', 'GitHub 上又有新内容，请重新查看后再选择。');
    return this.applyFetchedSync(dir, branch, remoteHead, decisions, onProgress);
  }

  async applyFetchedSync(dir: string, branch: string, remoteHead: string, decisions: SyncDecision[] = [], onProgress?: (value: GitProgress) => void): Promise<{ updated: number }> {
    if (await git.currentBranch({ fs, dir }) !== branch) throw new GitEngineError('unsupported', '这个项目正在使用其他工作版本，暂时无法自动获取最新内容。');
    const preview = await this.inspectSync(dir, remoteHead, onProgress);
    if (preview.state === 'current') return { updated: 0 };
    if (preview.state === 'blocked') throw new GitEngineError('remoteChanged', preview.message ?? '暂时无法安全获取最新内容。');
    const selected = new Map(decisions.map((item) => [item.path, item.choice]));
    if (selected.size !== decisions.length || decisions.some((item) => !preview.files.some((file) => file.path === item.path)))
      throw new GitEngineError('invalid', '文件选择无效，请重新检查。');
    if (preview.files.some((file) => !['mine', 'github'].includes(selected.get(file.path) ?? '')))
      throw new GitEngineError('remoteChanged', '请先确认每个文件要保留的版本。');
    const before = await currentHead(dir);
    if (!before) throw new GitEngineError('remoteChanged', '请重新检查 GitHub 上的内容。');
    const remoteFiles = await changedBetween(dir, before, remoteHead);
    const payloads = await Promise.all(remoteFiles.filter((file) => !file.removed).map(async (file) => ({ path: file.path,
      bytes: Buffer.from((await git.readBlob({ fs, dir, oid: remoteHead, filepath: file.path })).blob) })));
    const payloadByPath = new Map(payloads.map((item) => [item.path, item.bytes]));
    onProgress?.({ step: 'getting-latest', phase: '正在获取最新内容', cancelable: false });
    const marker = await incompleteSyncPath(dir);
    try { await writeFile(marker, JSON.stringify({ before, remoteHead }), { flag: 'wx' }); }
    catch { throw new GitEngineError('unsupported', '暂时无法安全更新这个项目，请检查项目文件夹后重试。'); }
    try {
      await git.merge({ fs, dir, ours: branch, theirs: remoteHead, fastForwardOnly: true, abortOnConflict: true });
    } catch { await rm(marker, { force: true }); throw new GitEngineError('remoteChanged', '无法安全获取最新内容，请先检查文件夹后重试。'); }
    try {
      for (const file of remoteFiles.filter((item) => item.removed)) {
        if (selected.get(file.path) !== 'mine') await rm(join(dir, file.path), { force: true });
        await git.updateIndex({ fs, dir, filepath: file.path, remove: true, force: true });
      }
      for (const file of remoteFiles.filter((item) => !item.removed)) {
        if (selected.get(file.path) !== 'mine') {
          const destination = join(dir, file.path);
          await mkdir(join(destination, '..'), { recursive: true });
          await writeFile(destination, payloadByPath.get(file.path)!);
          if (file.mode === 0o100755) await chmod(destination, 0o755);
        }
        await git.updateIndex({ fs, dir, filepath: file.path, oid: file.oid, mode: file.mode, add: true });
      }
    } catch { throw new GitEngineError('unsupported', '获取最新内容时文件写入失败。请检查文件夹中的内容后再发布。'); }
    await rm(marker, { force: true });
    return { updated: preview.changedFiles };
  }

  private async publishInternal(dir: string, repo: GitRepository, author: GitAuthor, token: string, message: string, initial: boolean, onProgress?: (value: GitProgress) => void): Promise<{ head: string; changed: number }> {
    await ensureSyncComplete(dir);
    const branch = await targetBranch(dir);
    const before = await currentHead(dir);
    let remoteHead = await this.fetchRemote(dir, repo, branch, token, onProgress);
    if (remoteHead && !before) throw new GitEngineError('remoteChanged', 'GitHub 上已有内容，需要先确认如何合并，暂时停止发布。');
    if (remoteHead && before !== remoteHead && !(await git.isDescendent({ fs, dir, oid: before!, ancestor: remoteHead }))) {
      const preview = await this.inspectSync(dir, remoteHead, onProgress);
      if (preview.state !== 'ready') throw new GitEngineError('remoteChanged', preview.state === 'review' ? '这个文件在另一台电脑上也修改过，请先确认要保留的版本。' : preview.message ?? '请先获取最新内容。');
      await this.syncProject(dir, repo, token, remoteHead, [], onProgress);
      remoteHead = await currentHead(dir) ?? remoteHead;
    }
    let status = await this.getStatus(dir, onProgress);
    if (status.hasPreparedChanges) throw new GitEngineError('unsupported', '这个文件夹有其他工具准备的修改，请先在该工具中完成或取消。');
    if (!before && status.files.length === 0) {
      const readme = join(dir, 'README.md');
      await writeFile(readme, `# ${basename(dir)}\n`, { flag: 'wx' });
      status = await this.getStatus(dir, onProgress);
    }
    if (status.files.length > 0) {
      onProgress?.({ step: 'collecting-changes', phase: '正在整理修改', loaded: 0, total: status.files.length, cancelable: false });
      for (const [index, file] of status.files.entries()) {
        if (file.kind === 'renamed' && file.previousPath) await git.remove({ fs, dir, filepath: file.previousPath });
        if (file.kind === 'deleted') await git.remove({ fs, dir, filepath: file.path });
        else await git.add({ fs, dir, filepath: file.path });
        onProgress?.({ step: 'collecting-changes', phase: '正在整理修改', loaded: index + 1, total: status.files.length });
      }
      await git.commit({ fs, dir, message, author });
    } else if (!before && initial) {
      throw new GitEngineError('empty', '项目里没有可以发布的文件。');
    }
    const head = await currentHead(dir);
    if (!head) throw new GitEngineError('empty', '项目里没有可以发布的内容。');
    if (remoteHead !== head) await this.pushHead(dir, repo, token, head, branch, onProgress);
    return { head, changed: status.files.length };
  }
}
