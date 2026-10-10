import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { DownloadCommand, DownloadItem, DownloadRequest } from '../../downloads';

export type DownloadSource =
  | { kind: 'archive'; owner: string; repo: string; revision: string }
  | { kind: 'asset'; owner: string; repo: string; assetId: number; size: number; sha256?: string }
  | { kind: 'blob'; owner: string; repo: string; sha: string }
  | { kind: 'project'; owner: string; repo: string };

export interface PreparedDownload { request: DownloadRequest; source: DownloadSource; destination: string }
interface StoredDownload extends DownloadItem {
  source: DownloadSource;
  destination: string;
  validator?: string;
}
export interface DownloadDependencies {
  open: (source: Exclude<DownloadSource, { kind: 'project' }>, signal: AbortSignal, headers: Record<string, string>) => Promise<Response>;
  clone: (source: Extract<DownloadSource, { kind: 'project' }>, destination: string, signal: AbortSignal, progress: (phase: string, loaded?: number, total?: number) => void) => Promise<{ id: string; localPath: string }>;
  confirmReplace: (destination: string) => Promise<boolean>;
  changed: (items: DownloadItem[]) => void;
}

const unfinished = new Set<DownloadItem['state']>(['running', 'queued', 'paused', 'failed']);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const partialPath = (item: StoredDownload): string => `${item.destination}.easyhub-${item.id}.part`;
async function fileSize(path: string): Promise<number> {
  try { const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('下载临时文件已改变，请移除此任务后重试。'); return info.size; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0; throw error; }
}
function validator(response: Response): string | undefined {
  const etag = response.headers.get('etag');
  return etag && !etag.startsWith('W/') ? etag : response.headers.get('last-modified') ?? undefined;
}
function safeRecord(value: unknown): value is StoredDownload {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<StoredDownload>;
  const source = r.source;
  const sourceValid = source && (source.kind === 'project'
    || (source.kind === 'archive' && /^[a-f0-9]{40}$/.test(source.revision))
    || (source.kind === 'blob' && /^[a-f0-9]{40}$/.test(source.sha))
    || (source.kind === 'asset' && Number.isSafeInteger(source.assetId) && source.assetId > 0 && Number.isSafeInteger(source.size) && source.size >= 0
      && (source.sha256 === undefined || /^[a-f0-9]{64}$/.test(source.sha256))));
  return Boolean(sourceValid) && validId(r.id) && typeof r.destination === 'string' && isAbsolute(r.destination) && r.destination.length < 4096 && !r.destination.includes('\0')
    && typeof r.request === 'object' && r.request !== null && typeof r.request.fileName === 'string'
    && ['archive', 'pull-file', 'project'].includes(r.request.kind) && typeof r.request.repo?.owner?.login === 'string'
    && typeof r.source?.owner === 'string' && typeof r.source.repo === 'string'
    && /^[A-Za-z0-9_.-]{1,100}$/.test(r.source.owner) && /^[A-Za-z0-9_.-]{1,100}$/.test(r.source.repo)
    && r.source.owner !== '.' && r.source.owner !== '..' && r.source.repo !== '.' && r.source.repo !== '..'
    && Number.isFinite(r.loaded) && Number(r.loaded) >= 0 && (r.total === null || (Number.isFinite(r.total) && Number(r.total) >= 0))
    && ['running', 'queued', 'paused', 'complete', 'failed', 'cancelled'].includes(String(r.state));
}

/** Owns queue and partial files; GitHub credentials and redirect URLs never enter its ledger. */
export class DownloadManager {
  private items: StoredDownload[] = [];
  private active = new Map<string, { controller: AbortController; task: Promise<void>; intent?: 'pause' | 'cancel' }>();
  private persistence: Promise<void> = Promise.resolve();
  private stopped = false;
  private ready: Promise<void>;
  constructor(private readonly ledger: string, private readonly deps: DownloadDependencies, private readonly concurrency = 2) {
    this.ready = this.restore();
  }

  private async restore(): Promise<void> {
    try {
      const data: unknown = JSON.parse(await readFile(this.ledger, 'utf8'));
      if (Array.isArray(data)) this.items = data.filter(safeRecord).slice(0, 200).map((item) => {
        if (item.state === 'running' || item.state === 'queued') return { ...item, state: item.source.kind === 'project' ? 'failed' as const : 'paused' as const,
          phase: item.source.kind === 'project' ? '项目下载已中断，请重试。' : '已暂停，点击继续下载。', bytesPerSecond: null, seen: false };
        return { ...item, bytesPerSecond: null };
      });
      await this.persist();
    } catch { /* Missing or damaged history must not block the application. */ }
  }

  private publicItems(): DownloadItem[] {
    return this.items.map((entry) => ({ id: entry.id, request: entry.request, state: entry.state, loaded: entry.loaded, total: entry.total,
      bytesPerSecond: entry.bytesPerSecond, phase: entry.phase, percent: entry.percent, path: entry.path, localLinkId: entry.localLinkId, error: entry.error, seen: entry.seen }));
  }
  async list(): Promise<DownloadItem[]> { await this.ready; return this.publicItems(); }
  private emit(): void { this.deps.changed(this.publicItems()); }
  private persist(): Promise<void> {
    const snapshot = JSON.stringify(this.items);
    this.persistence = this.persistence.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.ledger), { recursive: true });
      const temporary = `${this.ledger}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, this.ledger);
    });
    return this.persistence;
  }
  private async update(item: StoredDownload, patch: Partial<StoredDownload>, durable = true): Promise<void> {
    Object.assign(item, patch); this.emit(); if (durable) await this.persist();
  }

  async enqueue(input: PreparedDownload): Promise<DownloadItem> {
    await this.ready;
    if (this.stopped) throw new Error('应用正在关闭，请重新打开后下载。');
    if (this.items.filter((item) => unfinished.has(item.state)).length >= 50) throw new Error('下载任务过多，请先完成或移除部分任务。');
    const duplicate = this.items.find((item) => unfinished.has(item.state) && !(item.source.kind === 'project' && item.state === 'failed')
      && item.destination === input.destination && JSON.stringify(item.source) === JSON.stringify(input.source));
    if (duplicate) return this.publicItems().find((item) => item.id === duplicate.id)!;
    const item: StoredDownload = { ...input, id: randomUUID(), state: 'queued', loaded: 0, total: null, bytesPerSecond: null, percent: null, phase: '等待下载', seen: true };
    this.items.unshift(item);
    // Keep all active/recoverable work, dropping only the oldest finished records.
    while (this.items.length > 200) {
      const reverseIndex = [...this.items].reverse().findIndex((entry) => entry.state === 'complete' || entry.state === 'cancelled');
      if (reverseIndex < 0) break;
      const old = this.items.length - 1 - reverseIndex;
      this.items.splice(old, 1);
    }
    try { await this.persist(); }
    catch { this.items = this.items.filter((entry) => entry !== item); throw new DownloadError('无法保存下载记录，请确认磁盘仍有空间后重试。'); }
    this.emit(); this.pump();
    return this.publicItems().find((entry) => entry.id === item.id)!;
  }

  async command(id: unknown, command: unknown): Promise<void> {
    await this.ready;
    if (!validId(id) || !['pause', 'resume', 'cancel', 'remove', 'seen'].includes(String(command))) throw new Error('下载操作无效。');
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new Error('找不到此下载任务。');
    const action = command as DownloadCommand;
    const finishing = this.active.get(id);
    if (finishing && item.state !== 'running' && item.state !== 'queued' && action !== 'seen') {
      await finishing.task; return this.command(id, action);
    }
    if (action === 'seen') { await this.update(item, { seen: true }); return; }
    if (action === 'resume') {
      if (!['paused', 'failed', 'cancelled'].includes(item.state)) return;
      if (item.source.kind === 'project') throw new DownloadError('请重新选择项目保存位置。未完成的项目文件已保留。');
      await this.update(item, { state: 'queued', error: undefined, phase: '等待下载', bytesPerSecond: null, seen: true }); this.pump(); return;
    }
    if (action === 'remove' && (item.state === 'running' || item.state === 'queued')) throw new Error('请先取消正在进行的下载。');
    if (action === 'pause' && item.source.kind === 'project') throw new Error('本地项目下载支持取消，暂不支持暂停。');
    const active = this.active.get(id);
    if (active && (action === 'pause' || action === 'cancel')) {
      active.intent = action; active.controller.abort(); await active.task; return;
    }
    if (action === 'pause' && item.state === 'queued') await this.update(item, { state: 'paused', phase: '已暂停', bytesPerSecond: null });
    if (action === 'cancel' || action === 'remove') {
      if (item.source.kind !== 'project') await rm(partialPath(item), { force: true });
      if (action === 'remove') { this.items = this.items.filter((entry) => entry !== item); this.emit(); await this.persist(); }
      else await this.update(item, { state: 'cancelled', phase: '下载已取消。', error: undefined, seen: false });
    }
    this.pump();
  }

  async clearFinished(): Promise<void> {
    for (const item of await this.list()) if (['complete', 'cancelled', 'failed'].includes(item.state)) await this.command(item.id, 'remove');
  }
  async completedPath(id: unknown): Promise<string> {
    await this.ready;
    const item = this.items.find((entry) => entry.id === id && entry.state === 'complete');
    if (!item?.path) throw new Error('找不到已下载的文件。');
    await lstat(item.path); return item.path;
  }
  async shutdown(): Promise<void> {
    this.stopped = true; await this.ready;
    for (const [id, active] of this.active) { active.intent = this.items.find((item) => item.id === id)?.source.kind === 'project' ? 'cancel' : 'pause'; active.controller.abort(); }
    await Promise.allSettled([...this.active.values()].map((entry) => entry.task));
    await this.persist();
  }

  private pump(): void {
    if (this.stopped) return;
    for (const item of [...this.items].reverse()) {
      if (this.active.size >= this.concurrency) break;
      if (item.state !== 'queued' || this.active.has(item.id)) continue;
      if (item.source.kind === 'project' && [...this.active.keys()].some((id) => this.items.find((entry) => entry.id === id)?.source.kind === 'project')) continue;
      const active = { controller: new AbortController(), task: Promise.resolve() } as { controller: AbortController; task: Promise<void>; intent?: 'pause' | 'cancel' };
      this.active.set(item.id, active);
      active.task = this.run(item, active).catch(() => {
        Object.assign(item, { state: 'failed', phase: '下载未完成', error: '无法保存下载记录，请确认磁盘仍有空间后重试。', bytesPerSecond: null, seen: false });
        this.emit();
      }).finally(() => { this.active.delete(item.id); this.pump(); });
    }
  }

  private async run(item: StoredDownload, active: { controller: AbortController; intent?: 'pause' | 'cancel' }): Promise<void> {
    const signal = active.controller.signal;
    try {
      await this.update(item, { state: 'running', phase: '正在准备下载…', error: undefined, bytesPerSecond: null });
      signal.throwIfAborted();
      if (item.source.kind === 'project') {
        const result = await this.deps.clone(item.source, item.destination, signal, (phase, loaded, total) => {
          void this.update(item, { phase, loaded: loaded ?? 0, total: total ?? null, percent: total ? Math.min(99, Math.round((loaded ?? 0) / total * 100)) : null }, false);
        });
        await this.update(item, { state: 'complete', phase: '项目已经下载完成。', percent: 100, path: result.localPath, localLinkId: result.id, seen: false });
      } else await this.transfer(item, signal);
    } catch (error) {
      if (active.intent === 'cancel') {
        if (item.source.kind !== 'project') await rm(partialPath(item), { force: true }).catch(() => undefined);
        await this.update(item, { state: 'cancelled', phase: '下载已取消。', bytesPerSecond: null, error: undefined, seen: false });
      } else if (active.intent === 'pause') {
        const loaded = await fileSize(partialPath(item)).catch(() => item.loaded);
        await this.update(item, { state: 'paused', loaded, percent: item.total ? Math.min(99, Math.round(loaded / item.total * 100)) : null, phase: '已暂停', bytesPerSecond: null, error: undefined });
      } else {
        const message = error instanceof DownloadError ? error.message : item.source.kind === 'project'
          ? '项目下载未完成。原有文件已保留，请重试并选择新的保存位置。' : '下载中断，请检查网络后点击继续。';
        await this.update(item, { state: 'failed', phase: '下载未完成', bytesPerSecond: null, error: message, seen: false });
      }
    }
  }

  private async transfer(item: StoredDownload, signal: AbortSignal): Promise<void> {
    if (item.source.kind === 'project') return;
    const temporary = partialPath(item);
    let offset = await fileSize(temporary);
    let restarting = offset > 0 && !item.validator;
    if (restarting) { await rm(temporary, { force: true }); offset = 0; }
    // A pause can arrive before the first stream write, leaving our own empty
    // partial file. It is not resumable and must not make the exclusive create fail.
    if (offset === 0) await rm(temporary, { force: true });
    const headers: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-`, 'If-Range': item.validator! } : {};
    let response = await this.deps.open(item.source, signal, headers);
    if (offset > 0) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      const validRange = response.status === 206 && range && Number(range[1]) === offset && Number(range[2]) >= offset && Number(range[3]) > Number(range[2])
        && validator(response) === item.validator && (!item.total || Number(range[3]) === item.total);
      if (!validRange) {
        restarting = true; offset = 0;
        await response.body?.cancel(); await rm(temporary, { force: true });
        response = await this.deps.open(item.source, signal, {});
      }
    }
    if (!response.ok || !response.body || (offset === 0 && response.status !== 200)) throw new DownloadError('服务器暂时无法提供此文件，请稍后重试。');
    const range = /^bytes \d+-\d+\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
    const contentLength = response.headers.get('content-length');
    const bodySize = contentLength !== null && /^\d+$/.test(contentLength) ? Number(contentLength) : null;
    const total = offset > 0 && range ? Number(range[1]) : bodySize;
    if (total !== null && (!Number.isSafeInteger(total) || total < 0)) { await response.body.cancel(); throw new DownloadError('服务器返回的文件长度无效，请稍后重试。'); }
    if (item.source.kind === 'asset' && total !== null && total !== item.source.size) { await response.body.cancel(); throw new DownloadError('版本文件已改变，请移除此任务后重新下载。'); }
    await this.update(item, { loaded: offset, total, validator: validator(response), phase: restarting ? '服务器不支持继续，正在重新下载…' : offset > 0 ? '正在继续下载…' : '正在下载…' });
    let received = offset; let lastProgressAt = 0; let sampledAt = Date.now(); let sampledBytes = offset; let speed: number | null = null;
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (total !== null && received > total) { callback(new DownloadError('收到的文件长度不正确，请重新下载。')); return; }
      callback(null, chunk);
    } });
    meter.on('data', () => {
      const now = Date.now();
      if (now - sampledAt >= 2000) { speed = Math.round((received - sampledBytes) * 1000 / (now - sampledAt)); sampledAt = now; sampledBytes = received; }
      if (now - lastProgressAt >= 200) { lastProgressAt = now; void this.update(item, { loaded: received, bytesPerSecond: speed, percent: total ? Math.min(99, Math.round(received / total * 100)) : null }, false); }
    });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter, createWriteStream(temporary, { flags: offset > 0 ? 'a' : 'wx' }), { signal });
    signal.throwIfAborted();
    if (total !== null && received !== total) throw new DownloadError('文件尚未下载完整，请点击继续。');
    if (item.source.kind === 'asset' && received !== item.source.size) throw new DownloadError('文件尚未下载完整，请点击继续。');
    if (item.source.kind === 'asset' && item.source.sha256) {
      const hash = createHash('sha256'); for await (const chunk of createReadStream(temporary)) hash.update(chunk as Buffer);
      if (hash.digest('hex') !== item.source.sha256) { await rm(temporary, { force: true }); throw new DownloadError('文件校验失败，请重新下载。'); }
    }
    signal.throwIfAborted();
    try {
      try { await link(temporary, item.destination); }
      catch (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : '';
        if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code)) throw error;
        await copyFile(temporary, item.destination, constants.COPYFILE_EXCL);
      }
      await rm(temporary, { force: true });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      if (!await this.deps.confirmReplace(item.destination)) throw new DownloadError('已保留原文件，下载文件尚未覆盖。可继续下载后重新选择覆盖。');
      signal.throwIfAborted(); await rename(temporary, item.destination);
    }
    await this.update(item, { state: 'complete', loaded: received, total: received, percent: 100, bytesPerSecond: null, path: item.destination,
      phase: item.request.kind === 'pull-file' ? '修改文件已经下载完成。' : '项目已经下载完成。', seen: false });
  }
}

export class DownloadError extends Error {}
