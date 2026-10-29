import { encodeAppError } from '../shared/errors';
import { RendererErrorLog } from './services/RendererErrorLog';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { isAbsolute, join } from 'node:path';
import { authStatus, cancelArchive, cancelDeviceLogin, cancelGithubReads, downloadArchive, downloadReleaseAsset, downloadPullRequestFile, getPullRequestReviewContext, githubAction, loadBinaryAnalysisFile, loadCommitExplanation, logout, openDownloadedFile, pollDeviceLogin, revealDownloadedArchive, startDeviceLogin } from './services/githubService';
import { AsyncEntry } from '@napi-rs/keyring';
import { AiReviewService, type AiCredentialStore } from './services/AiReviewService';
import { HostsRepairService } from './services/hostsRepair';
import { GitHubProxyService, useGitHubProxy } from './services/GitHubProxyService';
import { WindowsSystemProxy } from './platforms/windows/WindowsSystemProxy';
import { MacSystemProxy } from './platforms/macos/MacSystemProxy';
import { LinuxSystemProxy } from './platforms/linux/LinuxSystemProxy';
import { GitHubSystemRelay } from './services/GitHubSystemRelay';
import { GITHUB_CLIENT_ID } from './services/githubAuthConfig';
import { OpenAiReviewProvider } from './services/OpenAiReviewProvider';
import type { DownloadTransferProgress } from './services/githubService';
import { LocalProjectStore } from './git/LocalProjectStore';
import { LocalProjectService } from './git/LocalProjectService';
import { DiscoveryRootsStore } from './git/LocalProjectDiscovery';
import { ReleasePublishingService } from './services/releasePublishing';
import { FallbackTranslationProvider, GoogleWebTranslationProvider, MyMemoryTranslationProvider, TranslationService } from './services/TranslationService';
import type { TranslationRequest } from '@easyhub/types';
import { canRunMenuCommand, isMenuState, type MenuCommand, type MenuState } from '../shared/applicationMenu';
import { createApplicationMenuTemplate, nativeMenuText } from './platforms/macos/applicationMenu';
import { AnalysisRuntime } from './analysis/AnalysisRuntime';
import { analysisElectronFetch } from './analysis/analysisElectronFetch';
import { BinaryAnalysisService } from './analysis/BinaryAnalysisService';
import { GhidraBackend } from './analysis/GhidraBackend';
import { GitHubDownloads } from './services/githubDownloads';

let mainWindow: BrowserWindow | null = null;
let rendererErrorLog: RendererErrorLog | null = null;
let windowToolbarDensity: 'comfortable' | 'compact' = 'comfortable';
let windowControlStyle: 'reference' | 'windows' = process.platform === 'darwin' ? 'reference' : 'windows';
let localService: LocalProjectService;
let translationService: TranslationService;
let releaseService: ReleasePublishingService;
let aiReviewService: AiReviewService;
let hostsRepairService: HostsRepairService | undefined;
let githubProxyService: GitHubProxyService;
let binaryAnalysisService: BinaryAnalysisService;
let quitting = false;
let servicesStoppedForQuit = false;
let pairingCode: { value: string; expiresAt: number } | null = null;
let pairingRequest = 0;
let menuState: MenuState = { language: 'zh', signedIn: false, busy: false, modalOpen: false, demoOnly: false };
let rendererMenuReady = false;
let pendingMenuCommand: MenuCommand | null = null;
let downloadsService: GitHubDownloads;
const translationJobs = new Map<string, AbortController>();

app.setName('EasyHub');
if (process.env.EASYHUB_TEST_MODE === '1' && process.env.EASYHUB_TEST_USER_DATA && (isAbsolute(process.env.EASYHUB_TEST_USER_DATA) || process.env.EASYHUB_TEST_USER_DATA.startsWith('/'))) {
  app.setPath('userData', process.env.EASYHUB_TEST_USER_DATA);
}

// The profile owns its system-proxy lease; a second process must not recover it.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);
if (primaryInstance) app.on('second-instance', () => showMainWindow());

function aiCredentialStore(): AiCredentialStore {
  if (process.env.EASYHUB_TEST_MODE !== '1') return new AsyncEntry('EasyHub AI API', 'default');
  // UI fixtures must never read or modify the user's AI Keychain entry.
  let value: string | null = null;
  return { getPassword: async () => value, setPassword: async (next) => { value = next; } };
}

function copyPairingCode(value: unknown): boolean {
  if (typeof value !== 'string' || !pairingCode || value !== pairingCode.value || pairingCode.expiresAt <= Date.now()) return false;
  try { clipboard.writeText(value); return true; } catch { return false; }
}

async function loginWithCopiedCode(includeDeleteScope = false, deletionTarget?: { owner: string; repo: string; id: number }): Promise<Awaited<ReturnType<typeof startDeviceLogin>> & { codeCopied: boolean }> {
  const request = ++pairingRequest;
  pairingCode = null;
  const flow = await startDeviceLogin(GITHUB_CLIENT_ID, includeDeleteScope, deletionTarget);
  if (request !== pairingRequest || quitting) return { ...flow, codeCopied: false };
  pairingCode = { value: flow.userCode, expiresAt: flow.expiresAt };
  // The renderer opens the browser only after this response, so copying happens first.
  return { ...flow, codeCopied: copyPairingCode(flow.userCode) };
}

function requireWindowsHosts(): HostsRepairService {
  if (!hostsRepairService) throw new Error('Hosts 修复仅适用于 Windows；请使用 Mac GitHub 代理。');
  return hostsRepairService;
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('操作来源无效');
  }
}

function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try { return await listener(event, ...args); } catch (error) { throw new Error(encodeAppError(error)); }
  });
}

function rebuildApplicationMenu(): void {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(menuState, rendererMenuReady, {
    command: dispatchMenuCommand,
    showWindow: showMainWindow,
    openExternal: (url) => {
      void shell.openExternal(url).catch(() => {
        dialog.showErrorBox(nativeMenuText(menuState.language, 'nativeMenu.browserFailureTitle'),
          nativeMenuText(menuState.language, 'nativeMenu.browserFailureMessage'));
      });
    },
  })));
}

function resetRendererMenuState(): void {
  rendererMenuReady = false;
  menuState = { ...menuState, signedIn: false, busy: false, modalOpen: false };
  rebuildApplicationMenu();
}

function showMainWindow(): void {
  if (quitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow!.isMinimized()) mainWindow!.restore();
  mainWindow!.show();
  mainWindow!.focus();
}

function dispatchMenuCommand(command: MenuCommand): void {
  if (process.platform !== 'darwin' || quitting || !canRunMenuCommand(command, menuState)) return;
  if (!rendererMenuReady) {
    // Settings can reopen a closed window; only the latest request is retained.
    if (command !== 'settings' && command !== 'proxy-settings') return;
    pendingMenuCommand = command;
    showMainWindow();
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showMainWindow();
  mainWindow.webContents.send('easyhub:menu-command', command);
}

function flushPendingMenuCommand(): void {
  if (!pendingMenuCommand || !rendererMenuReady || !canRunMenuCommand(pendingMenuCommand, menuState)) return;
  const command = pendingMenuCommand;
  pendingMenuCommand = null;
  dispatchMenuCommand(command);
}

function windowIconPath(): string {
  const file = process.platform === 'win32' ? 'easyhub.ico' : 'easyhub.png';
  return app.isPackaged ? join(process.resourcesPath, file) : join(__dirname, '../../resources', file);
}

function createWindow(): void {
  resetRendererMenuState();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hidden' as const,
      trafficLightPosition: windowToolbarDensity === 'compact' ? { x: 16, y: 17 } : { x: 20, y: 19 },
    } : {}),
    roundedCorners: true,
    thickFrame: true,
    show: false,
    backgroundColor: '#f5f7fb',
    title: 'EasyHub',
    icon: windowIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const window = mainWindow;

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(windowControlStyle === 'reference');
  }

  window.once('ready-to-show', () => { if (mainWindow === window && !window.isDestroyed()) window.show(); });
  window.on('closed', () => {
    if (mainWindow !== window) return;
    mainWindow = null;
    pendingMenuCommand = null;
    resetRendererMenuState();
  });
  window.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (mainWindow === window && isMainFrame && !inPlace) resetRendererMenuState();
  });
  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward' || command === 'browser-forward') mainWindow?.webContents.send('easyhub:navigate', command === 'browser-backward' ? 'back' : 'forward');
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

if (primaryInstance) app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({ applicationName: 'EasyHub', applicationVersion: app.getVersion(),
      copyright: 'EasyHub contributors', credits: 'Apache 2.0 · FuFu-Flash/EasyHub' });
    rebuildApplicationMenu();
  } else Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  localService = new LocalProjectService(new LocalProjectStore(join(app.getPath('userData'), 'local-projects.json')),
    (channel, value) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value); },
    new DiscoveryRootsStore(join(app.getPath('userData'), 'project-search-locations.json')));
  downloadsService = new GitHubDownloads(app.getPath('userData'), localService,
    (items) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('easyhub:downloads-changed', items); });
  const translateFetch = (url: string, init: RequestInit): Promise<Response> => net.fetch(url, init);
  translationService = new TranslationService(new FallbackTranslationProvider(
    new MyMemoryTranslationProvider(translateFetch), new GoogleWebTranslationProvider(translateFetch)),
  join(app.getPath('userData'), 'translations.json'));
  releaseService = new ReleasePublishingService();
  const analysisRuntime = new AnalysisRuntime(app.getPath('userData'), { fetch: analysisElectronFetch });
  binaryAnalysisService = new BinaryAnalysisService(join(app.getPath('userData'), 'analysis-sessions'), {
    status: async () => { const status = await analysisRuntime.status(); return { installed: status.state === 'ready', downloadBytes: status.downloadBytes,
      error: status.error ? (status.error.includes('暂不提供 Linux') ? status.error : '分析组件尚未准备好，请重新安装。') : undefined }; },
    install: async (signal, progress) => { await analysisRuntime.install({ signal, onProgress: (value) => progress(value.downloadedBytes, value.totalBytes) }); },
    analyzer: async (workspace) => {
      const status = await analysisRuntime.status();
      if (!status.paths) throw new Error('请先安装分析组件。');
      const backend = new GhidraBackend({ mode: 'managed', javaPath: status.paths.javaPath, ghidraHome: status.paths.ghidraPath,
        pluginJar: status.paths.extensionPath, workspaceRoot: workspace });
      return { analyze: (path, signal, progress, language) => backend.analyze(path, { signal, language, maxFunctions: 16, maxStrings: 80, onProgress: (value) => progress(value.completed ?? 0, value.total ?? 0) }), stop: () => backend.stop() };
    },
  }, loadBinaryAnalysisFile);
  await binaryAnalysisService.initialize();
  aiReviewService = new AiReviewService(aiCredentialStore(),
    new OpenAiReviewProvider((url, init) => net.fetch(url, init)), getPullRequestReviewContext, {
      status: () => binaryAnalysisService.status(),
      analyze: (input, file, signal, progress) => binaryAnalysisService.analyze({ requestId: input.requestId, language: input.language ?? 'zh',
        source: { kind: 'pull', owner: input.owner, repo: input.repo, number: input.number, headSha: input.headSha, path: file.filename } }, (value) => {
        const en = input.language === 'en';
        progress(value.phase === 'preparing' ? en ? `Preparing ${file.filename}…` : `正在准备 ${file.filename}…`
          : value.phase === 'analyzing' ? en ? `Analyzing ${file.filename}…` : `正在分析 ${file.filename}…`
            : en ? `Analyzed ${file.filename}` : `${file.filename} 分析完成`);
      }, signal),
    }, async (source, signal) => {
      signal.throwIfAborted();
      const cancel = (): void => { void localService.cancelPreview(source.projectId).catch(() => undefined); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const evidence = await localService.fileDiff(source.projectId, source.path, source.snapshot);
        signal.throwIfAborted();
        return evidence;
      } finally { signal.removeEventListener('abort', cancel); }
    }, loadCommitExplanation);
  const resourcesPath = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources');
  if (process.platform === 'win32') {
    hostsRepairService = new HostsRepairService((url, init) => net.fetch(url, init), resourcesPath, app.getPath('userData'));
  }
  githubProxyService = new GitHubProxyService(join(app.getPath('userData'), 'github-proxy.json'), {
    nativeFetch: request => net.fetch(request, { bypassCustomProtocolHandlers: true }),
    resolveProxy: url => session.defaultSession.resolveProxy(url),
    legacyHosts: async () => hostsRepairService ? (await hostsRepairService.status()).enabled : false,
    closeConnections: () => session.defaultSession.closeAllConnections(),
    // Tests never acquire or restore production OS network settings.
    ...(process.env.EASYHUB_PROXY_APP_ONLY_TEST === '1' || process.env.EASYHUB_TEST_MODE === '1' ? {} : {
      systemProxy: process.platform === 'darwin'
        ? new MacSystemProxy(join(app.getPath('userData'), 'mac-system-proxy-lease.json'), {
          resolveExistingProxy: (url: string) => session.defaultSession.resolveProxy(url),
        })
        : process.platform === 'win32'
          ? new WindowsSystemProxy(join(app.getPath('userData'), 'system-proxy-lease.json'), {
            scriptPath: join(resourcesPath, 'windows-system-proxy.ps1'),
            resolveExistingProxy: (url: string) => session.defaultSession.resolveProxy(url),
          })
          : new LinuxSystemProxy(),
      systemRelay: new GitHubSystemRelay({ connect: (host, signal) => githubProxyService.agent.openBrowserTunnel(host, signal) }),
    }),
  });
  await githubProxyService.initialize();
  useGitHubProxy(githubProxyService);
  session.defaultSession.protocol.handle('https', request => githubProxyService.fetch(request));
  if (githubProxyService.isEnabled()) void githubProxyService.refresh();
  void localService.startWatching();

  handle('easyhub:menu-state', (event, value: unknown) => {
    assertTrustedSender(event);
    if (!isMenuState(value)) throw new Error('菜单状态无效。');
    // Copy only the validated fields instead of retaining an IPC object.
    menuState = { language: value.language, signedIn: value.signedIn, busy: value.busy,
      modalOpen: value.modalOpen, demoOnly: value.demoOnly };
    rendererMenuReady = true;
    rebuildApplicationMenu();
    flushPendingMenuCommand();
  });

  handle('easyhub:window-minimize', (event) => {
    assertTrustedSender(event);
    mainWindow?.minimize();
  });

  handle('easyhub:window-set-style', (event, style: unknown, density: unknown) => {
    assertTrustedSender(event);
    if (style !== 'reference' && style !== 'windows') throw new Error('窗口控件样式无效。');
    if (density !== undefined && density !== 'compact' && density !== 'comfortable') throw new Error('界面布局无效。');
    windowControlStyle = style;
    windowToolbarDensity = density === 'compact' ? 'compact' : 'comfortable';
    if (process.platform === 'darwin') {
      mainWindow!.setWindowButtonVisibility(style === 'reference');
      // Match the renderer's 56/72px toolbar and 16/25px leading inset.
      mainWindow!.setWindowButtonPosition(density === 'compact' ? { x: 16, y: 17 } : { x: 20, y: 19 });
    }
  });

  handle('easyhub:window-toggle-maximize', (event) => {
    assertTrustedSender(event);
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });

  handle('easyhub:window-close', (event) => {
    assertTrustedSender(event);
    setImmediate(() => mainWindow?.close());
  });

  handle('easyhub:open-license', async (event) => {
    assertTrustedSender(event);
    await shell.openExternal('https://www.apache.org/licenses/LICENSE-2.0');
  });

  handle('easyhub:hosts-status', (event) => { assertTrustedSender(event); return hostsRepairService ? hostsRepairService.status() : { enabled: false, updatedAt: null, source: '' }; });
  handle('easyhub:hosts-set-enabled', async (event, enabled: unknown) => {
    assertTrustedSender(event);
    if (typeof enabled !== 'boolean') throw new Error('Hosts 修复设置无效。');
    if (enabled) throw new Error('请使用设置中的 GitHub 代理。');
    const status = await requireWindowsHosts().setEnabled(enabled);
    await session.defaultSession.clearHostResolverCache();
    return status;
  });
  handle('easyhub:hosts-refresh', async (event) => {
    assertTrustedSender(event);
    throw new Error('请使用设置中的 GitHub 代理。');
  });
  handle('easyhub:github-proxy-status', (event) => { assertTrustedSender(event); return githubProxyService.status(); });
  handle('easyhub:github-proxy-set-enabled', (event, enabled: unknown) => {
    assertTrustedSender(event);
    if (typeof enabled !== 'boolean') throw new Error('GitHub 代理设置无效。');
    return githubProxyService.setEnabled(enabled);
  });
  handle('easyhub:github-proxy-refresh', (event) => { assertTrustedSender(event); return githubProxyService.refresh(); });
  handle('easyhub:github-proxy-cancel', (event) => { assertTrustedSender(event); githubProxyService.cancel(); return githubProxyService.status(); });

  handle('easyhub:open-external-link', async (event, rawUrl: unknown) => {
    assertTrustedSender(event);
    if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new Error('链接无效');
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('链接无效');
    await shell.openExternal(url.toString());
  });

  handle('easyhub:choose-folder', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择项目文件夹',
      properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : localService.grant(result.filePaths[0]);
  });

  handle('easyhub:local-relocate', (event, id: unknown, path: unknown) => { assertTrustedSender(event); return localService.relocate(id, path); });
  handle('easyhub:local-remove', (event, id: unknown) => { assertTrustedSender(event); return localService.remove(id); });
  handle('easyhub:renderer-error', (event, report: unknown) => { assertTrustedSender(event); rendererErrorLog ??= new RendererErrorLog(join(app.getPath('userData'), 'logs', 'renderer-errors.log')); return rendererErrorLog.write(report); });
  handle('easyhub:local-list', (event) => { assertTrustedSender(event); return localService.list(); });
  handle('easyhub:local-discovery-roots', (event) => { assertTrustedSender(event); return localService.listDiscoveryRoots(); });
  handle('easyhub:local-discovery-add-root', (event, path: unknown) => { assertTrustedSender(event); return localService.addDiscoveryRoot(path); });
  handle('easyhub:local-discovery-remove-root', (event, path: unknown) => { assertTrustedSender(event); return localService.removeDiscoveryRoot(path); });
  handle('easyhub:local-discovery-scan', (event) => { assertTrustedSender(event); return localService.scanDiscoveryRoots(); });
  handle('easyhub:local-inspect', (event, path: unknown) => { assertTrustedSender(event); return localService.inspect(path); });
  handle('easyhub:local-connect', (event, path: unknown) => { assertTrustedSender(event); return localService.connectExisting(path); });
  handle('easyhub:local-create', (event, path: unknown, name: unknown, description: unknown, isPrivate: unknown) => { assertTrustedSender(event); return localService.create(path, name, description, isPrivate); });
  handle('easyhub:local-download', (event, owner: unknown, name: unknown, parent: unknown) => { assertTrustedSender(event); return localService.download(owner, name, parent); });
  handle('easyhub:local-status', (event, id: unknown) => { assertTrustedSender(event); return localService.status(id); });
  handle('easyhub:local-preview-changes', (event, id: unknown) => { assertTrustedSender(event); return localService.previewChanges(id); });
  handle('easyhub:local-file-diff', (event, id: unknown, path: unknown, snapshot: unknown) => { assertTrustedSender(event); return localService.fileDiff(id, path, snapshot); });
  handle('easyhub:local-cancel-preview', (event, id: unknown) => { assertTrustedSender(event); return localService.cancelPreview(id); });
  handle('easyhub:local-publish', (event, id: unknown, message: unknown, selection: unknown) => { assertTrustedSender(event); return localService.publish(id, message, selection); });
  handle('easyhub:local-list-branches', (event, id) => { assertTrustedSender(event); return localService.listBranches(id); });
  handle('easyhub:local-switch-branch', (event, id, name) => { assertTrustedSender(event); return localService.switchBranch(id, name); });
  handle('easyhub:local-create-branch', (event, id, name) => { assertTrustedSender(event); return localService.createBranch(id, name); });
  handle('easyhub:local-push-branch', (event, id: unknown) => { assertTrustedSender(event); return localService.pushBranch(id); });
  handle('easyhub:local-check-sync', (event, id: unknown) => { assertTrustedSender(event); return localService.checkSync(id); });
  handle('easyhub:local-sync', (event, id: unknown, revision: unknown, decisions: unknown) => { assertTrustedSender(event); return localService.sync(id, revision, decisions); });
  handle('easyhub:local-cancel', (event) => { assertTrustedSender(event); localService.cancel(); });
  handle('easyhub:local-open-folder', async (event, id: unknown) => { assertTrustedSender(event); const path = await localService.path(id); const error = await shell.openPath(path); if (error) throw new Error('无法打开项目文件夹。'); });
  handle('easyhub:local-read-introduction', (event, id: unknown) => { assertTrustedSender(event); return localService.readIntroduction(id); });
  handle('easyhub:local-save-introduction', (event, id: unknown, expected: unknown, content: unknown) => { assertTrustedSender(event); return localService.saveIntroduction(id, expected, content); });

  handle('easyhub:translate-content', async (event, input: unknown) => {
    assertTrustedSender(event);
    if (typeof input !== 'object' || input === null || !('id' in input) || !('text' in input) || !('format' in input) || !('target' in input) ||
      typeof input.id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/u.test(input.id) || typeof input.text !== 'string' ||
      (input.format !== 'text' && input.format !== 'markdown') || (input.target !== 'zh-CN' && input.target !== 'en')) throw new Error('翻译内容无效，请重试。');
    // GitHub README files can be substantially larger than a short issue or release note.
    if (input.text.length > 1_000_000) throw new Error('内容太长，暂时无法翻译。');
    if (('repository' in input && (typeof input.repository !== 'object' || input.repository === null || !('name' in input.repository) ||
      !('owner' in input.repository) || typeof input.repository.name !== 'string' || input.repository.name.length > 100 ||
      typeof input.repository.owner !== 'string' || input.repository.owner.length > 100 ||
      ('fullName' in input.repository && (typeof input.repository.fullName !== 'string' || input.repository.fullName.length > 210)))) ||
      ('protectedNames' in input && (!Array.isArray(input.protectedNames) || input.protectedNames.length > 100 ||
        !input.protectedNames.every((name: unknown) => typeof name === 'string' && name.length <= 80)))) throw new Error('翻译名称设置无效，请重试。');
    if (translationJobs.has(input.id)) throw new Error('翻译正在进行，请稍候。');
    const controller = new AbortController();
    translationJobs.set(input.id, controller);
    try {
      return await translationService.translate(input as TranslationRequest, controller.signal,
        (progress) => event.sender.send('easyhub:translation-progress', progress));
    } finally { translationJobs.delete(input.id); }
  });
  handle('easyhub:cancel-translation', (event, id: unknown) => {
    assertTrustedSender(event);
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/u.test(id)) throw new Error('翻译任务无效。');
    translationJobs.get(id)?.abort();
  });

  handle('easyhub:auth-status', (event) => { assertTrustedSender(event); return authStatus(); });
  handle('easyhub:ai-settings', (event) => { assertTrustedSender(event); return aiReviewService.settings(); });
  handle('easyhub:ai-save-settings', (event, input: unknown) => { assertTrustedSender(event); return aiReviewService.save(input); });
  handle('easyhub:ai-forget-key', (event) => { assertTrustedSender(event); return aiReviewService.forgetKey(); });
  handle('easyhub:ai-test-connection', (event) => { assertTrustedSender(event); return aiReviewService.testConnection(); });
  handle('easyhub:ai-review-pull', (event, input: unknown) => {
    assertTrustedSender(event);
    return aiReviewService.review(input, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:ai-review-progress', progress); });
  });
  handle('easyhub:ai-cancel-review', (event, id: unknown) => { assertTrustedSender(event); aiReviewService.cancel(id); });
  handle('easyhub:ai-explain-code', (event, input: unknown) => { assertTrustedSender(event); return aiReviewService.explainCode(input); });
  handle('easyhub:ai-explain-commit', (event, input: unknown) => { assertTrustedSender(event); return aiReviewService.explainCommit(input); });
  handle('easyhub:binary-analysis-status', (event) => { assertTrustedSender(event); return binaryAnalysisService.status(); });
  handle('easyhub:binary-analysis-install', (event, id: unknown) => {
    assertTrustedSender(event);
    return binaryAnalysisService.install(id, (value) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:binary-analysis-progress', value); });
  });
  handle('easyhub:binary-analysis-choose-file', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择要分析的程序文件', properties: ['openFile'],
      filters: [{ name: '程序文件', extensions: ['exe', 'dll', 'sys', 'elf', 'so', 'dylib', 'bin'] }, { name: '所有文件', extensions: ['*'] }] });
    return result.canceled || !result.filePaths[0] ? null : binaryAnalysisService.grantLocal(result.filePaths[0]);
  });
  handle('easyhub:binary-analyze', (event, input: unknown) => {
    assertTrustedSender(event);
    return binaryAnalysisService.analyze(input, (value) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:binary-analysis-progress', value); });
  });
  handle('easyhub:binary-analysis-cancel', (event, id: unknown) => { assertTrustedSender(event); return binaryAnalysisService.cancel(id); });
  handle('easyhub:binary-ai-review', (event, input: unknown) => {
    assertTrustedSender(event);
    return aiReviewService.reviewBinary(input, (id) => binaryAnalysisService.evidence(id), (value) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:ai-review-progress', value); });
  });
  handle('easyhub:auth-start', (event) => { assertTrustedSender(event); return loginWithCopiedCode(); });
  handle('easyhub:auth-start-delete', (event, owner: unknown, repo: unknown, id: unknown) => { assertTrustedSender(event); return loginWithCopiedCode(true, { owner, repo, id } as { owner: string; repo: string; id: number }); });
  handle('easyhub:copy-pairing-code', (event, value: unknown) => { assertTrustedSender(event); return copyPairingCode(value); });
  handle('easyhub:auth-poll', (event) => { assertTrustedSender(event); return pollDeviceLogin(); });
  handle('easyhub:auth-cancel', (event) => { assertTrustedSender(event); ++pairingRequest; pairingCode = null; cancelDeviceLogin(); });
  handle('easyhub:auth-logout', (event) => { assertTrustedSender(event); ++pairingRequest; pairingCode = null; return logout(); });
  handle('easyhub:release-choose-files', (event, inline: unknown) => { assertTrustedSender(event); return releaseService.chooseFiles(inline as boolean); });
  handle('easyhub:release-publish', (event, input: unknown) => { assertTrustedSender(event); return releaseService.publish(input, (value) => event.sender.send('easyhub:release-progress', value)); });
  handle('easyhub:release-edit', (event, input: unknown) => { assertTrustedSender(event); return releaseService.edit(input); });
  handle('easyhub:release-add-assets', (event, input: unknown) => { assertTrustedSender(event); return releaseService.addAssets(input, (value) => event.sender.send('easyhub:release-progress', value)); });
  handle('easyhub:release-remove-asset', (event, input: unknown) => { assertTrustedSender(event); return releaseService.removeAsset(input); });
  handle('easyhub:release-cancel', (event) => { assertTrustedSender(event); releaseService.cancel(); });
  handle('easyhub:github', (event, action: unknown, ...args: unknown[]) => { assertTrustedSender(event); return githubAction(action, args); });
  handle('easyhub:github-cancel', (event) => { assertTrustedSender(event); cancelGithubReads(); });
  const sendDownloadProgress = (event: Electron.IpcMainInvokeEvent, value: DownloadTransferProgress): void => {
    event.sender.send('easyhub:download-progress', value);
    if (value.percent !== null) event.sender.send('easyhub:archive-progress', value.percent);
  };
  handle('easyhub:downloads-list', (event) => { assertTrustedSender(event); return downloadsService.manager.list(); });
  handle('easyhub:downloads-enqueue', (event, input: unknown) => { assertTrustedSender(event); return downloadsService.enqueue(input); });
  handle('easyhub:downloads-command', (event, id: unknown, command: unknown) => { assertTrustedSender(event); return downloadsService.manager.command(id, command); });
  handle('easyhub:downloads-clear', (event) => { assertTrustedSender(event); return downloadsService.manager.clearFinished(); });
  handle('easyhub:downloads-open', (event, id: unknown, folder: unknown) => { assertTrustedSender(event); return downloadsService.open(id, folder); });
  handle('easyhub:download-archive', (event, owner: unknown, repo: unknown, ref: unknown) => { assertTrustedSender(event); return downloadArchive(owner, repo, ref, (value) => sendDownloadProgress(event, value)); });
  handle('easyhub:download-release-asset', (event, owner: unknown, repo: unknown, assetId: unknown) => { assertTrustedSender(event); return downloadReleaseAsset(owner, repo, assetId, (value) => sendDownloadProgress(event, value)); });
  handle('easyhub:download-pull-file', (event, owner: unknown, repo: unknown, number: unknown, path: unknown, headSha: unknown) => {
    assertTrustedSender(event);
    if (typeof headSha !== 'string' || !/^[a-f0-9]{40}$/iu.test(headSha)) throw new Error('请刷新合并请求后重新下载。');
    return downloadPullRequestFile(owner, repo, number, path, (value) => sendDownloadProgress(event, value), headSha);
  });
  handle('easyhub:reveal-downloaded-archive', (event, path: unknown) => { assertTrustedSender(event); revealDownloadedArchive(path); });
  handle('easyhub:open-downloaded-file', (event, path: unknown) => { assertTrustedSender(event); return openDownloadedFile(path); });
  handle('easyhub:cancel-archive', (event) => { assertTrustedSender(event); cancelArchive(); });

  createWindow();
  app.on('activate', () => {
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  localService?.stopWatching(); aiReviewService?.cancelAll();
  for (const controller of translationJobs.values()) controller.abort();
  if (!servicesStoppedForQuit && (binaryAnalysisService || githubProxyService || downloadsService)) {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void Promise.allSettled([githubProxyService?.destroy(), binaryAnalysisService?.shutdown(), downloadsService?.manager.shutdown()]).finally(() => {
      servicesStoppedForQuit = true;
      // Let macOS finish cancelling the original native terminate event before
      // starting a new quit cycle; a Promise microtask can re-enter that stack.
      setImmediate(() => app.quit());
    });
  }
});
