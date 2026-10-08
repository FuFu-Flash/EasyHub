import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { GitHubRepo } from '@easyhub/github';
import { DownloadManager } from './DownloadManager';
import type { DownloadDependencies, DownloadSource } from './DownloadManager';
import type { DownloadItem, DownloadRequest } from '../../downloads';

const repo: GitHubRepo = { id: 1, owner: { login: 'owner' }, name: 'project', full_name: 'owner/project', description: null,
  private: false, default_branch: 'main', updated_at: '', open_issues_count: 0 };
const request: DownloadRequest = { kind: 'archive', repo, ref: 'v1', assetId: 10, fileName: 'example.zip' };
const payload = Buffer.alloc(256 * 1024, 23);
const directories: string[] = [];
const managers: DownloadManager[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
  await Promise.all(closers.splice(0).map((close) => close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function until(test: () => Promise<boolean>, timeout = 12000): Promise<void> {
  const started = Date.now();
  while (!await test()) { if (Date.now() - started > timeout) throw new Error('Download test condition timed out'); await new Promise((resolve) => setTimeout(resolve, 10)); }
}
async function server(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const host = createServer(handler);
  await new Promise<void>((resolve) => host.listen(0, '127.0.0.1', resolve));
  const address = host.address();
  if (!address || typeof address === 'string') throw new Error('No HTTP port');
  closers.push(() => new Promise<void>((resolve) => { host.closeAllConnections(); host.close(() => resolve()); }));
  return `http://127.0.0.1:${address.port}/file`;
}
function streamFile(response: ServerResponse, content: Buffer, start: number, etag = '"file-v1"', status = start ? 206 : 200): void {
  const headers: Record<string, string | number> = { 'Content-Length': content.length - start, 'Content-Type': 'application/octet-stream', ETag: etag };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${content.length - 1}/${content.length}`;
  response.writeHead(status, headers);
  let sent = start;
  const timer = setInterval(() => { if (sent >= content.length) { clearInterval(timer); response.end(); return; }
    response.write(content.subarray(sent, sent + 8192)); sent += 8192; }, 8);
  response.on('close', () => clearInterval(timer));
}
async function fixture(url: string, overrides: Partial<DownloadDependencies> = {}, concurrency = 2) {
  const directory = await mkdtemp(join(tmpdir(), 'easyhub-downloads-')); directories.push(directory);
  const ledger = join(directory, 'history.json');
  const changed = vi.fn<(items: DownloadItem[]) => void>(); const confirmReplace = vi.fn(async () => false);
  const dependencies: DownloadDependencies = { open: (_source, signal, headers) => fetch(url, { signal, headers }),
    clone: async () => { throw new Error('Not a clone test'); }, confirmReplace, changed, ...overrides };
  const manager = new DownloadManager(ledger, dependencies, concurrency); managers.push(manager);
  const source: DownloadSource = { kind: 'asset', owner: 'owner', repo: 'project', assetId: 10, size: payload.length };
  return { manager, source, directory, ledger, dependencies, changed, confirmReplace,
    add: (name = 'example.zip') => manager.enqueue({ request: { ...request, fileName: name }, source, destination: join(directory, name) }) };
}

describe('persistent download queue', () => {
  it('pauses, requests an exact byte range, and reconstructs the file without duplicating bytes', async () => {
    const ranges: Array<{ range?: string; validator?: string }> = [];
    const url = await server((req, res) => {
      ranges.push({ range: req.headers.range, validator: req.headers['if-range'] as string | undefined });
      streamFile(res, payload, Number(req.headers.range?.match(/bytes=(\d+)/)?.[1] ?? 0));
    });
    const f = await fixture(url); const item = await f.add();
    await until(async () => (await stat(join(f.directory, `example.zip.easyhub-${item.id}.part`)).catch(() => ({ size: 0 }))).size > 0);
    await f.manager.command(item.id, 'pause');
    const paused = (await f.manager.list())[0]!;
    expect(paused.state).toBe('paused'); expect(paused.loaded).toBeGreaterThan(0);
    await f.manager.command(item.id, 'resume');
    await until(async () => (await f.manager.list())[0]!.state === 'complete');
    expect(ranges[1]).toEqual({ range: `bytes=${paused.loaded}-`, validator: '"file-v1"' });
    expect(await readFile(join(f.directory, 'example.zip'))).toEqual(payload);
    expect((await readdir(f.directory)).some((file) => file.endsWith('.part'))).toBe(false);
  });

  it('continues an empty partial file left by a pause before the first disk write', async () => {
    const url = await server((_req, res) => streamFile(res, payload, 0));
    const f = await fixture(url); const item = await f.add();
    await f.manager.command(item.id, 'pause');
    await writeFile(join(f.directory, `example.zip.easyhub-${item.id}.part`), Buffer.alloc(0));
    await f.manager.command(item.id, 'resume');
    await until(async () => (await f.manager.list())[0]!.state === 'complete');
    expect(await readFile(join(f.directory, 'example.zip'))).toEqual(payload);
  });

  it.each(['ignores-range', 'changed-etag', 'invalid-range'] as const)('safely restarts when server %s', async (mode) => {
    let changed = false;
    const ranges: (string | undefined)[] = [];
    const replacement = Buffer.alloc(payload.length, 71);
    const url = await server((req, res) => {
      ranges.push(req.headers.range);
      const start = Number(req.headers.range?.match(/bytes=(\d+)/)?.[1] ?? 0);
      if (!changed) {
        // Keep the first response incomplete until pause aborts it. The restart
        // scenario requires actual persisted bytes, not only network progress.
        res.writeHead(200, { 'Content-Length': payload.length, ETag: '"file-v1"' });
        res.write(payload.subarray(0, 8192));
      }
      else if (mode === 'ignores-range') streamFile(res, replacement, 0, '"file-v2"');
      else if (mode === 'changed-etag') streamFile(res, replacement, start, '"file-v2"');
      else streamFile(res, replacement, start ? start + 1 : 0, '"file-v1"');
    });
    const f = await fixture(url); const item = await f.add();
    await until(async () => (await stat(join(f.directory, `example.zip.easyhub-${item.id}.part`)).catch(() => ({ size: 0 }))).size > 0);
    await f.manager.command(item.id, 'pause'); changed = true;
    const paused = (await f.manager.list())[0]!;
    expect(paused.state).toBe('paused'); expect(paused.loaded).toBe(8192);
    await f.manager.command(item.id, 'resume');
    await until(async () => (await f.manager.list())[0]!.state === 'complete');
    expect(await readFile(join(f.directory, 'example.zip'))).toEqual(replacement);
    expect(ranges).toEqual([undefined, `bytes=${paused.loaded}-`, undefined]);
    expect(f.changed.mock.calls.some(([items]: [DownloadItem[]]) => items.some((entry) => entry.phase.includes('重新下载')))).toBe(true);
  });

  it('restores paused downloads across restart, without resuming until the user chooses', async () => {
    const ranges: (string | undefined)[] = [];
    const url = await server((req, res) => { ranges.push(req.headers.range); streamFile(res, payload, Number(req.headers.range?.match(/bytes=(\d+)/)?.[1] ?? 0)); });
    const f = await fixture(url); const item = await f.add();
    await until(async () => (await f.manager.list())[0]!.loaded > 0);
    await f.manager.shutdown();
    const second = new DownloadManager(f.ledger, f.dependencies); managers.push(second);
    expect((await second.list())[0]!.state).toBe('paused'); expect(ranges).toHaveLength(1);
    const record = await readFile(f.ledger, 'utf8');
    expect(record).not.toContain('http://'); expect(record).not.toMatch(/authorization|accessToken|signature/i);
    await second.command(item.id, 'resume'); await until(async () => (await second.list())[0]!.state === 'complete');
    expect(ranges[1]).toMatch(/^bytes=[1-9]\d*-/);
    expect(await readFile(await second.completedPath(item.id))).toEqual(payload);
  });

  it('limits concurrent transfers, queues the rest, and cancels a queued task before a request is sent', async () => {
    let opened = 0; let running = 0; let maxRunning = 0;
    const url = await server((_req, res) => { opened += 1; running += 1; maxRunning = Math.max(maxRunning, running);
      res.on('close', () => { running -= 1; }); streamFile(res, payload, 0); });
    const f = await fixture(url);
    await f.add('one.zip'); await f.add('two.zip'); const third = await f.add('three.zip');
    expect((await f.manager.list()).find((item) => item.id === third.id)?.state).toBe('queued');
    await f.manager.command(third.id, 'cancel');
    await until(async () => (await f.manager.list()).filter((item) => item.state === 'complete').length === 2);
    expect(opened).toBe(2); expect(maxRunning).toBeLessThanOrEqual(2);
    expect((await f.manager.list())[0]?.state).toBe('cancelled');
    await f.manager.clearFinished(); expect(await f.manager.list()).toEqual([]);
    expect(await readFile(join(f.directory, 'one.zip'))).toEqual(payload);
  });

  it('advances the queue after a transfer finishes', async () => {
    const url = await server((_req, res) => streamFile(res, payload, 0));
    const f = await fixture(url, {}, 1);
    await f.add('one.zip'); const next = await f.add('two.zip');
    expect((await f.manager.list()).find((item) => item.id === next.id)?.state).toBe('queued');
    await until(async () => (await f.manager.list()).every((item) => item.state === 'complete'));
    expect(await readFile(join(f.directory, 'two.zip'))).toEqual(payload);
  });

  it('never publishes incomplete response bytes as a completed download', async () => {
    const url = await server((_req, res) => { res.writeHead(200, { 'Content-Length': payload.length, ETag: '"file-v1"' }); res.write(payload.subarray(0, 1024)); setTimeout(() => res.destroy(), 20); });
    const f = await fixture(url); await f.add();
    await until(async () => (await f.manager.list())[0]!.state === 'failed');
    expect((await readdir(f.directory))).not.toContain('example.zip');
    expect((await f.manager.list())[0]!.percent).not.toBe(100);
  });

  it('cancels only its partial file and never removes or replaces an existing user file', async () => {
    const url = await server((_req, res) => streamFile(res, payload, 0));
    const f = await fixture(url); await writeFile(join(f.directory, 'example.zip'), 'original');
    const item = await f.add();
    await until(async () => (await f.manager.list())[0]!.loaded > 0);
    await f.manager.command(item.id, 'cancel');
    expect(await readFile(join(f.directory, 'example.zip'), 'utf8')).toBe('original');
    expect((await readdir(f.directory)).some((file) => file.endsWith('.part'))).toBe(false);
    expect(f.confirmReplace).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation if a destination appears while transferring', async () => {
    const url = await server((_req, res) => streamFile(res, payload, 0));
    const f = await fixture(url); const item = await f.add();
    await until(async () => (await f.manager.list())[0]!.loaded > 0);
    await writeFile(join(f.directory, 'example.zip'), 'user-file');
    await until(async () => (await f.manager.list())[0]!.state === 'failed');
    expect(f.confirmReplace).toHaveBeenCalledOnce();
    expect(await readFile(join(f.directory, 'example.zip'), 'utf8')).toBe('user-file');
    await f.manager.command(item.id, 'remove');
    expect(await readFile(join(f.directory, 'example.zip'), 'utf8')).toBe('user-file');
  });

  it('validates release digest before marking a file complete', async () => {
    const url = await server((_req, res) => streamFile(res, payload, 0));
    const f = await fixture(url);
    await f.manager.enqueue({ request, source: { ...f.source, kind: 'asset', assetId: 10, size: payload.length, sha256: createHash('sha256').update('wrong-file').digest('hex') }, destination: join(f.directory, 'corrupt.zip') });
    await until(async () => (await f.manager.list())[0]!.state === 'failed');
    expect((await f.manager.list())[0]!.error).toContain('校验失败');
    expect((await readdir(f.directory))).not.toContain('corrupt.zip');
  });

  it('queues local project downloads and supports cancellation without pretending to pause', async () => {
    let aborted = false;
    const f = await fixture('', { clone: (_source, _target, signal, progress) => new Promise((_resolve, reject) => {
      progress('正在下载项目', 1, 100); signal.addEventListener('abort', () => { aborted = true; reject(new Error('cancelled')); }, { once: true });
    }) });
    const item = await f.manager.enqueue({ request: { kind: 'project', repo, fileName: repo.name }, source: { kind: 'project', owner: 'owner', repo: 'project' }, destination: f.directory });
    await until(async () => (await f.manager.list())[0]!.loaded === 1);
    await expect(f.manager.command(item.id, 'pause')).rejects.toThrow('暂不支持暂停');
    await f.manager.command(item.id, 'cancel'); expect(aborted).toBe(true);
    expect((await f.manager.list())[0]!.state).toBe('cancelled');
    await expect(f.manager.command(item.id, 'resume')).rejects.toThrow('重新选择项目保存位置');
  });

  it('starts a fresh clone task when the earlier attempt failed before creating its destination', async () => {
    const clone = vi.fn(async () => { throw new Error('offline before mkdir'); });
    const f = await fixture('', { clone });
    const input = { request: { kind: 'project' as const, repo, fileName: repo.name }, source: { kind: 'project' as const, owner: 'owner', repo: 'project' }, destination: f.directory };
    const first = await f.manager.enqueue(input);
    await until(async () => (await f.manager.list())[0]!.state === 'failed');
    const retry = await f.manager.enqueue(input);
    expect(retry.id).not.toBe(first.id);
    await until(async () => clone.mock.calls.length === 2);
  });
});
