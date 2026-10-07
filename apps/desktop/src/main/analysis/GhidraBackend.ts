import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Runtime contract verified against bethington/ghidra-mcp tag v6.0.0.
 * Sources: docker/entrypoint.sh, AnnotationScanner.java, HeadlessManagementService.java,
 * ListingService.java, FunctionService.java, AnalysisService.java, XrefCallGraphService.java.
 * This is a fixed HTTP adapter to the Java engine; it does not start the Python MCP bridge.
 */
export const GHIDRA_MCP_VERSION = '6.0.0';
export const GHIDRA_VERSION = '12.1.2';

export type GhidraBackendConfig = {
  mode: 'managed';
  /** Absolute java executable path, or the root of a Java 21 installation. */
  javaPath: string;
  ghidraHome: string;
  /** Plugin JAR, or extracted GhidraMCP extension directory containing lib/*.jar. */
  pluginJar: string;
  workspaceRoot: string;
  port?: number;
} | {
  mode: 'attached';
  baseUrl: string;
  workspaceRoot: string;
  authToken?: string;
};

export interface GhidraProgress {
  stage: 'starting' | 'importing' | 'analyzing' | 'reading' | 'decompiling' | 'complete';
  message: string;
  completed?: number;
  total?: number;
}

export interface GhidraEvidence {
  format: string;
  architecture: string;
  functionCount: number;
  functions: Array<{ name: string; address: string; code: string }>;
  imports: string[];
  strings: string[];
  callEdges: Array<{ from: string; to: string }>;
  limitations: string[];
  program: string;
  metadata: string;
  backendVersion: string;
}

export interface GhidraReady {
  status: 'ready';
  mode: GhidraBackendConfig['mode'];
  version: string;
  endpoint: string;
  pid?: number;
  capabilities: string[];
  diagnostics: string[];
}

export interface GhidraRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  maxResponseBytes: number;
}
export type GhidraTransport = (request: GhidraRequest) => Promise<{ status: number; text: string }>;

export interface GhidraLaunchSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onOutput: (text: string) => void;
}
export interface GhidraProcess {
  pid?: number;
  exited: Promise<{ code: number | null; error?: string }>;
  /** Must stop this process and its descendants. */
  stop: () => Promise<void>;
}
export interface GhidraRunner { start: (spec: GhidraLaunchSpec) => Promise<GhidraProcess> }
export interface GhidraBackendDependencies {
  transport?: GhidraTransport;
  runner?: GhidraRunner;
  startupTimeoutMs?: number;
  analysisTimeoutMs?: number;
  requestTimeoutMs?: number;
}
export interface GhidraAnalyzeOptions {
  signal?: AbortSignal;
  language?: 'zh' | 'en';
  onProgress?: (progress: GhidraProgress) => void;
  maxFunctions?: number;
  maxStrings?: number;
}

type ToolPath = keyof typeof ALLOWED_TOOLS;
interface ToolParameter { name: string; source: 'QUERY' | 'BODY'; required: boolean }
interface ToolDefinition { path: ToolPath; method: 'GET' | 'POST'; params: ToolParameter[] }

// Neither schema discovery nor callers can expand this set. No scripts, debugger,
// emulation, project opening, mutation, arbitrary endpoint or arbitrary JVM flags.
const ALLOWED_TOOLS = {
  '/load_program': 'POST', '/run_analysis': 'POST', '/close_program': 'POST',
  '/list_functions_enhanced': 'GET', '/get_metadata': 'GET', '/list_imports': 'GET',
  '/list_strings': 'GET', '/decompile_function': 'GET', '/get_function_callees': 'GET',
  '/get_project_info': 'GET',
} as const;
const REQUIRED_TOOLS: ToolPath[] = Object.keys(ALLOWED_TOOLS) as ToolPath[];
const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_EVIDENCE_BYTES = 65_536;

export class GhidraBackendError extends Error {
  constructor(public readonly code: 'configuration' | 'unavailable' | 'incompatible' | 'timeout' | 'cancelled' | 'engine' | 'response_limit', message: string) {
    super(message);
    this.name = 'GhidraBackendError';
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function parseJson(text: string): unknown { try { return JSON.parse(text); } catch { return undefined; } }
function short(value: unknown, max = 256): string { return typeof value === 'string' ? value.slice(0, max) : ''; }
function integer(value: number | undefined, fallback: number, max: number): number {
  return value === undefined ? fallback : Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}
function abortError(signal: AbortSignal): GhidraBackendError {
  return signal.reason instanceof GhidraBackendError ? signal.reason : new GhidraBackendError('cancelled', '分析已取消。');
}
function checkAbort(signal: AbortSignal): void { if (signal.aborted) throw abortError(signal); }
function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  return AbortSignal.any(signals.filter((signal): signal is AbortSignal => signal !== undefined));
}
function timedSignal(ms: number, message: string): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new GhidraBackendError('timeout', message)), ms);
  timer.unref?.();
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function awaitWithSignal<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  checkAbort(signal);
  let removeAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    removeAbort = () => signal.removeEventListener('abort', onAbort);
  });
  try { return await Promise.race([pending, aborted]); } finally { removeAbort(); }
}

/** Canonicalize localhost before any I/O so no DNS lookup can route it off the machine. */
export function validateGhidraUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new GhidraBackendError('configuration', 'Ghidra 后端地址无效。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new GhidraBackendError('configuration', 'Ghidra 后端只允许本机 http://127.0.0.1 或 http://[::1] 地址。');
  }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.origin;
}

/** Node HTTP avoids browser proxies and never follows redirects. The byte limit is
 * enforced while receiving, before parsing JSON or retaining the whole response. */
export const ghidraHttpTransport: GhidraTransport = async (input) => {
  const url = new URL(input.url);
  validateGhidraUrl(url.origin);
  checkAbort(input.signal);
  return new Promise((resolveReply, reject) => {
    const req = httpRequest(url, { method: input.method, headers: input.headers, signal: input.signal }, (res) => {
      const chunks: Buffer[] = [];
      let length = 0;
      res.on('data', (chunk: Buffer) => {
        length += chunk.length;
        if (length > input.maxResponseBytes) {
          const error = new GhidraBackendError('response_limit', 'Ghidra 返回内容超过大小上限。');
          reject(error);
          res.destroy(error);
          req.destroy(error);
        } else chunks.push(chunk);
      });
      res.on('end', () => resolveReply({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
      res.on('aborted', () => reject(new GhidraBackendError('unavailable', 'Ghidra 返回内容中断。')));
    });
    req.on('error', reject);
    req.end(input.body);
  });
};

export const ghidraProcessRunner: GhidraRunner = {
  async start(spec) {
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd, env: spec.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    child.stdout.on('data', (chunk: Buffer) => spec.onOutput(chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => spec.onOutput(chunk.toString('utf8')));
    let finished = false;
    const exited = new Promise<{ code: number | null; error?: string }>((resolveExit) => {
      child.once('error', (error) => { finished = true; resolveExit({ code: null, error: error.message }); });
      child.once('close', (code) => { finished = true; resolveExit({ code }); });
    });
    await new Promise<void>((resolveStart, reject) => { child.once('spawn', resolveStart); child.once('error', reject); });
    let stopping: Promise<void> | undefined;
    return {
      pid: child.pid, exited,
      stop: () => stopping ??= (async () => {
        if (finished || !child.pid) return;
        if (process.platform === 'win32') {
          // Killing Java alone can orphan Ghidra's native decompiler children.
          // Only the PID returned by this runner is ever passed to taskkill.
          const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          await new Promise<void>((resolveKill, reject) => {
            killer.once('error', reject);
            killer.once('close', (code) => code === 0 || finished ? resolveKill() : reject(new Error('无法停止 Ghidra 进程树。')));
          });
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (!finished) throw error; }
          const grace = await Promise.race([exited.then(() => true), delay(2000).then(() => false)]);
          if (!grace) { try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (!finished) throw error; } }
        }
        const stopped = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
        if (!stopped) throw new Error('Ghidra 进程停止超时。');
      })(),
    };
  },
};

async function freePort(preferred?: number): Promise<number> {
  if (preferred !== undefined && (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65535)) {
    throw new GhidraBackendError('configuration', 'Ghidra 端口必须是 1024–65535 的整数。');
  }
  const server = createServer();
  return new Promise((resolvePort, reject) => {
    server.once('error', (error) => reject(new GhidraBackendError('configuration', `Ghidra 端口不可用：${error.message}`)));
    server.listen(preferred ?? 0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function requireAbsolute(value: string, label: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\x00-\x1f]/.test(value)) {
    throw new GhidraBackendError('configuration', `${label}必须是绝对路径。`);
  }
  return resolve(value);
}
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function jarsIn(directory: string): Promise<string[]> {
  return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.jar'))
    .map((entry) => join(directory, entry.name)).sort();
}
function quoteJavaArgument(value: string): string {
  if (/[\x00\r\n]/.test(value)) throw new GhidraBackendError('configuration', 'Java 参数包含无效字符。');
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export class GhidraBackend {
  private readonly transport: GhidraTransport;
  private readonly runner: GhidraRunner;
  private readonly startupTimeoutMs: number;
  private readonly analysisTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private endpoint = '';
  private token = '';
  private process?: GhidraProcess;
  private runtimeDirectory?: string;
  private root?: string;
  private lifecycle = new AbortController();
  private ready?: GhidraReady;
  private starting?: Promise<GhidraReady>;
  private preparing?: Promise<GhidraLaunchSpec>;
  private launching?: Promise<GhidraProcess>;
  private stopping?: Promise<void>;
  private analyzing = false;
  private exited?: { code: number | null; error?: string };
  private log = '';
  private readonly tools = new Map<ToolPath, ToolDefinition>();

  constructor(private readonly config: GhidraBackendConfig, dependencies: GhidraBackendDependencies = {}) {
    requireAbsolute(config.workspaceRoot, '分析工作目录');
    if (config.mode === 'attached') this.endpoint = validateGhidraUrl(config.baseUrl);
    this.transport = dependencies.transport ?? ghidraHttpTransport;
    this.runner = dependencies.runner ?? ghidraProcessRunner;
    this.startupTimeoutMs = integer(dependencies.startupTimeoutMs, 60_000, 300_000);
    this.analysisTimeoutMs = integer(dependencies.analysisTimeoutMs, 180_000, 600_000);
    this.requestTimeoutMs = integer(dependencies.requestTimeoutMs, 20_000, 60_000);
  }

  async start(signal?: AbortSignal): Promise<GhidraReady> {
    if (signal?.aborted) throw abortError(signal);
    if (this.ready && !this.exited) return this.ready;
    if (this.stopping) await awaitWithSignal(this.stopping, signal);
    if (this.starting) return awaitWithSignal(this.starting, signal);
    const starting = this.startInternal(signal);
    this.starting = starting;
    try { return await starting; } finally { if (this.starting === starting) this.starting = undefined; }
  }

  private async startInternal(caller?: AbortSignal): Promise<GhidraReady> {
    this.lifecycle = new AbortController();
    this.exited = undefined;
    this.log = '';
    this.tools.clear();
    const timeout = timedSignal(this.startupTimeoutMs, 'Ghidra 启动超时，请检查 Java 21、Ghidra 和插件版本。');
    const signal = combineSignals([caller, timeout.signal, this.lifecycle.signal]);
    try {
      await mkdir(this.config.workspaceRoot, { recursive: true });
      this.root = await realpath(this.config.workspaceRoot);
      if (this.config.mode === 'managed') {
        this.token = randomUUID();
        const port = await freePort(this.config.port);
        this.endpoint = `http://127.0.0.1:${port}`;
        const preparing = this.launchSpec(this.config);
        this.preparing = preparing;
        let spec: GhidraLaunchSpec;
        try { spec = await preparing; }
        finally { if (this.preparing === preparing) this.preparing = undefined; }
        checkAbort(signal);
        const launching = this.runner.start(spec);
        this.launching = launching;
        let owned: GhidraProcess;
        try { owned = await launching; this.process = owned; }
        finally { if (this.launching === launching) this.launching = undefined; }
        owned.exited.then((exit) => { if (this.process === owned) { this.exited = exit; this.ready = undefined; } });
        checkAbort(signal);
      } else this.token = this.config.authToken ?? '';

      let lastError: unknown;
      while (true) {
        checkAbort(signal);
        const exit = this.processExit();
        if (exit) {
          const hint = /UnsupportedClassVersionError/.test(this.log) ? '需要 Java 21。'
            : /ClassNotFoundException|NoClassDefFoundError/.test(this.log) ? '请检查 Ghidra 和插件 JAR 安装是否完整。'
              : /Address already in use|BindException/.test(this.log) ? '分析端口已被其他程序占用。' : '请检查分析组件安装。';
          throw new GhidraBackendError('unavailable', `Ghidra 进程已退出（${exit.code ?? '启动失败'}）。${hint}`);
        }
        try {
          const versionBody = record(parseJson(await this.request('/get_version', 'GET', undefined, signal)));
          const version = short(versionBody?.plugin_version, 80);
          if (version !== GHIDRA_MCP_VERSION && version !== `${GHIDRA_MCP_VERSION}-headless`) {
            throw new GhidraBackendError('incompatible', `需要 Ghidra MCP ${GHIDRA_MCP_VERSION}，后端报告 ${version || '未知版本'}。`);
          }
          if (versionBody?.mode !== 'headless') throw new GhidraBackendError('incompatible', '需要独立 headless 后端，避免修改已有 Ghidra GUI 项目。');
          this.readSchema(await this.request('/mcp/schema', 'GET', undefined, signal, 2_097_152));
          this.ready = {
            status: 'ready', mode: this.config.mode, version, endpoint: this.endpoint, pid: this.process?.pid,
            capabilities: REQUIRED_TOOLS.map((path) => path.slice(1)),
            diagnostics: ['已核对固定版本和工具参数协议。', '二进制只作为静态数据导入，不执行目标程序。',
              this.config.mode === 'managed' ? '独立进程、独立设置/缓存目录；脚本接口已禁用。' : '已接入本机 headless；取消会中断请求，外部分析任务由该后端管理。'],
          };
          return this.ready;
        } catch (error) {
          if (error instanceof GhidraBackendError && ['incompatible', 'response_limit', 'cancelled', 'timeout'].includes(error.code)) throw error;
          if (this.config.mode === 'attached') throw error;
          lastError = error;
        }
        try { await delay(300, undefined, { signal }); } catch { checkAbort(signal); throw lastError; }
      }
    } catch (error) {
      const failure = signal.aborted ? abortError(signal) : error;
      await this.stop();
      if (failure instanceof GhidraBackendError) throw failure;
      throw new GhidraBackendError('unavailable', `无法连接 Ghidra 分析引擎：${this.diagnostic(failure)}`);
    } finally { timeout.clear(); }
  }

  private processExit(): { code: number | null; error?: string } | undefined { return this.exited; }

  private diagnostic(value: unknown, max = 500): string {
    let message = (value instanceof Error ? value.message : String(value)).split(/\r?\n/, 1)[0] ?? '';
    if (this.root) {
      for (const path of [this.root, this.root.replace(/\\/g, '/')]) {
        message = message.replace(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '专用分析目录');
      }
    }
    return message.slice(0, max);
  }

  private async launchSpec(config: Extract<GhidraBackendConfig, { mode: 'managed' }>): Promise<GhidraLaunchSpec> {
    const javaPath = requireAbsolute(config.javaPath, 'Java 路径');
    const ghidraHome = requireAbsolute(config.ghidraHome, 'Ghidra 路径');
    const pluginPath = requireAbsolute(config.pluginJar, 'Ghidra MCP 插件路径');
    const javaExecutable = (await stat(javaPath)).isDirectory() ? join(javaPath, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : javaPath;
    if (!/^(java|java\.exe)$/i.test(basename(javaExecutable)) || !(await stat(javaExecutable)).isFile()) {
      throw new GhidraBackendError('configuration', '请选择 Java 21 的 java.exe 可执行文件或安装目录。');
    }
    const properties = await readFile(join(ghidraHome, 'Ghidra', 'application.properties'), 'utf8');
    if (!new RegExp(`^application\\.version=${GHIDRA_VERSION.replace(/\./g, '\\.')}\\s*$`, 'm').test(properties)) {
      throw new GhidraBackendError('incompatible', `需要 Ghidra ${GHIDRA_VERSION}。`);
    }
    const plugins = (await stat(pluginPath)).isDirectory() ? await jarsIn(join(pluginPath, 'lib')) : [pluginPath];
    if (!plugins.length || plugins.some((path) => !path.endsWith('.jar'))) throw new GhidraBackendError('configuration', '未找到 Ghidra MCP 插件 JAR。');
    const classpath = [...plugins];
    for (const group of ['Framework', 'Features', 'Processors']) {
      const directory = join(ghidraHome, 'Ghidra', group);
      for (const module of await readdir(directory, { withFileTypes: true })) {
        if (!module.isDirectory()) continue;
        try { classpath.push(...await jarsIn(join(directory, module.name, 'lib'))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
    }
    if (classpath.length < plugins.length + 2) throw new GhidraBackendError('configuration', 'Ghidra 安装缺少运行时 JAR。');
    this.runtimeDirectory = await mkdtemp(join(this.root!, '.ghidra-engine-'));
    for (const name of ['temp', 'settings', 'cache']) await mkdir(join(this.runtimeDirectory, name));
    const args = ['-Xmx2g', '-Djava.awt.headless=true', '-Dfile.encoding=UTF-8',
      `-Dghidra.home=${ghidraHome}`, '-Dapplication.name=GhidraMCP',
      `-Djava.io.tmpdir=${join(this.runtimeDirectory, 'temp')}`,
      `-Dapplication.tempdir=${join(this.runtimeDirectory, 'temp')}`,
      `-Dapplication.settingsdir=${join(this.runtimeDirectory, 'settings')}`,
      `-Dapplication.cachedir=${join(this.runtimeDirectory, 'cache')}`,
      '-classpath', classpath.join(delimiter), 'com.xebyte.headless.GhidraMCPHeadlessServer',
      '--bind', '127.0.0.1', '--port', new URL(this.endpoint).port];
    const argumentFile = join(this.runtimeDirectory, 'java.args');
    // Java's argument file avoids Windows' 32K command-line limit with a full Ghidra classpath.
    await writeFile(argumentFile, args.map(quoteJavaArgument).join('\n'), { encoding: 'utf8', mode: 0o600 });
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|JDK_JAVA_OPTIONS|CLASSPATH|GHIDRA_MCP_.+)$/i.test(key)) delete env[key];
    env.GHIDRA_MCP_BIND_ADDRESS = '127.0.0.1';
    env.GHIDRA_MCP_AUTH_TOKEN = this.token;
    env.GHIDRA_MCP_ALLOW_SCRIPTS = 'false';
    env.GHIDRA_MCP_FILE_ROOT = this.root;
    return { executable: javaExecutable, args: [`@${argumentFile}`], cwd: this.runtimeDirectory, env,
      onOutput: (text) => { this.log = (this.log + text).slice(-8000); } };
  }

  private readSchema(text: string): void {
    const rawTools = record(parseJson(text))?.tools;
    if (!Array.isArray(rawTools)) throw new GhidraBackendError('incompatible', 'Ghidra /mcp/schema 没有有效工具列表。');
    for (const value of rawTools) {
      const raw = record(value);
      const path = short(raw?.path) as ToolPath;
      if (!Object.hasOwn(ALLOWED_TOOLS, path)) continue;
      if (raw?.method !== ALLOWED_TOOLS[path] || !Array.isArray(raw.params)) {
        throw new GhidraBackendError('incompatible', `Ghidra 工具 ${path} 协议不兼容。`);
      }
      const params: ToolParameter[] = raw.params.map((value: unknown) => {
        const param = record(value);
        const source = String(param?.source).toUpperCase();
        if (typeof param?.name !== 'string' || !['QUERY', 'BODY'].includes(source)) {
          throw new GhidraBackendError('incompatible', `Ghidra 工具 ${path} 参数协议不兼容。`);
        }
        return { name: param.name, source: source as 'QUERY' | 'BODY', required: param.required === true };
      });
      this.tools.set(path, { path, method: ALLOWED_TOOLS[path], params });
    }
    const missing = REQUIRED_TOOLS.filter((path) => !this.tools.has(path));
    if (missing.length) throw new GhidraBackendError('incompatible', `Ghidra 缺少分析工具：${missing.join(', ')}。`);
  }

  private async request(path: string, method: 'GET' | 'POST', body: string | undefined, signal: AbortSignal, maxResponseBytes = MAX_RESPONSE_BYTES, timeoutMs = this.requestTimeoutMs): Promise<string> {
    const timeout = timedSignal(timeoutMs, 'Ghidra 请求超时。');
    const combined = combineSignals([signal, timeout.signal, this.lifecycle.signal]);
    const headers: Record<string, string> = { Accept: 'application/json, text/plain' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    try {
      checkAbort(combined);
      // Race also protects injected transports which cannot physically abort their I/O.
      let removeAbort = () => {};
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => reject(abortError(combined));
        combined.addEventListener('abort', onAbort, { once: true });
        removeAbort = () => combined.removeEventListener('abort', onAbort);
      });
      let reply: Awaited<ReturnType<GhidraTransport>>;
      try { reply = await Promise.race([this.transport({ url: this.endpoint + path, method, headers, body, signal: combined, maxResponseBytes }), aborted]); }
      finally { removeAbort(); }
      if (Buffer.byteLength(reply.text, 'utf8') > maxResponseBytes) throw new GhidraBackendError('response_limit', 'Ghidra 返回内容超过大小上限。');
      if (reply.status !== 200) throw new GhidraBackendError('engine', `Ghidra 请求失败（HTTP ${reply.status}）。`);
      const json = record(parseJson(reply.text));
      if (typeof json?.error === 'string' || json?.success === false) {
        throw new GhidraBackendError('engine', `Ghidra 分析失败：${typeof json?.error === 'string' ? this.diagnostic(json.error) : '后端操作未完成'}`);
      }
      return reply.text;
    } catch (error) {
      if (combined.aborted) throw abortError(combined);
      if (error instanceof GhidraBackendError) throw error;
      throw new GhidraBackendError('unavailable', `无法连接 Ghidra 后端：${this.diagnostic(error)}`);
    } finally { timeout.clear(); }
  }

  private async tool(path: ToolPath, values: Record<string, string | number>, signal: AbortSignal, timeoutMs?: number): Promise<string> {
    const tool = this.tools.get(path);
    if (!tool) throw new GhidraBackendError('incompatible', `Ghidra 工具 ${path} 不可用。`);
    const query = new URLSearchParams();
    const body: Record<string, string | number> = {};
    for (const param of tool.params) {
      const value = values[param.name];
      if (value === undefined) {
        if (param.required) throw new GhidraBackendError('incompatible', `Ghidra 工具 ${path} 要求未支持的参数 ${param.name}。`);
        continue;
      }
      if (param.source === 'BODY') body[param.name] = value;
      else query.set(param.name, String(value));
    }
    for (const name of Object.keys(values)) if (!tool.params.some((param) => param.name === name)) {
      throw new GhidraBackendError('incompatible', `Ghidra 工具 ${path} 缺少参数 ${name}。`);
    }
    return this.request(path + (query.size ? `?${query}` : ''), tool.method,
      tool.method === 'POST' ? JSON.stringify(body) : undefined, signal, MAX_RESPONSE_BYTES, timeoutMs);
  }

  async analyze(stagedPath: string, options: GhidraAnalyzeOptions = {}): Promise<GhidraEvidence> {
    if (this.analyzing) throw new GhidraBackendError('engine', '此 Ghidra 后端已有分析任务。');
    this.analyzing = true;
    const timeout = timedSignal(this.analysisTimeoutMs, 'Ghidra 静态分析超时。');
    const signal = combineSignals([options.signal, timeout.signal]);
    let program = '';
    const limitations: string[] = [];
    const localized = (zh: string, en: string) => options.language === 'en' ? en : zh;
    const noteDiagnostic = (error: unknown) => { this.log = (this.log + `\n${this.diagnostic(error)}`).slice(-8000); };
    const progress = (value: GhidraProgress) => options.onProgress?.(value);
    try {
      progress({ stage: 'starting', message: localized('启动并检查 Ghidra 静态分析引擎', 'Starting and checking the static analysis engine') });
      await this.start(signal);
      checkAbort(signal);
      const input = await realpath(requireAbsolute(stagedPath, '待分析文件'));
      if (!inside(this.root!, input) || !(await stat(input)).isFile()) throw new GhidraBackendError('configuration', '仅能分析专用工作目录内的已暂存文件。');
      const project = record(parseJson(await this.tool('/get_project_info', {}, signal)));
      const health = record(parseJson(await this.request('/health', 'GET', undefined, signal)));
      if (project?.has_project !== false || health?.program_loaded !== false) {
        throw new GhidraBackendError('configuration', '需要没有打开项目或程序的独立 headless 后端。');
      }
      progress({ stage: 'importing', message: localized('将文件作为静态数据导入 Ghidra', 'Importing the file as static data') });
      const loaded = record(parseJson(await this.tool('/load_program', { file: input }, signal, this.analysisTimeoutMs)));
      program = short(loaded?.program);
      if (!program) throw new GhidraBackendError('engine', 'Ghidra 未返回导入后的程序标识。');
      progress({ stage: 'analyzing', message: localized('识别函数、字符串和导入符号', 'Identifying functions, strings and imports') });
      const analysis = record(parseJson(await this.tool('/run_analysis', { program }, signal, this.analysisTimeoutMs)));
      progress({ stage: 'reading', message: localized('读取静态分析证据', 'Reading static analysis evidence') });
      const maxFunctions = integer(options.maxFunctions, 12, 20);
      const maxStrings = integer(options.maxStrings, 100, 120);
      const reads = await Promise.allSettled([
        this.tool('/get_metadata', { program }, signal),
        this.tool('/list_functions_enhanced', { program, offset: 0, limit: 512 }, signal),
        this.tool('/list_imports', { program, offset: 0, limit: 80 }, signal),
        this.tool('/list_strings', { program, offset: 0, limit: maxStrings }, signal),
      ]);
      checkAbort(signal);
      const read = (index: number, labelZh: string, labelEn: string): string => {
        const result = reads[index];
        if (result?.status === 'fulfilled') return result.value;
        const error = result?.status === 'rejected' ? result.reason : new Error('未返回结果');
        if (error instanceof GhidraBackendError && ['cancelled', 'timeout', 'response_limit'].includes(error.code)) throw error;
        noteDiagnostic(error);
        limitations.push(localized(`未能读取${labelZh}。`, `${labelEn} could not be read.`));
        return '';
      };
      const metadata = read(0, '程序信息', 'Program information').slice(0, 4000);
      const functionData = record(parseJson(read(1, '函数列表', 'The function list')));
      const candidates = (Array.isArray(functionData?.functions) ? functionData.functions : [])
        .map(record).filter((item): item is Record<string, unknown> => !!item && item.isThunk !== true && item.isExternal !== true)
        .map((item) => ({ name: short(item.name, 128), address: short(item.address_full ?? item.address, 128), code: '' }))
        .filter((item) => item.name && item.address)
        .sort((a, b) => Number(/^(?:_?main|wmain|winmain|dllmain|entry|_start|start)$/i.test(b.name)) - Number(/^(?:_?main|wmain|winmain|dllmain|entry|_start|start)$/i.test(a.name)))
        .slice(0, maxFunctions);
      const importData = parseJson(read(2, '导入符号', 'Imported symbols'));
      const imports = (Array.isArray(importData) ? importData : []).map((item) => short(record(item)?.name, 128)).filter(Boolean).slice(0, 80);
      const strings = read(3, '字符串', 'Strings').split(/\r?\n/).filter((line) => /^\S+: \"/.test(line)).map((line) => line.slice(0, 240)).slice(0, maxStrings);
      const callEdges: GhidraEvidence['callEdges'] = [];
      let codeBudget = 32_000;
      for (let i = 0; i < candidates.length; i++) {
        checkAbort(signal);
        const candidate = candidates[i]!;
        progress({ stage: 'decompiling', message: localized(`反编译 ${candidate.name}`, `Decompiling ${candidate.name}`), completed: i, total: candidates.length });
        try {
          const code = await this.tool('/decompile_function', { program, address: candidate.address, timeout: 12 }, signal);
          candidate.code = code.slice(0, Math.min(4000, codeBudget));
          codeBudget -= candidate.code.length;
          if (candidate.code.length < code.length) limitations.push(localized(`${candidate.name} 的反编译内容已截断。`, `Decompiled text for ${candidate.name} was shortened.`));
        } catch (error) {
          if (signal.aborted || error instanceof GhidraBackendError && ['cancelled', 'timeout', 'response_limit'].includes(error.code)) throw error;
          noteDiagnostic(error);
          limitations.push(localized(`未能反编译 ${candidate.name}。`, `${candidate.name} could not be decompiled.`));
        }
        if (callEdges.length < 120) {
          try {
            const callees = await this.tool('/get_function_callees', { program, address: candidate.address, offset: 0, limit: Math.min(20, 120 - callEdges.length) }, signal);
            for (const line of callees.split(/\r?\n/)) {
              if (callEdges.length >= 120) break;
              const match = /^(.*?) @ (\S+)$/.exec(line);
              if (match) callEdges.push({ from: `${candidate.name}@${candidate.address}`, to: `${match[1]!.slice(0, 128)}@${match[2]!.slice(0, 128)}` });
            }
          } catch (error) {
            if (signal.aborted || error instanceof GhidraBackendError && ['cancelled', 'timeout', 'response_limit'].includes(error.code)) throw error;
            noteDiagnostic(error);
            limitations.push(localized('部分函数调用关系未能读取。', 'Some function calls could not be read.'));
          }
        }
      }
      const metaJson = record(parseJson(metadata));
      const architecture = short(metaJson?.language ?? /^Language:\s*(.+)$/m.exec(metadata)?.[1]
        ?? /^Architecture:\s*(.+)$/m.exec(metadata)?.[1] ?? loaded?.language, 128) || 'unknown';
      const functionCount = typeof analysis?.total_functions === 'number' ? analysis.total_functions
        : Number(/^Function Count:\s*(\d+)$/m.exec(metadata)?.[1] ?? candidates.length);
      if (functionCount > candidates.length) limitations.push(localized(`仅显示 ${candidates.length} 个函数；共识别 ${functionCount} 个函数。`,
        `Showing ${candidates.length} functions from ${functionCount} identified functions.`));
      if (!candidates.length) limitations.push(localized('未发现可反编译的函数，可能存在加壳、托管代码或不支持的格式。',
        'No functions could be decompiled. The file may be packed, contain managed code or use an unsupported format.'));
      limitations.push(localized('调用关系来自静态引用；间接调用和运行时行为可能无法确定。',
        'Static references may omit indirect calls and behavior that only appears while running.'));
      const evidence: GhidraEvidence = { format: await binaryFormat(input), architecture, functionCount,
        functions: candidates, imports, strings, callEdges, limitations: [...new Set(limitations)].slice(0, 12),
        program, metadata, backendVersion: GHIDRA_MCP_VERSION };
      checkAbort(signal);
      boundEvidence(evidence, localized('结果较长，已按大小限制截断部分内容。', 'Some content was shortened to keep the result within its size limit.'));
      progress({ stage: 'complete', message: localized('Ghidra 静态分析完成', 'Static analysis complete'), completed: candidates.length, total: candidates.length });
      return evidence;
    } catch (error) {
      if (this.config.mode === 'managed') await this.stop();
      if (signal.aborted) throw abortError(signal);
      throw error;
    } finally {
      timeout.clear();
      if (program && this.ready) {
        try { await this.tool('/close_program', { name: program }, new AbortController().signal, 5000); }
        catch { if (this.config.mode === 'managed') await this.stop(); }
      }
      this.analyzing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.lifecycle.abort(new GhidraBackendError('cancelled', '分析引擎已停止。'));
    this.ready = undefined;
    const stopping = (async () => {
      // Wait for the resource/launch phases, rather than the whole startup promise:
      // startup's error path itself awaits stop, so awaiting startup would deadlock.
      const preparing = this.preparing;
      const launching = this.launching;
      if (preparing) await preparing.catch(() => undefined);
      const owned = this.process ?? (launching ? await launching.catch(() => undefined) : undefined);
      if (owned) {
        await owned.stop();
        if (this.process === owned) this.process = undefined;
      }
      if (this.runtimeDirectory && this.root && inside(this.root, this.runtimeDirectory)) {
        await rm(this.runtimeDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        this.runtimeDirectory = undefined;
      }
    })();
    this.stopping = stopping;
    try { await stopping; } finally { if (this.stopping === stopping) this.stopping = undefined; }
  }
}

async function binaryFormat(path: string): Promise<string> {
  const file = await open(path, 'r');
  try {
    const data = Buffer.alloc(8);
    await file.read(data, 0, data.length, 0);
    if (data[0] === 0x4d && data[1] === 0x5a) return 'PE';
    if (data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'ELF';
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(data.readUInt32BE(0))) return 'Mach-O';
    return 'unknown';
  } finally { await file.close(); }
}

function boundEvidence(evidence: GhidraEvidence, truncatedMessage: string): void {
  let truncated = false;
  const oversized = () => Buffer.byteLength(JSON.stringify(evidence), 'utf8') > MAX_EVIDENCE_BYTES;
  while (oversized()) {
    truncated = true;
    if (evidence.callEdges.length) evidence.callEdges.pop();
    else if (evidence.strings.length) evidence.strings.pop();
    else if (evidence.imports.length) evidence.imports.pop();
    else {
      const functionWithCode = [...evidence.functions].reverse().find((item) => item.code.length > 0);
      if (functionWithCode) functionWithCode.code = functionWithCode.code.slice(0, Math.floor(functionWithCode.code.length / 2));
      else evidence.functions.pop();
    }
  }
  if (truncated) {
    evidence.limitations = [...evidence.limitations.slice(0, 10), truncatedMessage];
    while (oversized() && evidence.functions.length) evidence.functions.pop();
  }
}
