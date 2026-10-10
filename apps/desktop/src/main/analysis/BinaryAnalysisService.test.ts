import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { BinaryAnalysisService, MAX_ANALYSIS_FILE_BYTES, binaryFormat, type BinaryEvidence, type BinaryRemoteFile, type BinaryRuntime } from './BinaryAnalysisService';
import type { BinaryAnalysisSource } from '@easyhub/types';

const fixtures: string[] = [];
const program = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(1024, 7)]);
const evidence: BinaryEvidence = { format: 'PE', architecture: 'x86:LE:64', functionCount: 23,
  functions: [{ name: 'entry', address: '140001000', code: 'int entry() { return 0; }' }], imports: ['kernel32.dll!ExitProcess'], strings: ['Sample program'], limitations: [] };
async function setup(overrides: { analyze?: BinaryRuntime['analyzer']; remote?: () => Promise<BinaryRemoteFile> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'easyhub-binary-test-')); fixtures.push(directory);
  const root = join(directory, 'sessions');
  const original = join(directory, 'sample.exe'); await writeFile(original, program);
  let installed = true;
  const stop = vi.fn(async () => undefined);
  const analyze = vi.fn(async (path: string) => { expect(await readFile(path)).toEqual(program); return evidence; });
  const runtime: BinaryRuntime = { status: vi.fn(async () => ({ installed })), install: vi.fn(async () => { installed = true; }),
    analyzer: overrides.analyze ?? vi.fn(async () => ({ analyze, stop })) };
  const remote = vi.fn<(source: Exclude<BinaryAnalysisSource, { kind: 'local' }>, signal: AbortSignal) => Promise<BinaryRemoteFile>>(overrides.remote ?? (async () => ({ name: 'sample.exe', response: new Response(program), size: program.length })));
  const service = new BinaryAnalysisService(root, runtime, remote);
  return { service, runtime, root, original, analyze, stop, remote, setInstalled: (value: boolean) => { installed = value; } };
}
afterEach(async () => { await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('local program analysis', () => {
  it('creates an immutable disposable snapshot without changing or exposing the original path', async () => {
    const { service, original, root, analyze, stop } = await setup();
    const source = await service.grantLocal(original);
    expect(JSON.stringify(source)).not.toContain(original);
    const progress = vi.fn();
    const result = await service.analyze({ requestId: 'local-1', source, language: 'zh' }, progress);
    expect(result).toMatchObject({ fileName: 'sample.exe', format: 'PE', functionCount: 23, size: program.length });
    expect(result.sha256).toBe(createHash('sha256').update(program).digest('hex'));
    expect(JSON.stringify(result)).not.toContain(original);
    expect(await readFile(original)).toEqual(program);
    expect(await readdir(root)).toEqual([]);
    expect(analyze).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ phase: 'complete' });
    const cached = service.evidence(result.id); cached.functions[0]!.code = 'changed';
    expect(service.evidence(result.id).functions[0]!.code).not.toBe('changed');
    service.cancelAll(); expect(() => service.evidence(result.id)).toThrow('过期');
  });

  it('rejects forged grants and arbitrary paths before invoking the analyzer', async () => {
    const { service, original, analyze } = await setup();
    await expect(service.analyze({ requestId: 'forged', source: { kind: 'local', fileId: 'fake', name: 'sample.exe', size: program.length, path: original }, language: 'zh' }, vi.fn())).rejects.toThrow('重新选择');
    expect(analyze).not.toHaveBeenCalled();
    await expect(service.analyze({ requestId: 'invalid', source: { kind: 'pull', owner: '../outside', repo: 'p', number: 1, headSha: 'a'.repeat(40), path: 'program.exe' }, language: 'zh' }, vi.fn())).rejects.toThrow('项目地址');
    await expect(service.analyze({ requestId: 'invalid', source: { kind: 'pull', owner: 'user', repo: 'p', number: 1, headSha: 'a'.repeat(40), path: '../outside.exe' }, language: 'zh' }, vi.fn())).rejects.toThrow('来源');
  });

  it('rejects changed, oversized, empty and non-program files', async () => {
    const { service, original, analyze, root } = await setup();
    const granted = await service.grantLocal(original);
    await writeFile(original, Buffer.concat([program, Buffer.from('change')]));
    await expect(service.analyze({ requestId: 'changed', source: granted, language: 'en' }, vi.fn())).rejects.toThrow('file changed');
    await truncate(original, MAX_ANALYSIS_FILE_BYTES + 1);
    await expect(service.grantLocal(original)).rejects.toThrow('128 MB');
    await writeFile(original, ''); await expect(service.grantLocal(original)).rejects.toThrow('128 MB');
    await writeFile(original, 'This is not a program');
    const text = await service.grantLocal(original);
    await expect(service.analyze({ requestId: 'text', source: text, language: 'zh' }, vi.fn())).rejects.toThrow('EXE');
    expect(analyze).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
  });

  it('requires explicit component installation and handles simultaneous analyses', async () => {
    const { service, original, runtime, setInstalled } = await setup();
    setInstalled(false);
    const source = await service.grantLocal(original);
    await expect(service.analyze({ requestId: 'missing', source, language: 'zh' }, vi.fn())).rejects.toThrow('安装分析组件');
    expect(runtime.install).not.toHaveBeenCalled();
    await service.install('install-1', vi.fn()); expect(runtime.install).toHaveBeenCalledOnce();
    let release!: () => void;
    vi.mocked(runtime.status).mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve; }); return { installed: true }; });
    const pending = service.analyze({ requestId: 'first', source, language: 'zh' }, vi.fn());
    await expect(service.analyze({ requestId: 'second', source, language: 'zh' }, vi.fn())).rejects.toThrow('正在进行');
    release(); await pending;
  });

  it('cancels in-flight work, stops its engine, cleans its workspace and permits a new operation', async () => {
    let began!: () => void;
    const ready = new Promise<void>((resolve) => { began = resolve; });
    let releaseStop!: () => void;
    const stopped = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stop = vi.fn(async () => { await stopped; });
    const { service, original, root } = await setup({ analyze: async () => ({ stop, analyze: async (_path, signal) => {
      began(); return new Promise<BinaryEvidence>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('raw engine stack')), { once: true }));
    } }) });
    const source = await service.grantLocal(original);
    const pending = service.analyze({ requestId: 'cancel-me', source, language: 'zh' }, vi.fn());
    const rejected = expect(pending).rejects.toThrow('分析已取消');
    await ready; await service.cancel('other-id'); expect(stop).not.toHaveBeenCalled();
    let cancelFinished = false;
    const cancelling = service.cancel('cancel-me').then(() => { cancelFinished = true; });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(cancelFinished).toBe(false);
    expect((await service.status()).state).toBe('analyzing');
    releaseStop(); await cancelling; await rejected;
    expect(stop).toHaveBeenCalledOnce(); expect(await readdir(root)).toEqual([]);
    expect(await readFile(original)).toEqual(program); expect((await service.status()).state).toBe('ready');
  });

  it('propagates review cancellation to the engine and finishes only after its workspace is cleaned', async () => {
    const parent = new AbortController();
    let began!: () => void;
    const ready = new Promise<void>((resolve) => { began = resolve; });
    let releaseStop!: () => void;
    const stopped = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stop = vi.fn(async () => stopped);
    const { service, original, root } = await setup({ analyze: async () => ({ stop, analyze: async (_path, signal) => {
      began(); return new Promise<BinaryEvidence>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    } }) });
    const source = await service.grantLocal(original);
    let finished = false;
    const pending = service.analyze({ requestId: 'review-1', source, language: 'en' }, vi.fn(), parent.signal).finally(() => { finished = true; });
    const rejected = expect(pending).rejects.toThrow('Analysis cancelled');
    await ready; parent.abort();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    expect((await service.status()).state).toBe('analyzing');
    releaseStop(); await rejected;
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(original)).toEqual(program);
    expect((await service.status()).state).toBe('ready');
    await expect(service.analyze({ requestId: 'already-cancelled', source, language: 'en' }, vi.fn(), parent.signal)).rejects.toThrow();
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe('verified remote snapshots', () => {
  const source = { kind: 'pull', owner: 'owner', repo: 'p', number: 3, headSha: 'a'.repeat(40), path: 'bin/program.exe' };
  it('verifies the GitHub blob identity before running the engine', async () => {
    const gitSha = createHash('sha1').update(`blob ${program.length}\0`).update(program).digest('hex');
    const { service, analyze, remote, root, original } = await setup({ remote: async () => ({ name: 'program.exe', response: new Response(program), gitSha }) });
    const result = await service.analyze({ requestId: 'pull', source, language: 'en' }, vi.fn());
    expect(result.fileName).toBe('program.exe'); expect(result.summary).toContain('Analyzed');
    expect(remote.mock.calls[0]?.[0]).toEqual(source); expect(analyze).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(original)).toEqual(program);
  });
  it('refuses a mismatched blob, release digest and response length', async () => {
    for (const remote of [
      async () => ({ name: 'sample.exe', response: new Response(program), gitSha: 'f'.repeat(40) }),
      async () => ({ name: 'sample.exe', response: new Response(program), sha256: 'f'.repeat(64) }),
      async () => ({ name: 'sample.exe', response: new Response(program), size: program.length + 1 }),
    ]) {
      const { service, analyze, root } = await setup({ remote });
      await expect(service.analyze({ requestId: 'bad-file', source, language: 'zh' }, vi.fn())).rejects.toThrow();
      expect(analyze).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
    }
  });
  it('bounds evidence and keeps raw engine diagnostics out of the UI', async () => {
    const { service, original, root } = await setup({ analyze: async () => ({ stop: async () => undefined, analyze: async () => { throw new Error('java stack C:\\private\\path'); } }) });
    const selected = await service.grantLocal(original);
    await expect(service.analyze({ requestId: 'broken', source: selected, language: 'zh' }, vi.fn())).rejects.toThrow('检查分析组件');
    expect(await readFile(original)).toEqual(program);
    expect(await readdir(root)).toEqual([]);
  });

  it('removes a partially downloaded snapshot after the remote stream fails', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; controller.enqueue(program.subarray(0, 128)); } }));
    const { service, root, original, analyze } = await setup({ remote: async () => ({ name: 'program.exe', response }) });
    const pending = service.analyze({ requestId: 'interrupted-download', source, language: 'en' }, vi.fn());
    const rejected = expect(pending).rejects.toThrow('could not be analyzed');
    await vi.waitFor(async () => {
      const [session] = await readdir(root);
      expect(session).toBeDefined();
      expect(await readFile(join(root, session!, 'input.bin'))).toEqual(program.subarray(0, 128));
    });
    body.error(new Error('network interruption'));
    await rejected;
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(original)).toEqual(program);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('cancels an in-progress remote download and removes its partial file before the review finishes', async () => {
    const parent = new AbortController();
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(program.subarray(0, 128)); }, cancel: cancelled,
    }));
    const { service, root, original, analyze } = await setup({ remote: async () => ({ name: 'program.exe', response }) });
    const pending = service.analyze({ requestId: 'cancel-download', source, language: 'en' }, vi.fn(), parent.signal);
    const rejected = expect(pending).rejects.toThrow('Analysis cancelled');
    await vi.waitFor(async () => {
      const [session] = await readdir(root);
      expect(session).toBeDefined();
      expect(await readFile(join(root, session!, 'input.bin'))).toHaveLength(128);
    });
    parent.abort(); await rejected;
    expect(cancelled).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(original)).toEqual(program);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('stops a rejected response body instead of letting its download continue', async () => {
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }), { status: 404 });
    const { service, root, analyze } = await setup({ remote: async () => ({ name: 'program.exe', response }) });
    await expect(service.analyze({ requestId: 'not-found', source, language: 'en' }, vi.fn())).rejects.toThrow('could not be downloaded');
    expect(cancelled).toHaveBeenCalledOnce();
    expect(await readdir(root)).toEqual([]);
    expect(analyze).not.toHaveBeenCalled();
  });

  it('waits for the remote-program engine to stop and delete its snapshots during application shutdown', async () => {
    let began!: () => void;
    const ready = new Promise<void>((resolve) => { began = resolve; });
    let releaseStop!: () => void;
    const stopping = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stop = vi.fn(async () => stopping);
    const { service, root, original } = await setup({ analyze: async () => ({ stop, analyze: async (path, signal) => {
      expect(await readFile(path)).toEqual(program);
      began(); return new Promise<BinaryEvidence>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    } }) });
    const pending = service.analyze({ requestId: 'quit-analysis', source, language: 'en' }, vi.fn());
    const rejected = expect(pending).rejects.toThrow('Analysis cancelled');
    await ready;
    await service.initialize();
    expect(await readdir(root)).toHaveLength(1);
    let finished = false;
    const shutdown = service.shutdown().then(() => { finished = true; });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    expect(await readdir(root)).toHaveLength(1);
    releaseStop(); await shutdown; await rejected;
    expect(await readdir(root)).toEqual([]);
    expect(await readFile(original)).toEqual(program);
  });
});

describe('crash recovery cleanup', () => {
  it('removes only private stale sessions and preserves saved downloads, installed components, and linked directories', async () => {
    const { service, root, original } = await setup();
    await mkdir(root);
    const stale = await mkdtemp(join(root, 'session-'));
    await writeFile(join(stale, 'input.bin'), program);
    await mkdir(join(stale, '.ghidra-engine-tmp'));
    await writeFile(join(stale, '.ghidra-engine-tmp', 'project.db'), 'disposable');
    const outside = join(root, '..', 'saved-downloads'); await mkdir(outside);
    await writeFile(join(outside, 'downloaded.exe'), program);
    const components = join(root, '..', 'analysis-runtime'); await mkdir(components);
    await writeFile(join(components, 'runtime.json'), 'installed runtime');
    await mkdir(join(root, 'session-user-folder'));
    await writeFile(join(root, 'session-user-folder', 'keep.txt'), 'user content');
    await writeFile(join(root, 'session-notes.txt'), 'keep notes');
    await symlink(outside, join(root, 'session-LINK01'), 'junction');
    await service.initialize();
    expect((await readdir(root)).sort()).toEqual(['session-LINK01', 'session-notes.txt', 'session-user-folder'].sort());
    expect(await readFile(join(outside, 'downloaded.exe'))).toEqual(program);
    expect(await readFile(join(components, 'runtime.json'), 'utf8')).toBe('installed runtime');
    expect(await readFile(join(root, 'session-user-folder', 'keep.txt'), 'utf8')).toBe('user content');
    expect(await readFile(original)).toEqual(program);
    await service.initialize(); // Repeating startup maintenance does not broaden its deletion scope.
    expect(await readFile(join(outside, 'downloaded.exe'))).toEqual(program);
  });

  it('leaves a linked analysis root untouched and tolerates an absent root', async () => {
    const { service, root } = await setup();
    await expect(service.initialize()).resolves.toBeUndefined();
    const outside = join(root, '..', 'external'); await mkdir(outside);
    const session = await mkdtemp(join(outside, 'session-')); await writeFile(join(session, 'keep.exe'), program);
    await symlink(outside, root, 'junction');
    await service.initialize();
    expect(await readFile(join(session, 'keep.exe'))).toEqual(program);
  });

  it('bounds orphan cleanup per startup without touching other directory types', async () => {
    const { service, root } = await setup(); await mkdir(root);
    await Promise.all(Array.from({ length: 35 }, () => mkdtemp(join(root, 'session-'))));
    await mkdir(join(root, 'downloads'));
    await service.initialize();
    expect((await readdir(root)).filter((item) => item.startsWith('session-'))).toHaveLength(3);
    expect(await readdir(root)).toContain('downloads');
    await service.initialize();
    expect(await readdir(root)).toEqual(['downloads']);
  });
});
it('identifies supported program signatures and excludes ZIP/text', () => {
  expect(binaryFormat(Buffer.from('MZ'))).toBe('PE');
  expect(binaryFormat(Buffer.from('7f454c46', 'hex'))).toBe('ELF');
  expect(binaryFormat(Buffer.from('cffaedfe', 'hex'))).toBe('Mach-O');
  expect(binaryFormat(Buffer.from('PK00000'))).toBeNull();
  expect(binaryFormat(Buffer.alloc(1))).toBeNull();
});
