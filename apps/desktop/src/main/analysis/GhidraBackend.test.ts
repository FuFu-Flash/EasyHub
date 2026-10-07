import { createServer } from 'node:http';
import { copyFile, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GhidraBackend, ghidraHttpTransport, ghidraProcessRunner, validateGhidraUrl,
  type GhidraLaunchSpec, type GhidraRequest, type GhidraRunner, type GhidraTransport } from './GhidraBackend';

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });

const query = (name: string, required = false) => ({ name, source: 'query', required });
const body = (name: string, required = true) => ({ name, source: 'body', required });
// Fixture preserves the real v6 annotation schema: POST run_analysis has a QUERY
// program selector, whereas load_program and close_program have JSON BODY values.
const schema = { tools: [
  { path: '/load_program', method: 'POST', params: [body('file')] },
  { path: '/run_analysis', method: 'POST', params: [query('program')] },
  { path: '/close_program', method: 'POST', params: [body('name')] },
  { path: '/get_project_info', method: 'GET', params: [] },
  { path: '/get_metadata', method: 'GET', params: [query('program')] },
  { path: '/list_functions_enhanced', method: 'GET', params: [query('program'), query('offset'), query('limit')] },
  { path: '/list_imports', method: 'GET', params: [query('program'), query('offset'), query('limit')] },
  { path: '/list_strings', method: 'GET', params: [query('program'), query('offset'), query('limit')] },
  { path: '/decompile_function', method: 'GET', params: [query('program'), query('address', true), query('timeout')] },
  { path: '/get_function_callees', method: 'GET', params: [query('program'), query('address'), query('offset'), query('limit')] },
  { path: '/run_script_inline', method: 'POST', params: [body('script')] },
] };

async function workspace(): Promise<{ root: string; input: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'easyhub-ghidra-test-')));
  temporary.push(root);
  const input = join(root, 'input.bin');
  await writeFile(input, Buffer.from([0x4d, 0x5a, 0, 0, 0, 0, 0, 0]));
  return { root, input };
}

function fakeTransport(overrides: Record<string, string | ((request: GhidraRequest) => string | Promise<string>)> = {}) {
  const calls: GhidraRequest[] = [];
  const transport: GhidraTransport = async (request) => {
    calls.push(request);
    const path = new URL(request.url).pathname;
    const defaults: Record<string, string> = {
      '/get_version': JSON.stringify({ plugin_version: '6.0.0-headless', mode: 'headless' }),
      '/mcp/schema': JSON.stringify(schema),
      '/health': '{"status":"healthy","program_loaded":false}',
      '/get_project_info': '{"has_project":false}',
      '/load_program': '{"success":true,"program":"input.bin","language":"x86:LE:64:default"}',
      '/run_analysis': '{"success":true,"program":"input.bin","total_functions":20}',
      '/get_metadata': 'Program Name: input.bin\nArchitecture: x86\nFunction Count: 20\nAddress Size: 64 bits\n',
      '/list_functions_enhanced': JSON.stringify({ functions: [
        { name: 'thunk', address: '001000', isThunk: true, isExternal: false },
        { name: 'external', address: '001100', isExternal: true, isThunk: false },
        { name: 'FUN_001200', address: '001200', isExternal: false, isThunk: false },
        { name: 'main', address: '001300', isExternal: false, isThunk: false },
      ], count: 4 }),
      '/list_imports': '[{"name":"CreateFileW","address":"EXTERNAL:000001"}]',
      '/list_strings': '001400: "hello world"\n001500: "https://example.test/"',
      '/decompile_function': 'int main(void) { return 42; }',
      '/get_function_callees': 'helper @ 001600',
      '/close_program': '{"success":true,"closed_count":1}',
    };
    const response = overrides[path] ?? defaults[path];
    if (response === undefined) throw new Error(`Unexpected endpoint ${path}`);
    return { status: 200, text: typeof response === 'function' ? await response(request) : response };
  };
  return { transport, calls };
}

async function managedWorkspace() {
  const { root, input } = await workspace();
  const javaPath = join(root, 'runtime', 'jdk');
  const ghidraHome = join(root, 'runtime', 'ghidra');
  const pluginJar = join(root, 'runtime', 'extension');
  const files: Record<string, string> = {
    [join(javaPath, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')]: '',
    [join(ghidraHome, 'Ghidra', 'application.properties')]: 'application.name=Ghidra\napplication.version=12.1.2\n',
    [join(ghidraHome, 'Ghidra', 'Framework', 'Utility', 'lib', 'Utility.jar')]: '',
    [join(ghidraHome, 'Ghidra', 'Features', 'Base', 'lib', 'Base.jar')]: '',
    [join(pluginJar, 'lib', 'GhidraMCP-6.0.0.jar')]: '',
  };
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); }
  await mkdir(join(ghidraHome, 'Ghidra', 'Processors'), { recursive: true });
  let launch: GhidraLaunchSpec | undefined;
  let resolveExit: (value: { code: number | null }) => void = () => {};
  const exited = new Promise<{ code: number | null }>((resolve) => { resolveExit = resolve; });
  const stop = vi.fn(async () => { resolveExit({ code: 0 }); });
  const runner: GhidraRunner = { start: vi.fn(async (spec) => { launch = spec; return { pid: 4321, exited, stop }; }) };
  return { root, input, config: { mode: 'managed' as const, javaPath, ghidraHome, pluginJar, workspaceRoot: root },
    runner, stop, getLaunch: () => launch, exit: resolveExit };
}

describe('GhidraBackend', () => {
  it('pins localhost and rejects remote addresses, redirect origins, credentials and paths', () => {
    expect(validateGhidraUrl('http://localhost:8089')).toBe('http://127.0.0.1:8089');
    expect(validateGhidraUrl('http://[::1]:8089/')).toBe('http://[::1]:8089');
    for (const url of ['https://127.0.0.1:8089', 'http://0.0.0.0:8089', 'http://127.0.0.2:8089',
      'http://example.test', 'http://user:pass@localhost:8089', 'http://localhost:8089/mcp', 'http://localhost:8089/?x=1']) {
      expect(() => validateGhidraUrl(url)).toThrow();
    }
  });

  it('performs static import and schema-aware requests, prioritizes main and closes only its program', async () => {
    const { root, input } = await workspace();
    const mock = fakeTransport();
    const backend = new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: root }, mock);
    const ready = await backend.start();
    expect(ready).toMatchObject({ status: 'ready', version: '6.0.0-headless', mode: 'attached', endpoint: 'http://127.0.0.1:8089' });
    expect(ready.capabilities).not.toContain('run_script_inline');
    const result = await backend.analyze(input, { maxFunctions: 1 });
    expect(result).toMatchObject({ format: 'PE', architecture: 'x86', functionCount: 20,
      functions: [{ name: 'main', address: '001300', code: 'int main(void) { return 42; }' }], imports: ['CreateFileW'],
      callEdges: [{ from: 'main@001300', to: 'helper@001600' }] });
    const loaded = mock.calls.find((call) => new URL(call.url).pathname === '/load_program')!;
    expect(loaded.method).toBe('POST');
    expect(JSON.parse(loaded.body!)).toEqual({ file: input });
    const analyzed = mock.calls.find((call) => new URL(call.url).pathname === '/run_analysis')!;
    expect(new URL(analyzed.url).searchParams.get('program')).toBe('input.bin');
    expect(JSON.parse(analyzed.body!)).toEqual({});
    const closed = mock.calls.find((call) => new URL(call.url).pathname === '/close_program')!;
    expect(JSON.parse(closed.body!)).toEqual({ name: 'input.bin' });
    expect(mock.calls.every((call) => new URL(call.url).hostname === '127.0.0.1')).toBe(true);
    await backend.stop();
  });

  it('rejects a mismatched version or malformed schema before importing', async () => {
    const { root } = await workspace();
    const versions = fakeTransport({ '/get_version': '{"plugin_version":"7.0.0-rc.1","mode":"headless"}' });
    await expect(new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: root }, versions).start())
      .rejects.toMatchObject({ code: 'incompatible' });
    const wrongMethod = structuredClone(schema);
    wrongMethod.tools[0]!.method = 'GET';
    const malformed = fakeTransport({ '/mcp/schema': JSON.stringify(wrongMethod) });
    await expect(new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: root }, malformed).start())
      .rejects.toMatchObject({ code: 'incompatible' });
  });

  it('refuses external files and existing external projects without closing their programs', async () => {
    const { root } = await workspace();
    const external = await workspace();
    const mock = fakeTransport();
    const backend = new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: root }, mock);
    await expect(backend.analyze(external.input)).rejects.toMatchObject({ code: 'configuration' });
    expect(mock.calls.some((call) => new URL(call.url).pathname === '/load_program')).toBe(false);
    const occupied = fakeTransport({ '/get_project_info': '{"has_project":true}' });
    const dedicated = new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: external.root }, occupied);
    await expect(dedicated.analyze(external.input)).rejects.toMatchObject({ code: 'configuration' });
    expect(occupied.calls.some((call) => ['/load_program', '/close_program'].includes(new URL(call.url).pathname))).toBe(false);
    await backend.stop();
    await dedicated.stop();
  });

  it('builds a direct Java argfile with isolated settings and restricted engine environment', async () => {
    const setup = await managedWorkspace();
    const mock = fakeTransport();
    const backend = new GhidraBackend(setup.config, { ...mock, runner: setup.runner });
    try {
      expect(await backend.start()).toMatchObject({ status: 'ready', pid: 4321 });
      const spec = setup.getLaunch()!;
      expect(spec.executable).toMatch(/bin[\\/]java(?:\.exe)?$/);
      expect(spec.args).toHaveLength(1);
      expect(spec.args[0]).toMatch(/^@/);
      const argumentsText = await readFile(spec.args[0]!.slice(1), 'utf8');
      expect(argumentsText).toContain('com.xebyte.headless.GhidraMCPHeadlessServer');
      expect(argumentsText).toContain('-Dapplication.settingsdir=');
      expect(argumentsText).toContain('GhidraMCP-6.0.0.jar');
      expect(argumentsText).not.toContain('launch.bat');
      expect(spec.env).toMatchObject({ GHIDRA_MCP_ALLOW_SCRIPTS: 'false', GHIDRA_MCP_BIND_ADDRESS: '127.0.0.1', GHIDRA_MCP_FILE_ROOT: setup.root });
      expect(spec.env.GHIDRA_MCP_AUTH_TOKEN).toMatch(/^[a-f0-9-]{36}$/);
      expect(spec.env.JAVA_TOOL_OPTIONS).toBeUndefined();
      expect(spec.env._JAVA_OPTIONS).toBeUndefined();
    } finally { await backend.stop(); }
    expect(setup.stop).toHaveBeenCalledTimes(1);
    await expect(stat(setup.getLaunch()!.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels analysis and stops the managed process tree even if transport never resolves', async () => {
    const setup = await managedWorkspace();
    let enterAnalysis = () => {};
    const entered = new Promise<void>((resolve) => { enterAnalysis = resolve; });
    const mock = fakeTransport({ '/run_analysis': () => { enterAnalysis(); return new Promise<string>(() => {}); } });
    const backend = new GhidraBackend(setup.config, { ...mock, runner: setup.runner });
    const controller = new AbortController();
    const result = backend.analyze(setup.input, { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    await entered;
    controller.abort();
    await rejected;
    expect(setup.stop).toHaveBeenCalledTimes(1);
    await expect(stat(setup.getLaunch()!.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports timeout separately from cancellation and cleans up its engine', async () => {
    const setup = await managedWorkspace();
    const mock = fakeTransport({ '/run_analysis': () => new Promise<string>(() => {}) });
    const backend = new GhidraBackend(setup.config, { ...mock, runner: setup.runner, analysisTimeoutMs: 200 });
    await expect(backend.analyze(setup.input)).rejects.toMatchObject({ code: 'timeout' });
    expect(setup.stop).toHaveBeenCalledTimes(1);
  });

  it('responds to cancellation while awaiting another caller\'s startup', async () => {
    const setup = await managedWorkspace();
    let enteredStartup = () => {};
    const entered = new Promise<void>((resolve) => { enteredStartup = resolve; });
    const mock = fakeTransport({ '/get_version': () => { enteredStartup(); return new Promise<string>(() => {}); } });
    const backend = new GhidraBackend(setup.config, { ...mock, runner: setup.runner });
    const first = backend.start().catch((error: unknown) => error);
    await entered;
    const controller = new AbortController();
    const analyze = backend.analyze(setup.input, { signal: controller.signal });
    const cancelled = expect(analyze).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await cancelled;
    expect(await first).toMatchObject({ code: 'cancelled' });
    expect(setup.stop).toHaveBeenCalledTimes(1);
  });

  it('waits for an in-flight process launch before stop resolves', async () => {
    const setup = await managedWorkspace();
    let enteredLaunch = () => {};
    const entered = new Promise<void>((resolve) => { enteredLaunch = resolve; });
    let finishLaunch = () => {};
    const stopped = vi.fn(async () => {});
    const runner: GhidraRunner = { start: () => { enteredLaunch(); return new Promise((resolve) => {
      finishLaunch = () => resolve({ pid: 4321, exited: new Promise(() => {}), stop: stopped });
    }); } };
    const backend = new GhidraBackend(setup.config, { ...fakeTransport(), runner });
    const startup = backend.start().catch((error: unknown) => error);
    await entered;
    let stopResolved = false;
    const stopping = backend.stop().then(() => { stopResolved = true; });
    await Promise.resolve();
    expect(stopResolved).toBe(false);
    expect(stopped).not.toHaveBeenCalled();
    finishLaunch();
    await stopping;
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(await startup).toMatchObject({ code: 'cancelled' });
  });

  it('keeps all evidence under 64 KiB including non-ASCII code and reports sampling', async () => {
    const { root, input } = await workspace();
    const functions = Array.from({ length: 20 }, (_, i) => ({ name: `FUN_${i}`, address: `001${i.toString(16).padStart(3, '0')}`, isThunk: false }));
    const mock = fakeTransport({
      '/list_functions_enhanced': JSON.stringify({ functions }),
      '/decompile_function': '注'.repeat(6000),
      '/list_strings': Array.from({ length: 120 }, (_, i) => `00${i}: "${'字'.repeat(240)}"`).join('\n'),
    });
    const backend = new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: root }, mock);
    const result = await backend.analyze(input, { maxFunctions: 20, maxStrings: 120 });
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(65_536);
    expect(result.functions.every((item) => item.code.length <= 4000)).toBe(true);
    expect(result.limitations.some((message) => message.includes('截断'))).toBe(true);
    await backend.stop();
  });

  it('rejects an oversized injected response before parsing it', async () => {
    const { root } = await workspace();
    const mock = fakeTransport({ '/mcp/schema': ' '.repeat(2_097_153) });
    await expect(new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: root }, mock).start())
      .rejects.toMatchObject({ code: 'response_limit' });
  });

  it('localizes limitations and keeps internal tool errors out of evidence', async () => {
    const { root, input } = await workspace();
    const mock = fakeTransport({
      '/get_metadata': '{"error":"internal /get_metadata failed at C:\\\\private\\\\sample.bin"}',
      '/decompile_function': '{"error":"internal /decompile_function failed at C:\\\\private\\\\sample.bin"}',
      '/get_function_callees': '{"error":"internal /get_function_callees failure"}',
    });
    const backend = new GhidraBackend({ mode: 'attached', baseUrl: 'http://localhost:8089', workspaceRoot: root }, mock);
    const evidence = await backend.analyze(input, { language: 'en', maxFunctions: 1 });
    expect(evidence.limitations).toContain('Program information could not be read.');
    expect(evidence.limitations).toContain('main could not be decompiled.');
    expect(evidence.limitations.join('\n')).not.toMatch(/internal|private|\/get_metadata|\/decompile_function|[\u3400-\u9fff]/);
    await backend.stop();
  });

  it('limits streamed HTTP bytes and does not follow redirects', async () => {
    const server = createServer((req, res) => {
      if (req.url === '/redirect') { res.writeHead(302, { Location: 'https://example.test' }); res.end(); }
      else { res.writeHead(200); res.write('12345'); res.end('67890'); }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const request = { method: 'GET' as const, headers: {}, signal: new AbortController().signal, maxResponseBytes: 8 };
    try {
      const redirect = await ghidraHttpTransport({ ...request, url: `http://127.0.0.1:${address.port}/redirect` });
      expect(redirect.status).toBe(302);
      await expect(ghidraHttpTransport({ ...request, url: `http://127.0.0.1:${address.port}/bytes` })).rejects.toMatchObject({ code: 'response_limit' });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });

  it('stops its real process tree including a native helper child', async () => {
    const { root } = await workspace();
    let childPid = 0;
    let childStarted = () => {};
    const started = new Promise<void>((resolve) => { childStarted = resolve; });
    const script = "const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(child.pid);setInterval(()=>{},1000);";
    const owned = await ghidraProcessRunner.start({ executable: process.execPath, args: ['-e', script], cwd: root, env: process.env,
      onOutput: (text) => { const pid = Number(text.trim()); if (pid > 0) { childPid = pid; childStarted(); } } });
    try {
      await Promise.race([started, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Child startup timeout')), 3000).unref())]);
      expect(childPid).toBeGreaterThan(0);
      expect(() => process.kill(childPid, 0)).not.toThrow();
      await owned.stop();
      expect(() => process.kill(childPid, 0)).toThrow();
      expect(() => process.kill(owned.pid!, 0)).toThrow();
    } finally { await owned.stop(); }
  });

  it.skipIf(!process.env.EASYHUB_GHIDRA_RUNTIME_TEST_ROOT || process.platform !== 'win32')('imports and decompiles a real PE using the installed pinned headless engine', async () => {
    const installed = process.env.EASYHUB_GHIDRA_RUNTIME_TEST_ROOT!;
    const { root, input } = await workspace();
    // The sample is copied as data. It is never launched by this test or adapter.
    await copyFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe'), input);
    let logs = '';
    const runner: GhidraRunner = { start: (spec) => ghidraProcessRunner.start({ ...spec,
      onOutput: (text) => { logs = (logs + text).slice(-12_000); spec.onOutput(text); } }) };
    const backend = new GhidraBackend({ mode: 'managed', javaPath: join(installed, 'java'), ghidraHome: join(installed, 'ghidra'),
      pluginJar: join(installed, 'extension'), workspaceRoot: root }, { runner });
    try {
      const startedAt = Date.now();
      const ready = await backend.start();
      const startupMs = Date.now() - startedAt;
      expect(ready.version).toBe('6.0.0-headless');
      const analyzeAt = Date.now();
      const evidence = await backend.analyze(input, { maxFunctions: 2, maxStrings: 8 });
      expect(evidence.format).toBe('PE');
      expect(evidence.functionCount).toBeGreaterThan(0);
      expect(evidence.functions.some((item) => item.code.length > 10)).toBe(true);
      expect(evidence.imports.length).toBeGreaterThan(0);
      expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(65_536);
      console.info('Pinned Ghidra smoke:', JSON.stringify({ installed, startupMs, analysisMs: Date.now() - analyzeAt,
        functionCount: evidence.functionCount, decompiledFunctions: evidence.functions.filter((item) => item.code.length > 10).length,
        sampledImports: evidence.imports.length, sampledStrings: evidence.strings.length, architecture: evidence.architecture }));
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nEngine test log:\n${logs}`);
    } finally { await backend.stop(); }
  }, 180_000);
});
