import { watch } from 'node:fs';
import { session } from 'electron';
import { randomUUID } from 'node:crypto';
import type { FSWatcher } from 'node:fs';
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';
import type { GitHubRepo } from '@easyhub/github';
import type { FolderInspection, LocalDiscoveryResult, LocalProjectStatus, SyncDecision, SyncPreview } from '@easyhub/types';
import { createEmptyRepository, gitHubIdentity, repositoryDetails } from '../services/githubService';
import type { GitProgress, GitProjectInfo, GitProjectStatus, GitRepository } from './GitEngine';
import { LocalProjectStore } from './LocalProjectStore';
import type { LocalProjectRecord } from './LocalProjectStore';
import { runGitTask } from './gitTaskRunner';
import type { GitJob, GitTask } from './gitTaskRunner';
import { DiscoveryRootsStore, findGitProjects } from './LocalProjectDiscovery';

function validName(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== '.' && value !== '..'; }
function repository(repo: GitHubRepo): GitRepository { return { owner: repo.owner.login, name: repo.name, defaultBranch: repo.default_branch || 'main' }; }
function author(user: { id?: number; login: string; name: string | null }): { name: string; email: string } {
  return { name: user.name || user.login, email: user.id ? `${user.id}+${user.login}@users.noreply.github.com` : `${user.login}@users.noreply.github.com` };
}

async function githubProxy(): Promise<string | undefined> {
  const choices = await session.defaultSession.resolveProxy('https://github.com');
  for (const choice of choices.split(';')) {
    const match = choice.trim().match(/^(PROXY|HTTPS)\s+([^\s]+)$/i);
    if (match?.[1] && match[2]) return `${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`;
  }
  return undefined;
}

export class LocalProjectService {
  private readonly grants = new Set<string>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private active: GitJob<unknown> | null = null;
  private discoveryController: AbortController | null = null;
  private discoveryJob: GitJob<GitProjectInfo> | null = null;
  private discoveryPromise: Promise<LocalDiscoveryResult> | null = null;
  private cancelSafe = true;
  private operationTail: Promise<void> = Promise.resolve();
  constructor(private readonly store: LocalProjectStore, private readonly send: (channel: string, value: unknown) => void,
    private readonly discoveryRoots?: DiscoveryRootsStore) {}

  async grant(path: string): Promise<string> {
    const canonical = await realpath(path);
    this.grants.add(canonical);
    return canonical;
  }

  private async selected(path: unknown): Promise<string> {
    if (typeof path !== 'string' || path.length > 4096) throw new Error('请先通过文件夹选择器选择位置。');
    const canonical = await realpath(path);
    if (!this.grants.has(canonical)) throw new Error('请先通过文件夹选择器选择位置。');
    return canonical;
  }

  async list(): Promise<LocalProjectRecord[]> { return this.store.list(); }

  async listDiscoveryRoots(): Promise<string[]> { return this.discoveryRoots?.list() ?? []; }

  async addDiscoveryRoot(path: unknown): Promise<string[]> {
    const canonical = await this.selected(path);
    if (parse(canonical).root === canonical) throw new Error('请选一个存放项目的文件夹，不要选择整个磁盘。');
    if (!this.discoveryRoots) throw new Error('无法保存查找位置。');
    return this.discoveryRoots.add(canonical);
  }

  async removeDiscoveryRoot(path: unknown): Promise<string[]> {
    if (typeof path !== 'string' || !this.discoveryRoots || !(await this.discoveryRoots.list()).includes(path)) throw new Error('查找位置无效。');
    return this.discoveryRoots.remove(path);
  }

  scanDiscoveryRoots(): Promise<LocalDiscoveryResult> {
    if (this.discoveryPromise) return this.discoveryPromise;
    const controller = new AbortController();
    this.discoveryController = controller;
    const task = this.scanApprovedRoots(controller.signal);
    this.discoveryPromise = task;
    void task.finally(() => { if (this.discoveryController === controller) this.discoveryController = null; if (this.discoveryPromise === task) this.discoveryPromise = null; }).catch(() => undefined);
    return task;
  }

  private async scanApprovedRoots(signal: AbortSignal): Promise<LocalDiscoveryResult> {
    const roots = await this.listDiscoveryRoots();
    const result: LocalDiscoveryResult = { added: 0, alreadyAdded: 0, skipped: 0, scanned: 0, limited: false };
    if (roots.length === 0) return result;
    const identity = await gitHubIdentity();
    const known = new Set((await this.store.list()).map((record) => record.localPath.toLowerCase()));
    const visited = new Set<string>();
    for (const root of roots) {
      if (signal.aborted) throw new Error('查找已取消。');
      let canonical: string;
      try { canonical = await realpath(root); }
      catch { result.skipped += 1; continue; }
      if (canonical !== root) { result.skipped += 1; continue; }
      const found = await findGitProjects(root, signal, (count) => this.send('easyhub:local-progress', { phase: `正在查找本地项目 · 已检查 ${result.scanned + count} 个文件夹` }));
      result.scanned += found.visited;
      result.limited ||= found.limited;
      for (const folder of found.folders) {
        if (signal.aborted) throw new Error('查找已取消。');
        const key = folder.toLowerCase();
        if (visited.has(key)) continue;
        visited.add(key);
        if (known.has(key)) { result.alreadyAdded += 1; continue; }
        this.send('easyhub:local-progress', { phase: `正在核对项目 · 已找到 ${result.added + result.skipped + result.alreadyAdded + 1} 个` });
        try {
          const job = runGitTask<GitProjectInfo>({ action: 'inspect', path: folder });
          this.discoveryJob = job;
          const info = await job.result;
          this.discoveryJob = null;
          if (info.root !== folder || !info.owner || !info.repo) { result.skipped += 1; continue; }
          const remote = await repositoryDetails(info.owner, info.repo);
          if (signal.aborted) throw new Error('查找已取消。');
          if (remote.owner.login.toLowerCase() !== identity.user.login.toLowerCase() && !remote.permissions?.push) { result.skipped += 1; continue; }
          const record = await this.store.upsert({ repositoryId: remote.id, owner: remote.owner.login, name: remote.name, localPath: folder });
          this.watchRecord(record);
          known.add(key);
          result.added += 1;
        } catch {
          if (signal.aborted) throw new Error('查找已取消。');
          result.skipped += 1;
        } finally { this.discoveryJob = null; }
      }
    }
    return result;
  }

  private async inspectRaw(path: unknown): Promise<GitProjectInfo> {
    const canonical = await this.selected(path);
    const info = await runGitTask<GitProjectInfo>({ action: 'inspect', path: canonical }).result;
    if (info.root !== canonical) throw new Error('请选择项目最外层的文件夹。');
    return info;
  }

  async inspect(path: unknown): Promise<FolderInspection> {
    const info = await this.inspectRaw(path);
    return { path: info.root, state: info.owner && info.repo ? 'github' : info.isGit ? 'existing' : 'new', owner: info.owner, name: info.repo };
  }

  async connectExisting(path: unknown): Promise<LocalProjectRecord> {
    const info = await this.inspectRaw(path);
    if (!info.isGit || !info.owner || !info.repo) throw new Error('这个文件夹尚未连接 GitHub，请先创建项目。');
    const remote = await repositoryDetails(info.owner, info.repo);
    const record = await this.store.upsert({ repositoryId: remote.id, owner: remote.owner.login, name: remote.name, localPath: info.root });
    this.watchRecord(record);
    return record;
  }

  async create(path: unknown, name: unknown, description: unknown, isPrivate: unknown): Promise<LocalProjectRecord> {
    const canonical = await this.selected(path);
    if (!validName(name) || typeof description !== 'string' || description.length > 350 || typeof isPrivate !== 'boolean') throw new Error('请检查项目名称和介绍。');
    const info = await this.inspectRaw(canonical);
    if (info.owner || info.repo) throw new Error('这个文件夹已连接 GitHub，请使用“添加现有文件夹”。');
    const identity = await gitHubIdentity();
    this.send('easyhub:local-progress', { phase: '正在创建 GitHub 项目' });
    const remote = await createEmptyRepository(name, description, isPrivate);
    try {
      await this.interactive<{ head: string }>({ action: 'create', path: info.root, repo: repository(remote), author: author(identity.user), token: identity.token });
      const record = await this.store.upsert({ repositoryId: remote.id, owner: remote.owner.login, name: remote.name, localPath: info.root });
      this.watchRecord(record);
      return record;
    } catch {
      try {
        const after = await runGitTask<GitProjectInfo>({ action: 'inspect', path: info.root }).result;
        if (after.isGit && after.owner === remote.owner.login && after.repo === remote.name) {
          const record = await this.store.upsert({ repositoryId: remote.id, owner: remote.owner.login, name: remote.name, localPath: info.root });
          this.watchRecord(record);
        }
      } catch { /* Keep the GitHub project and local files for manual recovery. */ }
      throw new Error('GitHub 项目已创建，但文件尚未完整上传。项目与本地文件都已保留，请稍后重试。');
    }
  }

  async download(owner: unknown, name: unknown, parent: unknown): Promise<LocalProjectRecord> {
    if (!validName(owner) || !validName(name)) throw new Error('项目名称无效。');
    const directory = await this.selected(parent);
    const remote = await repositoryDetails(owner, name);
    const identity = await gitHubIdentity();
    const result = await this.interactive<{ path: string }>({ action: 'download', path: directory, repo: repository(remote), token: identity.token });
    const record = await this.store.upsert({ repositoryId: remote.id, owner: remote.owner.login, name: remote.name, localPath: result.path });
    this.watchRecord(record);
    return record;
  }

  async status(id: unknown): Promise<LocalProjectStatus> {
    const record = await this.record(id);
    const result = await this.interactive<GitProjectStatus>({ action: 'status', path: record.localPath });
    return { files: result.files, needsReview: result.hasPreparedChanges };
  }

  async publish(id: unknown, rawMessage: unknown): Promise<{ changed: number }> {
    const record = await this.record(id);
    if (typeof rawMessage !== 'string' || !rawMessage.trim() || rawMessage.length > 200) throw new Error('请用一句话说明这次修改。');
    const remote = await repositoryDetails(record.owner, record.name);
    if (remote.id !== record.repositoryId) throw new Error('GitHub 项目已发生变化，请重新添加这个文件夹。');
    const identity = await gitHubIdentity();
    const result = await this.interactive<{ head: string; changed: number }>({ action: 'publish', path: record.localPath, repo: repository(remote), author: author(identity.user), token: identity.token, message: rawMessage.trim() });
    return { changed: result.changed };
  }

  async checkSync(id: unknown): Promise<SyncPreview> {
    const record = await this.record(id);
    const remote = await repositoryDetails(record.owner, record.name);
    if (remote.id !== record.repositoryId) throw new Error('GitHub 项目已发生变化，请重新添加这个文件夹。');
    const identity = await gitHubIdentity();
    return this.interactive<SyncPreview>({ action: 'check-sync', path: record.localPath, repo: repository(remote), token: identity.token });
  }

  async sync(id: unknown, revision: unknown, rawDecisions: unknown): Promise<{ updated: number }> {
    const record = await this.record(id);
    if (revision !== undefined && (typeof revision !== 'string' || !/^[a-f0-9]{40}$/i.test(revision))) throw new Error('请重新检查 GitHub 上的内容。');
    if (!Array.isArray(rawDecisions) || rawDecisions.length > 100 || !rawDecisions.every((item) =>
      typeof item === 'object' && item !== null && typeof item.path === 'string' && item.path.length <= 4096 &&
      (item.choice === 'mine' || item.choice === 'github'))) throw new Error('文件选择无效，请重新检查。');
    const remote = await repositoryDetails(record.owner, record.name);
    if (remote.id !== record.repositoryId) throw new Error('GitHub 项目已发生变化，请重新添加这个文件夹。');
    const identity = await gitHubIdentity();
    return this.interactive<{ updated: number }>({ action: 'sync', path: record.localPath, repo: repository(remote), token: identity.token,
      revision, decisions: rawDecisions as SyncDecision[] });
  }

  async path(id: unknown): Promise<string> { return (await this.record(id)).localPath; }
  async readIntroduction(id: unknown): Promise<string> {
    const record = await this.record(id);
    const file = join(record.localPath, 'README.md');
    try {
      const details = await lstat(file);
      if (!details.isFile() || details.size > 1024 * 1024) throw new Error('介绍文件无法在编辑器中打开。');
      return await readFile(file, 'utf8');
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return '';
      throw error;
    }
  }

  async saveIntroduction(id: unknown, expected: unknown, content: unknown): Promise<void> {
    if (typeof expected !== 'string' || typeof content !== 'string' || content.length > 1024 * 1024) throw new Error('项目介绍内容无效。');
    const record = await this.record(id);
    const current = await this.readIntroduction(id);
    if (current !== expected) throw new Error('介绍文件刚刚在其他地方被修改。请重新打开编辑器检查内容。');
    const file = join(record.localPath, 'README.md');
    const temp = join(record.localPath, `.easyhub-readme-${randomUUID()}.tmp`);
    try {
      await writeFile(temp, content, { flag: 'wx' });
      await rename(temp, file);
    } finally { await rm(temp, { force: true }).catch(() => undefined); }
  }
  cancel(): void { if (this.cancelSafe) this.active?.cancel(); this.discoveryController?.abort(); this.discoveryJob?.cancel(); }

  async startWatching(): Promise<void> { for (const record of await this.store.list()) this.watchRecord(record); }
  stopWatching(): void { for (const watcher of this.watchers.values()) watcher.close(); for (const timer of this.timers.values()) clearTimeout(timer); this.watchers.clear(); this.timers.clear(); }

  private async record(id: unknown): Promise<LocalProjectRecord> {
    if (typeof id !== 'string') throw new Error('项目无效。');
    const found = (await this.store.list()).find((item) => item.id === id);
    if (!found) throw new Error('找不到这个本地项目。');
    return found;
  }

  private async interactive<T>(task: GitTask): Promise<T> {
    const previous = this.operationTail;
    let release = (): void => undefined;
    this.operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const needsNetwork = task.action === 'create' || task.action === 'download' || task.action === 'publish' || task.action === 'check-sync' || task.action === 'sync';
      this.cancelSafe = true;
      const job = runGitTask<T>({ ...task, proxy: needsNetwork ? await githubProxy() : undefined },
        (value: GitProgress) => { if (value.cancelable === false) this.cancelSafe = false; this.send('easyhub:local-progress', value); });
      this.active = job;
      try { return await job.result; }
      finally { this.active = null; this.cancelSafe = true; }
    } finally { release(); }
  }

  private watchRecord(record: LocalProjectRecord): void {
    this.watchers.get(record.id)?.close();
    try {
      const watcher = watch(record.localPath, { recursive: true }, (_event, filename) => {
        const segments = String(filename ?? '').replaceAll('\\', '/').split('/');
        if (segments.some((part) => ['.git', 'node_modules', '.venv', '__pycache__', '.next', '.turbo', 'dist', 'build'].includes(part))) return;
        const earlier = this.timers.get(record.id);
        if (earlier) clearTimeout(earlier);
        this.timers.set(record.id, setTimeout(() => {
          if (this.active) return;
          void runGitTask<GitProjectStatus>({ action: 'status', path: record.localPath }).result
            .then((status) => this.send('easyhub:local-status', { id: record.id, status: { files: status.files, needsReview: status.hasPreparedChanges } }))
            .catch(() => undefined);
        }, 700));
      });
      watcher.on('error', () => { watcher.close(); this.watchers.delete(record.id); });
      this.watchers.set(record.id, watcher);
    } catch { /* Manual refresh remains available if watching is unsupported. */ }
  }
}
