import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BinaryAnalysisProgress, BinaryAnalysisRequest, BinaryAnalysisResult, BinaryAnalysisSettingsStatus, BinaryAnalysisSource } from '@easyhub/types';

export const MAX_ANALYSIS_FILE_BYTES = 128 * 1024 * 1024;
const MAX_RESULTS = 8;
const EXPIRY_MS = 60 * 60 * 1000;
const SESSION_DIRECTORY = /^session-[A-Za-z0-9]{6}$/u;
const MAX_STARTUP_CLEANUP = 32;
export interface BinaryEvidence {
  format: string;
  architecture: string;
  functionCount: number;
  functions: { name: string; address: string; code: string }[];
  imports: string[];
  strings: string[];
  limitations: string[];
}
export interface BinaryAnalyzer {
  analyze(path: string, signal: AbortSignal, progress: (completed: number, total: number) => void, language?: 'zh' | 'en'): Promise<BinaryEvidence>;
  stop(): Promise<void>;
}
export interface BinaryRuntime {
  status(): Promise<{ installed: boolean; downloadBytes?: number; error?: string }>;
  install(signal: AbortSignal, progress: (completed: number, total: number) => void): Promise<void>;
  analyzer(workspace: string): Promise<BinaryAnalyzer>;
}
export interface BinaryRemoteFile { name: string; response: Response; size?: number; gitSha?: string; sha256?: string }
type RemoteLoader = (source: Exclude<BinaryAnalysisSource, { kind: 'local' }>, signal: AbortSignal) => Promise<BinaryRemoteFile>;
type Progress = (progress: BinaryAnalysisProgress) => void;

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9-]{1,100}$/u.test(value); }
function repoPart(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,100}$/u.test(value) && value !== '.' && value !== '..'; }
function remotePath(value: unknown): value is string { return typeof value === 'string' && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/u.test(value) && value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..'); }
function name(value: string): string {
  const result = basename(value.replace(/\\/gu, '/')).replace(/[\x00-\x1f\x7f]/gu, '').slice(0, 180);
  if (!result || result === '.' || result === '..') throw new Error('文件名称无效。');
  return result;
}
function request(value: unknown): BinaryAnalysisRequest {
  if (!record(value) || !id(value.requestId) || (value.language !== 'zh' && value.language !== 'en') || !record(value.source)) throw new Error('分析请求无效，请重新选择文件。');
  const source = value.source;
  if (source.kind === 'local') {
    if (!id(source.fileId) || typeof source.name !== 'string' || source.name.length > 180 || !Number.isSafeInteger(source.size) || Number(source.size) < 0) throw new Error('文件选择无效。');
    return { requestId: value.requestId, language: value.language, source: { kind: 'local', fileId: source.fileId, name: source.name, size: Number(source.size) } };
  }
  if (!repoPart(source.owner) || !repoPart(source.repo)) throw new Error('项目地址无效。');
  if (source.kind === 'pull' && Number.isSafeInteger(source.number) && Number(source.number) > 0 && typeof source.headSha === 'string' && /^[a-f0-9]{40}$/u.test(source.headSha) && remotePath(source.path)) {
    return { requestId: value.requestId, language: value.language, source: { kind: 'pull', owner: source.owner, repo: source.repo, number: Number(source.number), headSha: source.headSha, path: source.path } };
  }
  if (source.kind === 'release' && Number.isSafeInteger(source.assetId) && Number(source.assetId) > 0 && typeof source.name === 'string' && remotePath(source.name) && source.name.length <= 180) {
    return { requestId: value.requestId, language: value.language, source: { kind: 'release', owner: source.owner, repo: source.repo, assetId: Number(source.assetId), name: source.name } };
  }
  throw new Error('分析文件来源无效。');
}

export function binaryFormat(header: Buffer): string | null {
  if (header.length >= 2 && header[0] === 0x4d && header[1] === 0x5a) return 'PE';
  if (header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'ELF';
  if (header.length >= 4 && ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.subarray(0, 4).toString('hex'))) return 'Mach-O';
  return null;
}

/** Owns grants, immutable snapshots and bounded evidence; callers never pass an arbitrary local path. */
export class BinaryAnalysisService {
  private readonly grants = new Map<string, { path: string; name: string; size: number; expiresAt: number }>();
  private readonly results = new Map<string, { result: BinaryAnalysisResult; expiresAt: number }>();
  private job: { id: string; controller: AbortController; kind: 'installing' | 'analyzing'; finished: Promise<void>; finish: () => void } | null = null;
  constructor(private readonly root: string, private readonly runtime: BinaryRuntime, private readonly remote: RemoteLoader) {}

  /** The primary application instance calls this before accepting analysis work. */
  async initialize(): Promise<void> {
    if (this.job) return;
    try {
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) return;
      const entries = await readdir(this.root, { withFileTypes: true });
      const stale = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && SESSION_DIRECTORY.test(entry.name))
        .slice(0, MAX_STARTUP_CLEANUP);
      // Bound startup work; a leftover from a crashed process contains only disposable snapshots.
      await Promise.allSettled(stale.map((entry) => this.job ? Promise.resolve() : this.removeWorkspace(join(this.root, entry.name))));
    } catch {
      // A missing or temporarily locked private folder must not prevent application startup.
    }
  }

  private async removeWorkspace(workspace: string): Promise<void> {
    const child = relative(resolve(this.root), resolve(workspace));
    if (!SESSION_DIRECTORY.test(child)) return;
    const rootInfo = await lstat(this.root);
    const info = await lstat(workspace);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !info.isDirectory() || info.isSymbolicLink()) return;
    const [root, target] = await Promise.all([realpath(this.root), realpath(workspace)]);
    if (relative(root, target) !== child) return;
    await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  async status(): Promise<BinaryAnalysisSettingsStatus> {
    const status = await this.runtime.status();
    return { installed: status.installed, engineVersion: '6.0.0', state: this.job?.kind ?? (status.installed ? 'ready' : status.error ? 'error' : 'missing'),
      ...(status.downloadBytes === undefined ? {} : { downloadBytes: status.downloadBytes }), ...(status.error ? { error: status.error } : {}) };
  }

  async grantLocal(path: string): Promise<Extract<BinaryAnalysisSource, { kind: 'local' }>> {
    const resolved = await realpath(path);
    const info = await stat(resolved);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_ANALYSIS_FILE_BYTES) throw new Error('请选择不超过 128 MB 的程序文件。');
    const fileId = randomUUID();
    const fileName = name(resolved);
    if (this.grants.size >= 32) this.grants.delete(this.grants.keys().next().value!);
    this.grants.set(fileId, { path: resolved, name: fileName, size: info.size, expiresAt: Date.now() + EXPIRY_MS });
    return { kind: 'local', fileId, name: fileName, size: info.size };
  }

  evidence(value: unknown): BinaryAnalysisResult {
    if (!id(value)) throw new Error('分析记录无效。');
    const entry = this.results.get(value);
    if (!entry || entry.expiresAt < Date.now()) { this.results.delete(value); throw new Error('分析结果已过期，请重新分析文件。'); }
    return structuredClone(entry.result);
  }

  async cancel(value: unknown): Promise<void> {
    if (!id(value)) throw new Error('分析任务无效。');
    const job = this.job;
    if (job?.id === value) { job.controller.abort(); await job.finished; }
  }
  cancelAll(): void { this.job?.controller.abort(); this.results.clear(); this.grants.clear(); }
  async shutdown(): Promise<void> { const job = this.job; this.cancelAll(); await job?.finished; }

  private beginJob(id: string, kind: 'installing' | 'analyzing'): AbortController {
    const controller = new AbortController();
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    this.job = { id, controller, kind, finished, finish };
    return controller;
  }
  private finishJob(): void { const job = this.job; this.job = null; job?.finish(); }

  async install(value: unknown, progress: Progress): Promise<BinaryAnalysisSettingsStatus> {
    if (!id(value)) throw new Error('安装任务无效。');
    if (this.job) throw new Error('分析组件正在使用，请等待当前操作完成。');
    const controller = this.beginJob(value, 'installing');
    try {
      await this.runtime.install(controller.signal, (completed, total) => progress({ requestId: value, phase: 'installing', completed, total, unit: 'bytes' }));
      controller.signal.throwIfAborted();
    } catch {
      if (controller.signal.aborted) throw new Error('安装已取消。');
      // An external downloader must not expose URLs, paths or raw process diagnostics to the UI.
      throw new Error('分析组件安装失败，请检查网络后重试。');
    } finally { this.finishJob(); }
    return this.status();
  }

  async analyze(value: unknown, progress: Progress, parentSignal?: AbortSignal): Promise<BinaryAnalysisResult> {
    const input = request(value);
    const en = input.language === 'en';
    parentSignal?.throwIfAborted();
    if (this.job) throw new Error(en ? 'An analysis operation is already in progress.' : '已有一个分析操作正在进行，请稍候。');
    const controller = this.beginJob(input.requestId, 'analyzing');
    const cancelFromParent = (): void => controller.abort();
    parentSignal?.addEventListener('abort', cancelFromParent, { once: true });
    const signal = controller.signal;
    let workspace: string | undefined;
    let analyzer: BinaryAnalyzer | undefined;
    let deadline = false;
    const timer = setTimeout(() => { deadline = true; controller.abort(); }, 10 * 60 * 1000);
    try {
      if (!(await this.runtime.status()).installed) throw new Error(en ? 'Install the analysis components first.' : '请先安装分析组件。');
      signal.throwIfAborted();
      await mkdir(this.root, { recursive: true });
      workspace = await mkdtemp(join(this.root, 'session-'));
      const stagedPath = join(workspace, 'input.bin');
      let fileName: string;
      let expectedSize: number | undefined;
      let gitSha: string | undefined;
      let expectedSha: string | undefined;
      let stream: Readable;
      progress({ requestId: input.requestId, phase: 'preparing', completed: 0, total: 0 });
      if (input.source.kind === 'local') {
        const granted = this.grants.get(input.source.fileId);
        if (!granted || granted.expiresAt < Date.now() || granted.name !== input.source.name || granted.size !== input.source.size) throw new Error(en ? 'Select the file again before analyzing it.' : '文件选择已过期，请重新选择。');
        const handle = await open(granted.path, 'r');
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size !== granted.size) throw new Error(en ? 'The file changed. Select it again.' : '文件已经改变，请重新选择。');
          stream = handle.createReadStream({ autoClose: true });
        } catch (cause) { await handle.close(); throw cause; }
        fileName = granted.name; expectedSize = granted.size;
      } else {
        const downloaded = await this.remote(input.source, signal);
        const body = downloaded.response.body;
        try {
          signal.throwIfAborted();
          if (!downloaded.response.ok || !body) throw new Error(en ? 'The program file could not be downloaded.' : '暂时无法下载这个程序文件。');
          fileName = name(downloaded.name); expectedSize = downloaded.size; gitSha = downloaded.gitSha; expectedSha = downloaded.sha256;
          const advertised = Number(downloaded.response.headers.get('content-length'));
          if (advertised > MAX_ANALYSIS_FILE_BYTES || (expectedSize !== undefined && expectedSize > MAX_ANALYSIS_FILE_BYTES)) {
            throw new Error(en ? 'Select a program file smaller than 128 MB.' : '请选择不超过 128 MB 的程序文件。');
          }
          stream = Readable.fromWeb(body as import('node:stream/web').ReadableStream);
        } catch (cause) {
          // Validation can fail before pipeline owns the stream; stop the download in that case too.
          await body?.cancel().catch(() => undefined);
          throw cause;
        }
      }
      const hash = createHash('sha256');
      let size = 0;
      let lastProgress = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_ANALYSIS_FILE_BYTES) { callback(new Error(en ? 'The program file exceeds 128 MB.' : '程序文件超过了 128 MB。')); return; }
        hash.update(chunk);
        if (Date.now() - lastProgress >= 200) { lastProgress = Date.now(); progress({ requestId: input.requestId, phase: 'preparing', completed: size, total: expectedSize ?? 0, unit: 'bytes' }); }
        callback(null, chunk);
      } });
      await pipeline(stream, meter, createWriteStream(stagedPath, { flags: 'wx' }), { signal });
      signal.throwIfAborted();
      if (!size || expectedSize !== undefined && size !== expectedSize) throw new Error(en ? 'The downloaded file is incomplete. Please try again.' : '文件内容不完整，请重新选择或下载。');
      const sha256 = hash.digest('hex');
      if (expectedSha && sha256 !== expectedSha) throw new Error(en ? 'The downloaded file did not pass verification.' : '下载的文件未通过完整性检查。');
      if (gitSha) {
        const blobHash = createHash('sha1').update(`blob ${size}\0`);
        for await (const chunk of createReadStream(stagedPath, { signal })) blobHash.update(chunk as Buffer);
        if (blobHash.digest('hex') !== gitSha) throw new Error(en ? 'The file no longer matches this change request. Refresh it.' : '文件与这次合并请求不一致，请刷新后重试。');
      }
      const headerFile = await open(stagedPath, 'r');
      const header = Buffer.alloc(64);
      try { await headerFile.read(header, 0, header.length, 0); } finally { await headerFile.close(); }
      const format = binaryFormat(header);
      if (!format) throw new Error(en ? 'Choose an EXE, DLL, ELF or Mach-O program file. Extract ZIP files before analyzing them.' : '请选择 EXE、DLL、ELF 或 Mach-O 程序文件。压缩包请解压后选择其中的程序文件。');
      analyzer = await this.runtime.analyzer(workspace);
      progress({ requestId: input.requestId, phase: 'analyzing', completed: 0, total: 0, unit: 'steps' });
      const evidence = await analyzer.analyze(stagedPath, signal, (completed, total) => progress({ requestId: input.requestId, phase: 'analyzing', completed, total, unit: 'steps' }), input.language);
      signal.throwIfAborted();
      const functions = evidence.functions.filter((fn) => fn.code.trim()).slice(0, 16).map((fn) => ({ name: fn.name.slice(0, 256), address: fn.address.slice(0, 64), code: fn.code.slice(0, 4000) }));
      const result: BinaryAnalysisResult = {
        id: randomUUID(), fileName, size, sha256, format: evidence.format || format, architecture: evidence.architecture.slice(0, 200),
        functionCount: Math.max(0, evidence.functionCount), functions,
        imports: evidence.imports.slice(0, 100).map((item) => item.slice(0, 256)), strings: evidence.strings.slice(0, 80).map((item) => item.slice(0, 500)),
        summary: en ? `Analyzed ${fileName}. Found ${evidence.functionCount} functions; inspected ${functions.length} code samples.` : `已分析 ${fileName}，识别到 ${evidence.functionCount} 个函数，查看了 ${functions.length} 个代码片段。`,
        limitations: [en ? 'This is a static sample analysis. The program was not run; the report cannot establish that it is safe.' : '本次为静态抽样分析，没有运行程序，结果不能证明程序安全。',
          ...(functions.length < evidence.functionCount ? [en ? 'Only some functions were inspected. Packed or obfuscated programs may reveal limited information.' : '本次只查看了部分函数；经过加壳或混淆的程序可能只能得到有限信息。'] : []),
          ...evidence.limitations.slice(0, 8).map((entry) => entry.slice(0, 500))],
      };
      if (this.results.size >= MAX_RESULTS) this.results.delete(this.results.keys().next().value!);
      this.results.set(result.id, { result, expiresAt: Date.now() + EXPIRY_MS });
      progress({ requestId: input.requestId, phase: 'complete', completed: 1, total: 1 });
      return structuredClone(result);
    } catch (cause) {
      if (signal.aborted) throw new Error(deadline ? en ? 'Analysis took too long. Try a smaller file.' : '分析用时较长，请尝试较小的文件。' : en ? 'Analysis cancelled.' : '分析已取消。');
      if (cause instanceof Error && cause.name !== 'GhidraBackendError' && (/^[\u3400-\u9fff]/u.test(cause.message) || /^(Select|The file|The program|The downloaded|Choose|Install)/u.test(cause.message))) throw cause;
      throw new Error(en ? 'The program could not be analyzed. Check the analysis components and try again.' : '暂时无法分析这个程序，请检查分析组件后重试。');
    } finally {
      clearTimeout(timer);
      await analyzer?.stop().catch(() => undefined);
      // Only this operation's newly created directory may be removed.
      if (workspace) await this.removeWorkspace(workspace).catch(() => undefined);
      parentSignal?.removeEventListener('abort', cancelFromParent);
      this.finishJob();
    }
  }
}
