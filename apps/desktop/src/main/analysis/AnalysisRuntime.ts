import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { extractRuntimeArchive } from './analysisArchive';
import { GHIDRA_MCP_LICENSE } from './analysisLicenses';
import {
  downloadVerifiedArchive, LEGACY_RUNTIME_ARTIFACTS, MAC_LEGACY_RUNTIME_ARTIFACTS, MAC_RUNTIME_ARTIFACTS, RUNTIME_ARTIFACTS, runtimeArtifacts, throwIfAborted, verifyReleaseMetadata,
  type RuntimeArtifact, type RuntimeFetch,
} from './analysisDownloads';

export interface RuntimePaths { ghidraPath: string; javaPath: string; extensionPath: string }
export interface RuntimeProgress {
  stage: 'checking' | 'downloading' | 'extracting' | 'activating';
  component: RuntimeArtifact['id'];
  downloadedBytes: number;
  totalBytes: number;
  message: string;
}
export interface RuntimeStatus {
  state: 'missing' | 'installing' | 'ready' | 'error';
  paths?: RuntimePaths;
  progress?: RuntimeProgress;
  error?: string;
  downloadBytes?: number;
}
export interface RuntimeInstallOptions { signal?: AbortSignal; onProgress?: (progress: RuntimeProgress) => void }
interface RuntimeDependencies {
  fetch?: RuntimeFetch;
  platform?: NodeJS.Platform;
  arch?: string;
  extractArchive?: typeof extractRuntimeArchive;
  downloadArchive?: typeof downloadVerifiedArchive;
}
export const INSTALLATION_NAME = 'ghidra-12.1.2-mcp-6.0.0-java-21.0.12.1-slim-r1';
export const MAC_INSTALLATION_NAME = 'ghidra-12.1.2-mcp-6.0.0-java-21.0.12.1-mac-arm64-slim-r1';
export const MAC_LEGACY_INSTALLATION_NAME = 'ghidra-12.1.2-mcp-6.0.0-java-21.0.12.1-mac-arm64-r1';
export const LEGACY_INSTALLATION_NAME = 'ghidra-12.1.2-mcp-6.0.0-java-21.0.12.1';
const MANIFEST = { schema: 1, installation: INSTALLATION_NAME,
  artifacts: RUNTIME_ARTIFACTS.map(({ id, sha256 }) => ({ id, sha256 })) };
const LEGACY_MANIFEST = { schema: 1, installation: LEGACY_INSTALLATION_NAME,
  artifacts: LEGACY_RUNTIME_ARTIFACTS.map(({ id, sha256 }) => ({ id, sha256 })) };
const MAC_MANIFEST = { schema: 1, installation: MAC_INSTALLATION_NAME,
  artifacts: MAC_RUNTIME_ARTIFACTS.map(({ id, sha256 }) => ({ id, sha256 })) };
const MAC_LEGACY_MANIFEST = { schema: 1, installation: MAC_LEGACY_INSTALLATION_NAME,
  artifacts: MAC_LEGACY_RUNTIME_ARTIFACTS.map(({ id, sha256 }) => ({ id, sha256 })) };
const activeRoots = new Set<string>();

/** Optional local analysis components. Only the main process supplies userDataPath. */
export class AnalysisRuntime {
  private readonly root: string;
  private readonly target: string;
  private readonly artifacts: readonly RuntimeArtifact[];
  private readonly manifest: typeof MANIFEST;
  private readonly downloadBytes: number;
  private readonly deps: Required<RuntimeDependencies>;
  private progress?: RuntimeProgress;
  private error?: string;
  private installing = false;

  constructor(private readonly userDataPath: string, dependencies: RuntimeDependencies = {}) {
    if (!isAbsolute(userDataPath)) throw new Error('分析组件必须使用主进程的绝对用户数据目录');
    this.root = join(resolve(userDataPath), 'analysis-runtime');
    this.deps = { fetch: dependencies.fetch ?? globalThis.fetch,
      platform: dependencies.platform ?? process.platform, arch: dependencies.arch ?? process.arch,
      extractArchive: dependencies.extractArchive ?? extractRuntimeArchive,
      downloadArchive: dependencies.downloadArchive ?? downloadVerifiedArchive };
    const mac = this.deps.platform === 'darwin';
    this.artifacts = mac ? MAC_RUNTIME_ARTIFACTS : RUNTIME_ARTIFACTS;
    this.manifest = mac ? MAC_MANIFEST : MANIFEST;
    this.downloadBytes = this.artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
    this.target = join(this.root, this.manifest.installation);
  }

  async status(): Promise<RuntimeStatus> {
    if (this.installing) return { state: 'installing', progress: this.progress, downloadBytes: this.downloadBytes };
    const paths = await this.readInstalled();
    if (paths) return { state: 'ready', paths, downloadBytes: 0 };
    return this.error ? { state: 'error', error: this.error, downloadBytes: this.downloadBytes }
      : { state: 'missing', downloadBytes: this.downloadBytes };
  }

  async install(options: RuntimeInstallOptions = {}): Promise<RuntimePaths> {
    throwIfAborted(options.signal);
    runtimeArtifacts(this.deps.platform, this.deps.arch);
    if (activeRoots.has(this.root.toLowerCase())) throw new Error('分析组件安装正在进行');
    const existing = await this.readInstalled();
    if (existing) return existing;
    if (activeRoots.has(this.root.toLowerCase())) throw new Error('分析组件安装正在进行');
    activeRoots.add(this.root.toLowerCase());
    this.installing = true;
    this.error = undefined;
    let temporary: string | undefined;
    let downloadedBytes = 0;
    let lastReportedAt = 0;
    let lastReportedStage = '';
    const report = (stage: RuntimeProgress['stage'], component: RuntimeArtifact['id'], message: string, bytes = downloadedBytes) => {
      this.progress = { stage, component, downloadedBytes: bytes, totalBytes: this.downloadBytes, message };
      const currentStage = `${component}:${stage}`;
      const now = Date.now();
      if (stage === 'downloading' && lastReportedStage === currentStage && now - lastReportedAt < 75) return;
      lastReportedStage = currentStage;
      lastReportedAt = now;
      try { options.onProgress?.({ ...this.progress }); } catch { /* a renderer subscription cannot stop the install */ }
    };
    try {
      await this.ensureRoot();
      // Existing unrecognized content is preserved; only our newly created temporary directory is ever removed.
      if (await this.exists(this.target)) throw new Error('分析组件目录已有不完整内容，请检查后重试');
      temporary = await mkdtemp(join(this.root, '.install-'));
      const prepared = join(temporary, 'prepared');
      await mkdir(prepared);
      for (const artifact of this.artifacts) {
        throwIfAborted(options.signal);
        report('checking', artifact.id, `核对组件发布：${artifact.id}`);
        await verifyReleaseMetadata(artifact, this.deps.fetch, options.signal);
        const archive = join(temporary, artifact.name);
        report('downloading', artifact.id, `下载分析组件：${artifact.id}`);
        await this.deps.downloadArchive(artifact, archive, this.deps.fetch, options.signal,
          bytes => report('downloading', artifact.id, `下载分析组件：${artifact.id}`, downloadedBytes + bytes));
        downloadedBytes += artifact.size;
        throwIfAborted(options.signal);
        const extracted = join(temporary, `unpacked-${artifact.id}`);
        report('extracting', artifact.id, `校验并解压分析组件：${artifact.id}`);
        await this.deps.extractArchive(archive, extracted, artifact.unpackedLimit, options.signal);
        const source = join(extracted, artifact.directory);
        const info = await lstat(source);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`组件目录结构不符合固定版本：${artifact.id}`);
        await rename(source, join(prepared, artifact.id));
      }
      // The upstream extension ZIP omits its project-specific Apache license and attribution.
      await writeFile(join(prepared, 'extension', 'LICENSE'), GHIDRA_MCP_LICENSE, { flag: 'wx' });
      await this.validatePaths(prepared);
      await writeFile(join(prepared, 'installation.json'), JSON.stringify(this.manifest), { flag: 'wx' });
      throwIfAborted(options.signal);
      report('activating', 'extension', '激活分析组件');
      // Same-volume rename publishes the complete installation in one operation.
      await rename(prepared, this.target);
      return this.paths(await realpath(this.target));
    } catch (error) {
      this.error = error instanceof Error ? error.message : '分析组件安装失败';
      throw error;
    } finally {
      this.installing = false;
      this.progress = undefined;
      activeRoots.delete(this.root.toLowerCase());
      if (temporary) {
        const validated = resolve(temporary);
        if (validated.startsWith(resolve(this.root) + sep) && validated !== this.root && validated.includes(`${sep}.install-`)) {
          await rm(validated, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
  }

  private paths(directory: string): RuntimePaths {
    return { ghidraPath: join(directory, 'ghidra'),
      javaPath: this.deps.platform === 'darwin' ? join(directory, 'java', 'Contents', 'Home') : join(directory, 'java'),
      extensionPath: join(directory, 'extension') };
  }

  private async exists(path: string): Promise<boolean> {
    try { await lstat(path); return true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true });
    const base = await realpath(this.userDataPath);
    await mkdir(this.root, { recursive: true });
    const info = await lstat(this.root);
    if (info.isSymbolicLink() || !info.isDirectory()
      || (await realpath(this.root)).toLowerCase() !== join(base, 'analysis-runtime').toLowerCase()) {
      throw new Error('分析组件安装目录不是受控用户数据目录');
    }
  }

  private async readInstalled(): Promise<RuntimePaths | undefined> {
    const slim = await this.readInstallation(this.target, this.manifest);
    if (slim) return slim;
    if (this.deps.platform === 'darwin' && this.deps.arch === 'arm64') {
      return this.readInstallation(join(this.root, MAC_LEGACY_INSTALLATION_NAME), MAC_LEGACY_MANIFEST);
    }
    return this.deps.platform === 'win32' ? this.readInstallation(join(this.root, LEGACY_INSTALLATION_NAME), LEGACY_MANIFEST) : undefined;
  }

  private async readInstallation(target: string, expected: typeof MANIFEST): Promise<RuntimePaths | undefined> {
    try {
      const rootInfo = await lstat(this.root);
      const targetInfo = await lstat(target);
      if (rootInfo.isSymbolicLink() || targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) return undefined;
      const manifest = await readFile(join(target, 'installation.json'), 'utf8');
      if (manifest.length > 4096 || JSON.stringify(JSON.parse(manifest)) !== JSON.stringify(expected)) return undefined;
      await this.validatePaths(target);
      return this.paths(await realpath(target));
    } catch { return undefined; }
  }

  private async validatePaths(directory: string): Promise<void> {
    const paths = this.paths(directory);
    const files = [join(paths.javaPath, 'bin', this.deps.platform === 'darwin' ? 'java' : 'java.exe'),
      join(paths.ghidraPath, 'support', this.deps.platform === 'darwin' ? 'analyzeHeadless' : 'analyzeHeadless.bat'),
      join(paths.extensionPath, 'lib', 'GhidraMCP-6.0.0.jar')];
    if (this.deps.platform === 'darwin') files.push(join(paths.ghidraPath, 'Ghidra', 'Features', 'Decompiler', 'os', 'mac_arm_64', 'decompile'));
    const base = await realpath(directory);
    for (const file of [...Object.values(paths), ...files]) {
      const info = await lstat(file);
      if (info.isSymbolicLink() || !(await realpath(file)).toLowerCase().startsWith((base + sep).toLowerCase())) {
        throw new Error('分析组件包含不安全的本地路径');
      }
      if (files.includes(file) && !info.isFile()) throw new Error('分析组件缺少运行文件');
    }
    const properties = await readFile(join(paths.ghidraPath, 'Ghidra', 'application.properties'), 'utf8');
    const release = await readFile(join(paths.javaPath, 'release'), 'utf8');
    const extension = await readFile(join(paths.extensionPath, 'extension.properties'), 'utf8');
    if (!/^application\.version=12\.1\.2\s*$/m.test(properties)) throw new Error('Ghidra 组件版本与固定 12.1.2 不一致');
    if (!/^JAVA_VERSION="21\.0\.12\.1"\s*$/m.test(release)) throw new Error('Java 组件版本与固定 Temurin 21.0.12.1 不一致');
    // Ghidra's extension.properties version is the compatible Ghidra version, not the plugin version.
    // Plugin 6.0.0 is pinned by its verified archive and the required JAR filename above.
    if (!/^version=12\.1\.2\s*$/m.test(extension) || !/^name=GhidraMCP\s*$/m.test(extension)) {
      throw new Error('GhidraMCP 扩展兼容版本与固定 Ghidra 12.1.2 不一致');
    }
  }
}
