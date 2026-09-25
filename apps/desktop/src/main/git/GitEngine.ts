import * as git from 'isomorphic-git';
import nodeHttp from 'isomorphic-git/http/node';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fs from 'node:fs';
import { chmod, lstat, mkdir, readFile, realpath, stat, writeFile, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { ChangedFile, SyncDecision, SyncFileReview, SyncPreview } from '@easyhub/types';

export interface GitProgress { phase: string; loaded?: number; total?: number; cancelable?: boolean }
export interface GitProjectInfo { root: string; isGit: boolean; owner?: string; repo?: string; branch?: string }
export interface GitProjectStatus { files: ChangedFile[]; head: string | null; hasPreparedChanges: boolean }
export interface GitRepository { owner: string; name: string; defaultBranch: string }
export interface GitAuthor { name: string; email: string }

export class GitEngineError extends Error {
  constructor(public readonly code: 'remoteChanged' | 'unsupported' | 'empty' | 'invalid', message: string) { super(message); }
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

  constructor(proxy?: string) {
    this.http = proxy ? { request: (options) => nodeHttp.request({ ...options, agent: new HttpsProxyAgent(proxy) }) } : nodeHttp;
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
    onProgress?.({ phase: '正在检查文件' });
    const tracked = new Set(await git.listFiles({ fs, dir }));
    const rows = await git.statusMatrix({ fs, dir, ignored: false, refresh: true, filter: (path) => tracked.has(path) || !isOmitted(path) });
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
    return { files: changed, head: headOid, hasPreparedChanges };
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
      onProgress?.({ phase: '正在准备项目' });
      await git.init({ fs, dir: info.root, defaultBranch: repo.defaultBranch });
    } else if (info.branch && info.branch !== repo.defaultBranch) {
      throw new GitEngineError('unsupported', '这个文件夹使用了不同的工作版本，暂时无法直接连接。');
    }
    const origin = await git.getConfig({ fs, dir: info.root, path: 'remote.origin.url' }) as string | undefined;
    if (origin) throw new GitEngineError('unsupported', '这个文件夹已连接其他云端项目，请先检查项目设置。');
    await git.addRemote({ fs, dir: info.root, remote: 'origin', url: repositoryUrl(repo) });
    const result = await this.publishInternal(info.root, repo, author, token, '创建项目', true, onProgress);
    return { head: result.head };
  }

  async downloadProject(parent: string, repo: GitRepository, token: string, onProgress?: (value: GitProgress) => void): Promise<{ path: string }> {
    const destination = join(parent, repo.name);
    try { await mkdir(destination); }
    catch { throw new GitEngineError('invalid', '保存位置已有同名文件夹，请选择其他位置。'); }
    onProgress?.({ phase: '正在下载项目' });
    await git.clone({ fs, http: this.http, dir: destination, url: repositoryUrl(repo), ref: repo.defaultBranch, singleBranch: true,
      onAuth: () => auth(token), onProgress: (event) => onProgress?.({ phase: '正在下载项目', loaded: event.loaded, total: event.total }) });
    return { path: destination };
  }

  async publishUpdate(dir: string, repo: GitRepository, author: GitAuthor, token: string, message: string, onProgress?: (value: GitProgress) => void): Promise<{ head: string; changed: number }> {
    if (!message.trim() || message.length > 200) throw new GitEngineError('invalid', '请用一句话说明这次修改。');
    return this.publishInternal(dir, repo, author, token, message.trim(), false, onProgress);
  }

  private async fetchRemote(dir: string, repo: GitRepository, token: string, onProgress?: (value: GitProgress) => void): Promise<string | null> {
    onProgress?.({ phase: '正在检查 GitHub 上的新内容' });
    const refs = await git.listServerRefs({ http: this.http, url: repositoryUrl(repo), prefix: `refs/heads/${repo.defaultBranch}`, onAuth: () => auth(token) });
    const remoteHead = refs.find((entry) => entry.ref === `refs/heads/${repo.defaultBranch}`)?.oid;
    if (!remoteHead) return null;
    const fetched = await git.fetch({ fs, http: this.http, dir, url: repositoryUrl(repo), ref: repo.defaultBranch, singleBranch: true,
      onAuth: () => auth(token), onProgress: (event) => onProgress?.({ phase: '正在检查 GitHub 上的新内容', loaded: event.loaded, total: event.total }) });
    return fetched.fetchHead ?? remoteHead;
  }

  async checkSync(dir: string, repo: GitRepository, token: string, onProgress?: (value: GitProgress) => void): Promise<SyncPreview> {
    await ensureSyncComplete(dir);
    const remoteHead = await this.fetchRemote(dir, repo, token, onProgress);
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
    const remoteHead = await this.fetchRemote(dir, repo, token, onProgress);
    if (!remoteHead) return { updated: 0 };
    if (expectedRevision && remoteHead !== expectedRevision) throw new GitEngineError('remoteChanged', 'GitHub 上又有新内容，请重新查看后再选择。');
    return this.applyFetchedSync(dir, repo.defaultBranch, remoteHead, decisions, onProgress);
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
    onProgress?.({ phase: '正在获取最新内容', cancelable: false });
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
    const branch = await git.currentBranch({ fs, dir });
    if (branch && branch !== repo.defaultBranch) throw new GitEngineError('unsupported', '这个项目正在使用其他工作版本，暂时无法自动发布。');
    const before = await currentHead(dir);
    let remoteHead = await this.fetchRemote(dir, repo, token, onProgress);
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
      onProgress?.({ phase: '正在整理修改', loaded: 0, total: status.files.length, cancelable: false });
      for (const [index, file] of status.files.entries()) {
        if (file.kind === 'renamed' && file.previousPath) await git.remove({ fs, dir, filepath: file.previousPath });
        if (file.kind === 'deleted') await git.remove({ fs, dir, filepath: file.path });
        else await git.add({ fs, dir, filepath: file.path });
        onProgress?.({ phase: '正在整理修改', loaded: index + 1, total: status.files.length });
      }
      await git.commit({ fs, dir, message, author });
    } else if (!before && initial) {
      throw new GitEngineError('empty', '项目里没有可以发布的文件。');
    }
    const head = await currentHead(dir);
    if (!head) throw new GitEngineError('empty', '项目里没有可以发布的内容。');
    if (remoteHead !== head) {
      onProgress?.({ phase: '正在发布到 GitHub' });
      await git.push({ fs, http: this.http, dir, url: repositoryUrl(repo), remote: 'origin', ref: repo.defaultBranch, force: false,
        onAuth: () => auth(token), onProgress: (event) => onProgress?.({ phase: '正在发布到 GitHub', loaded: event.loaded, total: event.total }) });
    }
    return { head, changed: status.files.length };
  }
}
