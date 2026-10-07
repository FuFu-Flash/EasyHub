import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { isAbsolute, join } from 'node:path';
import { authStatus, cancelArchive, cancelDeviceLogin, cancelGithubReads, downloadArchive, downloadReleaseAsset, downloadPullRequestFile, getPullRequestReviewContext, githubAction, loadBinaryAnalysisFile, logout, openDownloadedFile, pollDeviceLogin, revealDownloadedArchive, startDeviceLogin } from './services/githubService';
import { AsyncEntry } from '@napi-rs/keyring';
import { AiReviewService, type AiCredentialStore } from './services/AiReviewService';
import { HostsRepairService } from './services/hostsRepair';
import { GitHubProxyService, useGitHubProxy } from './services/GitHubProxyService';
import { WindowsSystemProxy } from './services/WindowsSystemProxy';
import { MacSystemProxy } from './services/MacSystemProxy';
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
import { createApplicationMenuTemplate } from './applicationMenu';
import { AnalysisRuntime } from './analysis/AnalysisRuntime';
import { analysisElectronFetch } from './analysis/analysisElectronFetch';
import { BinaryAnalysisService } from './analysis/BinaryAnalysisService';
import { GhidraBackend } from './analysis/GhidraBackend';

let mainWindow: BrowserWindow | null = null;
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
const translationJobs = new Map<string, AbortController>();

app.setName('EasyHub');
if (process.env.EASYHUB_TEST_MODE === '1' && process.env.EASYHUB_TEST_USER_DATA && isAbsolute(process.env.EASYHUB_TEST_USER_DATA)) {
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

function rebuildApplicationMenu(): void {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(createApplicationMenuTemplate(menuState, rendererMenuReady, {
    command: dispatchMenuCommand,
    showWindow: showMainWindow,
    openExternal: (url) => {
      void shell.openExternal(url).catch(() => {
        const english = menuState.language === 'en';
        dialog.showErrorBox(english ? 'Could not open the browser' : '无法打开浏览器',
          english ? 'Check your default browser and try again.' : '请检查默认浏览器设置，然后重试。');
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

function createWindow(): void {
  resetRendererMenuState();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 700,
    frame: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hidden' as const,
      trafficLightPosition: { x: 25, y: 29 },
    } : {}),
    roundedCorners: true,
    thickFrame: true,
    show: false,
    backgroundColor: '#f5f7fb',
    title: 'EasyHub',
    icon: app.isPackaged
      ? join(process.resourcesPath, process.platform === 'darwin' ? 'easyhub.png' : 'easyhub.ico')
      : join(__dirname, '../../resources', process.platform === 'darwin' ? 'easyhub.png' : 'easyhub.ico'),
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
      copyright: 'EasyHub contributors', credits: 'GNU GPLv3 · FuFu-Flash/EasyHub' });
    rebuildApplicationMenu();
  } else Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  localService = new LocalProjectService(new LocalProjectStore(join(app.getPath('userData'), 'local-projects.json')),
    (channel, value) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value); },
    new DiscoveryRootsStore(join(app.getPath('userData'), 'project-search-locations.json')));
  const translateFetch = (url: string, init: RequestInit): Promise<Response> => net.fetch(url, init);
  translationService = new TranslationService(new FallbackTranslationProvider(
    new MyMemoryTranslationProvider(translateFetch), new GoogleWebTranslationProvider(translateFetch)),
  join(app.getPath('userData'), 'translations.json'));
  releaseService = new ReleasePublishingService();
  const analysisRuntime = new AnalysisRuntime(app.getPath('userData'), { fetch: analysisElectronFetch });
  binaryAnalysisService = new BinaryAnalysisService(join(app.getPath('userData'), 'analysis-sessions'), {
    status: async () => { const status = await analysisRuntime.status(); return { installed: status.state === 'ready', downloadBytes: status.downloadBytes,
      error: status.error ? '分析组件尚未准备好，请重新安装。' : undefined }; },
    install: async (signal, progress) => { await analysisRuntime.install({ signal, onProgress: (value) => progress(value.downloadedBytes, value.totalBytes) }); },
    analyzer: async (workspace) => {
      const status = await analysisRuntime.status();
      if (!status.paths) throw new Error('请先安装分析组件。');
      const backend = new GhidraBackend({ mode: 'managed', javaPath: status.paths.javaPath, ghidraHome: status.paths.ghidraPath,
        pluginJar: status.paths.extensionPath, workspaceRoot: workspace });
      return { analyze: (path, signal, progress, language) => backend.analyze(path, { signal, language, maxFunctions: 16, maxStrings: 80, onProgress: (value) => progress(value.completed ?? 0, value.total ?? 0) }), stop: () => backend.stop() };
    },
  }, loadBinaryAnalysisFile);
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
    });
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
        : new WindowsSystemProxy(join(app.getPath('userData'), 'system-proxy-lease.json'), {
          scriptPath: join(resourcesPath, 'windows-system-proxy.ps1'),
          resolveExistingProxy: (url: string) => session.defaultSession.resolveProxy(url),
        }),
      systemRelay: new GitHubSystemRelay({ connect: (host, signal) => githubProxyService.agent.openBrowserTunnel(host, signal) }),
    }),
  });
  await githubProxyService.initialize();
  useGitHubProxy(githubProxyService);
  session.defaultSession.protocol.handle('https', request => githubProxyService.fetch(request));
  if (githubProxyService.isEnabled()) void githubProxyService.refresh();
  void localService.startWatching();

  ipcMain.handle('easyhub:menu-state', (event, value: unknown) => {
    assertTrustedSender(event);
    if (!isMenuState(value)) throw new Error('菜单状态无效。');
    // Copy only the validated fields instead of retaining an IPC object.
    menuState = { language: value.language, signedIn: value.signedIn, busy: value.busy,
      modalOpen: value.modalOpen, demoOnly: value.demoOnly };
    rendererMenuReady = true;
    rebuildApplicationMenu();
    flushPendingMenuCommand();
  });

  ipcMain.handle('easyhub:window-minimize', (event) => {
    assertTrustedSender(event);
    mainWindow?.minimize();
  });

  ipcMain.handle('easyhub:window-set-style', (event, style: unknown) => {
    assertTrustedSender(event);
    if (style !== 'reference' && style !== 'windows') throw new Error('窗口控件样式无效。');
    windowControlStyle = style;
    if (process.platform === 'darwin') {
      mainWindow!.setWindowButtonVisibility(style === 'reference');
    }
  });

  ipcMain.handle('easyhub:window-toggle-maximize', (event) => {
    assertTrustedSender(event);
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });

  ipcMain.handle('easyhub:window-close', (event) => {
    assertTrustedSender(event);
    setImmediate(() => mainWindow?.close());
  });

  ipcMain.handle('easyhub:open-license', async (event) => {
    assertTrustedSender(event);
    await shell.openExternal('https://www.gnu.org/licenses/gpl-3.0.html');
  });

  ipcMain.handle('easyhub:hosts-status', (event) => { assertTrustedSender(event); return requireWindowsHosts().status(); });
  ipcMain.handle('easyhub:hosts-set-enabled', async (event, enabled: unknown) => {
    assertTrustedSender(event);
    if (typeof enabled !== 'boolean') throw new Error('Hosts 修复设置无效。');
    if (enabled) throw new Error('请使用设置中的 GitHub 代理。');
    const status = await requireWindowsHosts().setEnabled(enabled);
    await session.defaultSession.clearHostResolverCache();
    return status;
  });
  ipcMain.handle('easyhub:hosts-refresh', async (event) => {
    assertTrustedSender(event);
    throw new Error('请使用设置中的 GitHub 代理。');
  });
  ipcMain.handle('easyhub:github-proxy-status', (event) => { assertTrustedSender(event); return githubProxyService.status(); });
  ipcMain.handle('easyhub:github-proxy-set-enabled', (event, enabled: unknown) => {
    assertTrustedSender(event);
    if (typeof enabled !== 'boolean') throw new Error('GitHub 代理设置无效。');
    return githubProxyService.setEnabled(enabled);
  });
  ipcMain.handle('easyhub:github-proxy-refresh', (event) => { assertTrustedSender(event); return githubProxyService.refresh(); });
  ipcMain.handle('easyhub:github-proxy-cancel', (event) => { assertTrustedSender(event); githubProxyService.cancel(); return githubProxyService.status(); });

  ipcMain.handle('easyhub:open-external-link', async (event, rawUrl: unknown) => {
    assertTrustedSender(event);
    if (typeof rawUrl !== 'string' || rawUrl.length > 2048) throw new Error('链接无效');
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('链接无效');
    await shell.openExternal(url.toString());
  });

  ipcMain.handle('easyhub:choose-folder', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择项目文件夹',
      properties: ['openDirectory'],
    });
    return result.canceled || !result.filePaths[0] ? null : localService.grant(result.filePaths[0]);
  });

  ipcMain.handle('easyhub:local-list', (event) => { assertTrustedSender(event); return localService.list(); });
  ipcMain.handle('easyhub:local-discovery-roots', (event) => { assertTrustedSender(event); return localService.listDiscoveryRoots(); });
  ipcMain.handle('easyhub:local-discovery-add-root', (event, path: unknown) => { assertTrustedSender(event); return localService.addDiscoveryRoot(path); });
  ipcMain.handle('easyhub:local-discovery-remove-root', (event, path: unknown) => { assertTrustedSender(event); return localService.removeDiscoveryRoot(path); });
  ipcMain.handle('easyhub:local-discovery-scan', (event) => { assertTrustedSender(event); return localService.scanDiscoveryRoots(); });
  ipcMain.handle('easyhub:local-inspect', (event, path: unknown) => { assertTrustedSender(event); return localService.inspect(path); });
  ipcMain.handle('easyhub:local-connect', (event, path: unknown) => { assertTrustedSender(event); return localService.connectExisting(path); });
  ipcMain.handle('easyhub:local-create', (event, path: unknown, name: unknown, description: unknown, isPrivate: unknown) => { assertTrustedSender(event); return localService.create(path, name, description, isPrivate); });
  ipcMain.handle('easyhub:local-download', (event, owner: unknown, name: unknown, parent: unknown) => { assertTrustedSender(event); return localService.download(owner, name, parent); });
  ipcMain.handle('easyhub:local-status', (event, id: unknown) => { assertTrustedSender(event); return localService.status(id); });
  ipcMain.handle('easyhub:local-publish', (event, id: unknown, message: unknown) => { assertTrustedSender(event); return localService.publish(id, message); });
  ipcMain.handle('easyhub:local-check-sync', (event, id: unknown) => { assertTrustedSender(event); return localService.checkSync(id); });
  ipcMain.handle('easyhub:local-sync', (event, id: unknown, revision: unknown, decisions: unknown) => { assertTrustedSender(event); return localService.sync(id, revision, decisions); });
  ipcMain.handle('easyhub:local-cancel', (event) => { assertTrustedSender(event); localService.cancel(); });
  ipcMain.handle('easyhub:local-open-folder', async (event, id: unknown) => { assertTrustedSender(event); const path = await localService.path(id); const error = await shell.openPath(path); if (error) throw new Error('无法打开项目文件夹。'); });
  ipcMain.handle('easyhub:local-read-introduction', (event, id: unknown) => { assertTrustedSender(event); return localService.readIntroduction(id); });
  ipcMain.handle('easyhub:local-save-introduction', (event, id: unknown, expected: unknown, content: unknown) => { assertTrustedSender(event); return localService.saveIntroduction(id, expected, content); });

  ipcMain.handle('easyhub:translate-content', async (event, input: unknown) => {
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
  ipcMain.handle('easyhub:cancel-translation', (event, id: unknown) => {
    assertTrustedSender(event);
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/u.test(id)) throw new Error('翻译任务无效。');
    translationJobs.get(id)?.abort();
  });

  ipcMain.handle('easyhub:auth-status', (event) => { assertTrustedSender(event); return authStatus(); });
  ipcMain.handle('easyhub:ai-settings', (event) => { assertTrustedSender(event); return aiReviewService.settings(); });
  ipcMain.handle('easyhub:ai-save-settings', (event, input: unknown) => { assertTrustedSender(event); return aiReviewService.save(input); });
  ipcMain.handle('easyhub:ai-forget-key', (event) => { assertTrustedSender(event); return aiReviewService.forgetKey(); });
  ipcMain.handle('easyhub:ai-test-connection', (event) => { assertTrustedSender(event); return aiReviewService.testConnection(); });
  ipcMain.handle('easyhub:ai-review-pull', (event, input: unknown) => {
    assertTrustedSender(event);
    return aiReviewService.review(input, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:ai-review-progress', progress); });
  });
  ipcMain.handle('easyhub:ai-cancel-review', (event, id: unknown) => { assertTrustedSender(event); aiReviewService.cancel(id); });
  ipcMain.handle('easyhub:binary-analysis-status', (event) => { assertTrustedSender(event); return binaryAnalysisService.status(); });
  ipcMain.handle('easyhub:binary-analysis-install', (event, id: unknown) => {
    assertTrustedSender(event);
    return binaryAnalysisService.install(id, (value) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:binary-analysis-progress', value); });
  });
  ipcMain.handle('easyhub:binary-analysis-choose-file', async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: '选择要分析的程序文件', properties: ['openFile'],
      filters: [{ name: '程序文件', extensions: ['exe', 'dll', 'sys', 'elf', 'so', 'dylib', 'bin'] }, { name: '所有文件', extensions: ['*'] }] });
    return result.canceled || !result.filePaths[0] ? null : binaryAnalysisService.grantLocal(result.filePaths[0]);
  });
  ipcMain.handle('easyhub:binary-analyze', (event, input: unknown) => {
    assertTrustedSender(event);
    return binaryAnalysisService.analyze(input, (value) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:binary-analysis-progress', value); });
  });
  ipcMain.handle('easyhub:binary-analysis-cancel', (event, id: unknown) => { assertTrustedSender(event); return binaryAnalysisService.cancel(id); });
  ipcMain.handle('easyhub:binary-ai-review', (event, input: unknown) => {
    assertTrustedSender(event);
    return aiReviewService.reviewBinary(input, (id) => binaryAnalysisService.evidence(id), (value) => { if (!event.sender.isDestroyed()) event.sender.send('easyhub:ai-review-progress', value); });
  });
  ipcMain.handle('easyhub:auth-start', (event) => { assertTrustedSender(event); return loginWithCopiedCode(); });
  ipcMain.handle('easyhub:auth-start-delete', (event, owner: unknown, repo: unknown, id: unknown) => { assertTrustedSender(event); return loginWithCopiedCode(true, { owner, repo, id } as { owner: string; repo: string; id: number }); });
  ipcMain.handle('easyhub:copy-pairing-code', (event, value: unknown) => { assertTrustedSender(event); return copyPairingCode(value); });
  ipcMain.handle('easyhub:auth-poll', (event) => { assertTrustedSender(event); return pollDeviceLogin(); });
  ipcMain.handle('easyhub:auth-cancel', (event) => { assertTrustedSender(event); ++pairingRequest; pairingCode = null; cancelDeviceLogin(); });
  ipcMain.handle('easyhub:auth-logout', (event) => { assertTrustedSender(event); ++pairingRequest; pairingCode = null; return logout(); });
  ipcMain.handle('easyhub:release-choose-files', (event, inline: unknown) => { assertTrustedSender(event); return releaseService.chooseFiles(inline as boolean); });
  ipcMain.handle('easyhub:release-publish', (event, input: unknown) => { assertTrustedSender(event); return releaseService.publish(input, (value) => event.sender.send('easyhub:release-progress', value)); });
  ipcMain.handle('easyhub:release-edit', (event, input: unknown) => { assertTrustedSender(event); return releaseService.edit(input); });
  ipcMain.handle('easyhub:release-add-assets', (event, input: unknown) => { assertTrustedSender(event); return releaseService.addAssets(input, (value) => event.sender.send('easyhub:release-progress', value)); });
  ipcMain.handle('easyhub:release-remove-asset', (event, input: unknown) => { assertTrustedSender(event); return releaseService.removeAsset(input); });
  ipcMain.handle('easyhub:release-cancel', (event) => { assertTrustedSender(event); releaseService.cancel(); });
  ipcMain.handle('easyhub:github', (event, action: unknown, ...args: unknown[]) => { assertTrustedSender(event); return githubAction(action, args); });
  ipcMain.handle('easyhub:github-cancel', (event) => { assertTrustedSender(event); cancelGithubReads(); });
  const sendDownloadProgress = (event: Electron.IpcMainInvokeEvent, value: DownloadTransferProgress): void => {
    event.sender.send('easyhub:download-progress', value);
    if (value.percent !== null) event.sender.send('easyhub:archive-progress', value.percent);
  };
  ipcMain.handle('easyhub:download-archive', (event, owner: unknown, repo: unknown, ref: unknown) => { assertTrustedSender(event); return downloadArchive(owner, repo, ref, (value) => sendDownloadProgress(event, value)); });
  ipcMain.handle('easyhub:download-release-asset', (event, owner: unknown, repo: unknown, assetId: unknown) => { assertTrustedSender(event); return downloadReleaseAsset(owner, repo, assetId, (value) => sendDownloadProgress(event, value)); });
  ipcMain.handle('easyhub:download-pull-file', (event, owner: unknown, repo: unknown, number: unknown, path: unknown, headSha: unknown) => {
    assertTrustedSender(event);
    if (typeof headSha !== 'string' || !/^[a-f0-9]{40}$/iu.test(headSha)) throw new Error('请刷新改进请求后重新下载。');
    return downloadPullRequestFile(owner, repo, number, path, (value) => sendDownloadProgress(event, value), headSha);
  });
  ipcMain.handle('easyhub:reveal-downloaded-archive', (event, path: unknown) => { assertTrustedSender(event); revealDownloadedArchive(path); });
  ipcMain.handle('easyhub:open-downloaded-file', (event, path: unknown) => { assertTrustedSender(event); return openDownloadedFile(path); });
  ipcMain.handle('easyhub:cancel-archive', (event) => { assertTrustedSender(event); cancelArchive(); });

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
  if (!servicesStoppedForQuit && (binaryAnalysisService || githubProxyService)) {
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void Promise.allSettled([githubProxyService?.destroy(), binaryAnalysisService?.shutdown()]).finally(() => {
      servicesStoppedForQuit = true;
      app.quit();
    });
  }
});
