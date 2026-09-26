import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { join } from 'node:path';
import { authStatus, cancelArchive, cancelDeviceLogin, cancelGithubReads, downloadArchive, downloadReleaseAsset, githubAction, logout, openDownloadedFile, pollDeviceLogin, revealDownloadedArchive, startDeviceLogin } from './services/githubService';
import type { DownloadTransferProgress } from './services/githubService';
import { LocalProjectStore } from './git/LocalProjectStore';
import { LocalProjectService } from './git/LocalProjectService';
import { DiscoveryRootsStore } from './git/LocalProjectDiscovery';
import { ReleasePublishingService } from './services/releasePublishing';
import { FallbackTranslationProvider, GoogleWebTranslationProvider, MyMemoryTranslationProvider, TranslationService } from './services/TranslationService';
import type { TranslationRequest } from '@easyhub/types';

let mainWindow: BrowserWindow | null = null;
let localService: LocalProjectService;
let translationService: TranslationService;
let releaseService: ReleasePublishingService;
const translationJobs = new Map<string, AbortController>();

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('操作来源无效');
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1060,
    minHeight: 700,
    frame: false,
    roundedCorners: true,
    thickFrame: true,
    show: false,
    backgroundColor: '#f7f8fc',
    title: 'EasyHub',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'easyhub.ico')
      : join(__dirname, '../../resources/easyhub.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  localService = new LocalProjectService(new LocalProjectStore(join(app.getPath('userData'), 'local-projects.json')),
    (channel, value) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value); },
    new DiscoveryRootsStore(join(app.getPath('userData'), 'project-search-locations.json')));
  const translateFetch = (url: string, init: RequestInit): Promise<Response> => net.fetch(url, init);
  translationService = new TranslationService(new FallbackTranslationProvider(
    new MyMemoryTranslationProvider(translateFetch), new GoogleWebTranslationProvider(translateFetch)),
  join(app.getPath('userData'), 'translations.json'));
  releaseService = new ReleasePublishingService();
  void localService.startWatching();

  ipcMain.handle('easyhub:window-minimize', (event) => {
    assertTrustedSender(event);
    mainWindow?.minimize();
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
  ipcMain.handle('easyhub:auth-start', (event) => { assertTrustedSender(event); return startDeviceLogin('Ov23lixRW8K0uXzZqwMj'); });
  ipcMain.handle('easyhub:auth-poll', (event) => { assertTrustedSender(event); return pollDeviceLogin(); });
  ipcMain.handle('easyhub:auth-cancel', (event) => { assertTrustedSender(event); cancelDeviceLogin(); });
  ipcMain.handle('easyhub:auth-logout', (event) => { assertTrustedSender(event); return logout(); });
  ipcMain.handle('easyhub:release-choose-files', (event, inline: unknown) => { assertTrustedSender(event); return releaseService.chooseFiles(inline as boolean); });
  ipcMain.handle('easyhub:release-publish', (event, input: unknown) => { assertTrustedSender(event); return releaseService.publish(input, (value) => event.sender.send('easyhub:release-progress', value)); });
  ipcMain.handle('easyhub:release-cancel', (event) => { assertTrustedSender(event); releaseService.cancel(); });
  ipcMain.handle('easyhub:github', (event, action: unknown, ...args: unknown[]) => { assertTrustedSender(event); return githubAction(action, args); });
  ipcMain.handle('easyhub:github-cancel', (event) => { assertTrustedSender(event); cancelGithubReads(); });
  const sendDownloadProgress = (event: Electron.IpcMainInvokeEvent, value: DownloadTransferProgress): void => {
    event.sender.send('easyhub:download-progress', value);
    if (value.percent !== null) event.sender.send('easyhub:archive-progress', value.percent);
  };
  ipcMain.handle('easyhub:download-archive', (event, owner: unknown, repo: unknown, ref: unknown) => { assertTrustedSender(event); return downloadArchive(owner, repo, ref, (value) => sendDownloadProgress(event, value)); });
  ipcMain.handle('easyhub:download-release-asset', (event, owner: unknown, repo: unknown, assetId: unknown) => { assertTrustedSender(event); return downloadReleaseAsset(owner, repo, assetId, (value) => sendDownloadProgress(event, value)); });
  ipcMain.handle('easyhub:reveal-downloaded-archive', (event, path: unknown) => { assertTrustedSender(event); revealDownloadedArchive(path); });
  ipcMain.handle('easyhub:open-downloaded-file', (event, path: unknown) => { assertTrustedSender(event); return openDownloadedFile(path); });
  ipcMain.handle('easyhub:cancel-archive', (event) => { assertTrustedSender(event); cancelArchive(); });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => localService?.stopWatching());
