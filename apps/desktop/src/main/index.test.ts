import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHubProxyStatus } from '@easyhub/types';
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuState } from '../shared/applicationMenu';

const fixture = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const appEvents = new Map<string, (...args: unknown[]) => unknown>();
  const order: string[] = [];
  const clipboard = { writeText: vi.fn((value: string) => { order.push(`copy:${value}`); }) };
  const defaultSession = { setProxy: vi.fn(async () => undefined), setPermissionRequestHandler: vi.fn(), clearHostResolverCache: vi.fn(async () => undefined), resolveProxy: vi.fn(async () => 'DIRECT'), closeAllConnections: vi.fn(async () => undefined), protocol: { handle: vi.fn() } };
  const app = { isPackaged: false, setName: vi.fn(), setPath: vi.fn(), getPath: vi.fn(() => '/tmp/easyhub-main-fixture'),
    requestSingleInstanceLock: vi.fn(() => true), exit: vi.fn(), getVersion: vi.fn(() => '1.0.0'), setAboutPanelOptions: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()), on: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => appEvents.set(name, callback)), quit: vi.fn() };
  const windows: FakeWindow[] = [];
  class FakeWindow {
    webContents = { mainFrame: {}, send: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn(), isDestroyed: () => false };
    once = vi.fn(); on = vi.fn(); show = vi.fn(); loadFile = vi.fn(async () => undefined); loadURL = vi.fn(async () => undefined);
    minimize = vi.fn(); maximize = vi.fn(); unmaximize = vi.fn(); close = vi.fn(); isMaximized = () => false; isDestroyed = () => false;
    isMinimized = vi.fn(() => false); restore = vi.fn(); focus = vi.fn();
    setWindowButtonVisibility = vi.fn(); setWindowButtonPosition = vi.fn();
    constructor(readonly options: unknown) { windows.push(this); }
    static getAllWindows() { return windows; }
  }
  const shell = { openExternal: vi.fn(async (_url: string) => { order.push('browser'); }), openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() };
  const dialog = { showErrorBox: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() };
  const menu = { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((items: unknown) => items) };
  const local = { startWatching: vi.fn(async () => undefined), stopWatching: vi.fn() };
  const aiVaults: unknown[] = [];
  const keyring = vi.fn();
  const hosts = vi.fn();
  const github = Object.fromEntries([
    'authStatus', 'cancelArchive', 'cancelDeviceLogin', 'cancelGithubReads', 'downloadArchive', 'downloadReleaseAsset',
    'downloadPullRequestFile', 'getPullRequestReviewContext', 'githubAction', 'logout', 'openDownloadedFile',
    'pollDeviceLogin', 'revealDownloadedArchive', 'startDeviceLogin', 'loadBinaryAnalysisFile',
  ].map((name) => [name, vi.fn()]));
  const proxies: FakeProxy[] = [];
  const systemAdapters: string[] = [];
  const analysisShutdown = vi.fn(async () => { order.push('analysis-shutdown'); });
  const downloadsShutdown = vi.fn(async () => { order.push('downloads-shutdown'); });
  const downloads = { manager: { list: vi.fn(async () => []), command: vi.fn(async () => undefined),
    clearFinished: vi.fn(async () => undefined), shutdown: downloadsShutdown },
    enqueue: vi.fn(async () => null), open: vi.fn(async () => undefined) };
  class FakeProxy {
    current: GitHubProxyStatus = { enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false };
    status = vi.fn(async () => ({ ...this.current }));
    initialize = vi.fn(async () => undefined);
    isEnabled = vi.fn(() => this.current.enabled);
    setEnabled = vi.fn(async (enabled: boolean) => {
      this.current = { ...this.current, enabled, state: enabled ? 'ready' : 'off' };
      return { ...this.current };
    });
    refresh = vi.fn(async () => ({ ...this.current }));
    cancel = vi.fn();
    fetch = vi.fn(async () => new Response('fixture'));
    destroy = vi.fn(async () => { order.push('proxy-shutdown'); });
    constructor(readonly path: string, readonly dependencies: Record<string, unknown>) { proxies.push(this); }
  }
  return { handlers, appEvents, order, clipboard, defaultSession, app, windows, FakeWindow, shell, dialog, menu,
    local, aiVaults, keyring, hosts, github, proxies, FakeProxy, systemAdapters, analysisShutdown, downloads, downloadsShutdown };
});

vi.mock('electron', () => ({ app: fixture.app, BrowserWindow: fixture.FakeWindow, clipboard: fixture.clipboard,
  dialog: fixture.dialog, ipcMain: { handle: (name: string, callback: (...args: unknown[]) => unknown) => fixture.handlers.set(name, callback) },
  Menu: fixture.menu, net: { fetch: vi.fn() }, session: { defaultSession: fixture.defaultSession }, shell: fixture.shell }));
vi.mock('@napi-rs/keyring', () => ({ AsyncEntry: fixture.keyring }));
vi.mock('./services/githubService', () => fixture.github);
vi.mock('./services/githubDownloads', () => ({ GitHubDownloads: class { constructor() { return fixture.downloads; } } }));
vi.mock('./services/GitHubProxyService', () => ({ GitHubProxyService: fixture.FakeProxy, useGitHubProxy: vi.fn() }));
vi.mock('./services/WindowsSystemProxy', () => ({ WindowsSystemProxy: class { constructor() { fixture.systemAdapters.push('windows'); } } }));
vi.mock('./services/MacSystemProxy', () => ({ MacSystemProxy: class { constructor() { fixture.systemAdapters.push('mac'); } } }));
vi.mock('./services/GitHubSystemRelay', () => ({ GitHubSystemRelay: class {} }));
vi.mock('./analysis/AnalysisRuntime', () => ({ AnalysisRuntime: class { status = vi.fn(async () => ({ state: 'missing' })); } }));
vi.mock('./analysis/BinaryAnalysisService', () => ({ BinaryAnalysisService: class { initialize = vi.fn(async () => {}); shutdown = fixture.analysisShutdown; } }));
vi.mock('./analysis/analysisElectronFetch', () => ({ analysisElectronFetch: vi.fn() }));
vi.mock('./services/hostsRepair', () => ({ HostsRepairService: fixture.hosts }));
vi.mock('./services/AiReviewService', () => ({ AiReviewService: class { constructor(vault: unknown) { fixture.aiVaults.push(vault); } cancelAll() {} } }));
vi.mock('./services/OpenAiReviewProvider', () => ({ OpenAiReviewProvider: class {} }));
vi.mock('./git/LocalProjectStore', () => ({ LocalProjectStore: class {} }));
vi.mock('./git/LocalProjectService', () => ({ LocalProjectService: class { constructor() { return fixture.local; } } }));
vi.mock('./git/LocalProjectDiscovery', () => ({ DiscoveryRootsStore: class {} }));
vi.mock('./services/releasePublishing', () => ({ ReleasePublishingService: class {} }));
vi.mock('./services/TranslationService', () => ({ TranslationService: class {}, FallbackTranslationProvider: class {}, GoogleWebTranslationProvider: class {}, MyMemoryTranslationProvider: class {} }));

const originalPlatform = process.platform;
function trustedEvent() {
  const window = fixture.windows[0]!;
  return { sender: window.webContents, senderFrame: window.webContents.mainFrame };
}
function invoke(name: string, ...args: unknown[]): unknown {
  const handler = fixture.handlers.get(`easyhub:${name}`);
  if (!handler) throw new Error(`Missing IPC: ${name}`);
  return handler(trustedEvent(), ...args);
}
function flow(code = 'LOCAL-1234') { return { userCode: code, verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 600_000, interval: 5 }; }
function state(overrides: Partial<MenuState> = {}): MenuState {
  return { language: 'zh', signedIn: false, busy: false, modalOpen: false, demoOnly: false, ...overrides };
}
function menuItems(): MenuItemConstructorOptions[] {
  return fixture.menu.setApplicationMenu.mock.lastCall?.[0] as MenuItemConstructorOptions[];
}
function findMenuItem(id: string): MenuItemConstructorOptions {
  const find = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      if (Array.isArray(item.submenu)) {
        const nested = find(item.submenu);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  const item = find(menuItems());
  if (!item) throw new Error(`Missing menu item: ${id}`);
  return item;
}
function clickMenuItem(id: string): void {
  const click = findMenuItem(id).click as (() => void) | undefined;
  if (!click) throw new Error(`Missing command callback: ${id}`);
  click();
}
function closeMainWindow(): void {
  const current = fixture.windows[0]!;
  const closed = current.on.mock.calls.find(([event]) => event === 'closed')?.[1] as (() => void) | undefined;
  if (!closed) throw new Error('Missing closed callback');
  closed();
  fixture.windows.length = 0;
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  vi.stubEnv('EASYHUB_TEST_MODE', '1');
  vi.stubEnv('EASYHUB_TEST_USER_DATA', '/tmp/easyhub-main-fixture');
  fixture.handlers.clear(); fixture.appEvents.clear(); fixture.order.length = 0;
  fixture.windows.length = 0; fixture.proxies.length = 0; fixture.aiVaults.length = 0;
  fixture.clipboard.writeText.mockImplementation((value) => { fixture.order.push(`copy:${value}`); });
  fixture.shell.openExternal.mockImplementation(async (_url: string) => { fixture.order.push('browser'); });
  fixture.defaultSession.setProxy.mockResolvedValue(undefined);
  fixture.github.startDeviceLogin!.mockResolvedValue(flow());
  fixture.systemAdapters.length = 0;
  fixture.downloadsShutdown.mockImplementation(async () => { fixture.order.push('downloads-shutdown'); });
  fixture.app.requestSingleInstanceLock.mockReturnValue(true);
  await import('./index');
  await vi.waitFor(() => expect(fixture.windows).toHaveLength(1));
});
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('macOS main-process compatibility', () => {
  it('creates native Mac traffic lights aligned to the custom toolbar without replacing AppKit fullscreen behavior', () => {
    const window = fixture.windows[0]!;
    expect(window.options).toMatchObject({ frame: true, titleBarStyle: 'hidden', trafficLightPosition: { x: 25, y: 29 } });
    expect(window.setWindowButtonVisibility).toHaveBeenCalledWith(true);
    expect(window.options).not.toHaveProperty('fullscreenable', false);
    expect(window.maximize).not.toHaveBeenCalled();
  });

  it('shows or hides native lights for the trusted style setting and keeps the existing Windows-style maximize action', () => {
    const window = fixture.windows[0]!;
    invoke('window-set-style', 'windows');
    expect(window.setWindowButtonVisibility).toHaveBeenLastCalledWith(false);
    invoke('window-toggle-maximize');
    expect(window.maximize).toHaveBeenCalledOnce();
    invoke('window-set-style', 'reference');
    expect(window.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    expect(window.maximize).toHaveBeenCalledOnce();
  });

  it('aligns native lights to compact and comfortable toolbars and reapplies density after reopening', () => {
    const window = fixture.windows[0]!;
    invoke('window-set-style', 'reference', 'compact');
    expect(window.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 16, y: 21 });
    closeMainWindow();
    fixture.appEvents.get('activate')!();
    const reopened = fixture.windows[0]!;
    expect(reopened.options).toMatchObject({ trafficLightPosition: { x: 16, y: 21 } });
    invoke('window-set-style', 'reference', 'comfortable');
    expect(reopened.setWindowButtonPosition).toHaveBeenLastCalledWith({ x: 25, y: 29 });
    expect(reopened.maximize).not.toHaveBeenCalled();
  });

  it('rejects unsupported toolbar density before changing native button appearance or position', () => {
    const window = fixture.windows[0]!;
    window.setWindowButtonVisibility.mockClear();
    window.setWindowButtonPosition.mockClear();
    for (const density of [null, true, {}, 'Compact', 'dense']) {
      expect(() => invoke('window-set-style', 'reference', density)).toThrow('布局无效');
    }
    const handler = fixture.handlers.get('easyhub:window-set-style')!;
    expect(() => handler({ sender: {}, senderFrame: {} }, 'reference', 'compact')).toThrow('来源无效');
    expect(() => handler({ sender: window.webContents, senderFrame: {} }, 'reference', 'compact')).toThrow('来源无效');
    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(window.setWindowButtonPosition).not.toHaveBeenCalled();
  });

  it('rejects invalid styles and foreign window or child-frame callers without changing native controls', () => {
    const window = fixture.windows[0]!;
    window.setWindowButtonVisibility.mockClear();
    for (const invalid of [null, undefined, true, {}, 'mac', 'Reference']) {
      expect(() => invoke('window-set-style', invalid)).toThrow('样式无效');
    }
    const handler = fixture.handlers.get('easyhub:window-set-style')!;
    expect(() => handler({ sender: {}, senderFrame: {} }, 'windows')).toThrow('来源无效');
    expect(() => handler({ sender: window.webContents, senderFrame: {} }, 'windows')).toThrow('来源无效');
    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(window.setWindowButtonPosition).not.toHaveBeenCalled();
  });

  it('reapplies the last style when macOS activation creates a new window', () => {
    const first = fixture.windows[0]!;
    invoke('window-set-style', 'windows');
    const closed = first.on.mock.calls.find(([event]) => event === 'closed')?.[1] as (() => void) | undefined;
    expect(closed).toBeTypeOf('function');
    closed!();
    fixture.windows.length = 0;
    fixture.appEvents.get('activate')!();
    expect(fixture.windows).toHaveLength(1);
    expect(fixture.windows[0]!.setWindowButtonVisibility).toHaveBeenCalledWith(false);
    invoke('window-set-style', 'reference');
    expect(fixture.windows[0]!.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
  });

  it('does not apply Mac title bar options or native button APIs on Windows', async () => {
    vi.resetModules();
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    fixture.windows.length = 0;
    fixture.proxies.length = 0;
    fixture.handlers.clear();
    fixture.appEvents.clear();
    fixture.menu.setApplicationMenu.mockClear();
    fixture.menu.buildFromTemplate.mockClear();
    fixture.app.setAboutPanelOptions.mockClear();
    fixture.hosts.mockImplementation(function () { return { status: async () => ({ enabled: false, updatedAt: null }) }; });
    await import('./index');
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1));
    const window = fixture.windows[0]!;
    expect(window.options).toMatchObject({ frame: false });
    expect(window.options).not.toHaveProperty('titleBarStyle');
    expect(window.options).not.toHaveProperty('trafficLightPosition');
    expect(fixture.proxies).toHaveLength(1);
    invoke('window-set-style', 'reference');
    invoke('window-set-style', 'windows');
    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
    expect(fixture.menu.setApplicationMenu).toHaveBeenCalledExactlyOnceWith(null);
    invoke('menu-state', state({ language: 'en', signedIn: true }));
    expect(fixture.menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(fixture.app.setAboutPanelOptions).not.toHaveBeenCalled();
  });

  it('isolates fixture data and AI credentials, supplies Mac menus, and never constructs Windows Hosts repair', async () => {
    expect(fixture.app.setPath).toHaveBeenCalledWith('userData', '/tmp/easyhub-main-fixture');
    expect(fixture.hosts).not.toHaveBeenCalled();
    expect(fixture.keyring).not.toHaveBeenCalled();
    const vault = fixture.aiVaults[0] as { getPassword(): Promise<string | null>; setPassword(value: string): Promise<void> };
    expect(await vault.getPassword()).toBeNull();
    await vault.setPassword('fixture-only');
    expect(await vault.getPassword()).toBe('fixture-only');
    expect(menuItems().map((item) => item.id)).toEqual(['easyhub-app-menu', 'easyhub-file-menu', 'easyhub-edit-menu',
      'easyhub-view-menu', 'easyhub-window-menu', 'easyhub-help-menu']);
    expect(fixture.app.setAboutPanelOptions).toHaveBeenCalledWith(expect.objectContaining({ applicationName: 'EasyHub', applicationVersion: '1.0.0', credits: 'Apache 2.0 · FuFu-Flash/EasyHub' }));
    await expect(invoke('hosts-set-enabled', true)).rejects.toThrow('请使用设置中的 GitHub 代理');
  });

  it('copies the pairing code before the renderer can request its browser, and permits manual re-copy only for that current code', async () => {
    expect(await invoke('auth-start')).toMatchObject({ userCode: 'LOCAL-1234', verificationUri: 'https://github.com/login/device', codeCopied: true });
    await invoke('open-external-link', 'https://github.com/login/device');
    expect(fixture.order).toEqual(['copy:LOCAL-1234', 'browser']);
    expect(invoke('copy-pairing-code', 'UNRELATED')).toBe(false);
    expect(invoke('copy-pairing-code', 'LOCAL-1234')).toBe(true);
    fixture.github.startDeviceLogin!.mockResolvedValue(flow('LOCAL-5678'));
    await invoke('auth-start');
    expect(invoke('copy-pairing-code', 'LOCAL-1234')).toBe(false);
    expect(invoke('copy-pairing-code', 'LOCAL-5678')).toBe(true);
    invoke('auth-cancel');
    expect(invoke('copy-pairing-code', 'LOCAL-5678')).toBe(false);
  });

  it('reports clipboard failure without preventing device authorization or the browser action', async () => {
    fixture.clipboard.writeText.mockImplementation(() => { throw new Error('Fixture pasteboard denied'); });
    expect(await invoke('auth-start')).toMatchObject({ userCode: 'LOCAL-1234', codeCopied: false });
    await invoke('open-external-link', 'https://github.com/login/device');
    expect(fixture.shell.openExternal).toHaveBeenCalledWith('https://github.com/login/device');
  });

  it('does not copy a pairing response that arrives after cancellation', async () => {
    let deliver!: (value: ReturnType<typeof flow>) => void;
    fixture.github.startDeviceLogin!.mockImplementation(() => new Promise((resolve) => { deliver = resolve; }));
    const pending = invoke('auth-start');
    invoke('auth-cancel');
    deliver(flow());
    expect(await pending).toMatchObject({ codeCopied: false });
    expect(fixture.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('uses the upstream proxy implementation and HTTPS protocol handler without touching OS settings in fixtures', async () => {
    expect(fixture.proxies).toHaveLength(1);
    expect(fixture.proxies[0]!.initialize).toHaveBeenCalledOnce();
    expect(fixture.systemAdapters).toEqual([]);
    expect(fixture.proxies[0]!.dependencies).not.toHaveProperty('systemProxy');
    expect(fixture.defaultSession.protocol.handle).toHaveBeenCalledWith('https', expect.any(Function));
    expect(await invoke('github-proxy-set-enabled', true)).toMatchObject({ enabled: true, state: 'ready' });
    expect(await invoke('github-proxy-set-enabled', false)).toMatchObject({ enabled: false, state: 'off' });
    expect(fixture.defaultSession.setProxy).not.toHaveBeenCalled();
  });

  it('rejects proxy and clipboard calls from a foreign webContents or child frame', () => {
    for (const name of ['github-proxy-status', 'github-proxy-set-enabled', 'copy-pairing-code', 'binary-analysis-status', 'binary-analyze']) {
      const handler = fixture.handlers.get(`easyhub:${name}`)!;
      expect(() => handler({ sender: {}, senderFrame: {} }, 'LOCAL-1234')).toThrow('来源无效');
      expect(() => handler({ sender: fixture.windows[0]!.webContents, senderFrame: {} }, 'LOCAL-1234')).toThrow('来源无效');
    }
    expect(() => invoke('github-proxy-set-enabled', 'yes')).toThrow('设置无效');
  });

  it('waits for analysis, system proxy and downloads before completing application quit', async () => {
    let finish!: () => void;
    let finishDownloads!: () => void;
    fixture.proxies[0]!.destroy.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    fixture.downloadsShutdown.mockImplementation(() => new Promise<void>((resolve) => { finishDownloads = resolve; }));
    const event = { preventDefault: vi.fn() };
    fixture.appEvents.get('before-quit')!(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.proxies[0]!.destroy).toHaveBeenCalledOnce();
    expect(fixture.analysisShutdown).toHaveBeenCalledOnce();
    expect(fixture.downloadsShutdown).toHaveBeenCalledOnce();
    expect(fixture.app.quit).not.toHaveBeenCalled();
    fixture.appEvents.get('before-quit')!(event);
    expect(fixture.proxies[0]!.destroy).toHaveBeenCalledOnce();
    expect(fixture.downloadsShutdown).toHaveBeenCalledOnce();
    finish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fixture.app.quit).not.toHaveBeenCalled();
    finishDownloads();
    await vi.waitFor(() => expect(fixture.app.quit).toHaveBeenCalledOnce());
    const finalQuit = { preventDefault: vi.fn() };
    fixture.appEvents.get('before-quit')!(finalQuit);
    expect(finalQuit.preventDefault).not.toHaveBeenCalled();
    expect(fixture.downloadsShutdown).toHaveBeenCalledOnce();
  });

  it('routes downloads through the new service only for the main window frame', async () => {
    const request = { kind: 'archive', repo: { id: 1, name: 'app', owner: { login: 'owner' } }, ref: 'main' };
    await invoke('downloads-list');
    await invoke('downloads-enqueue', request);
    await invoke('downloads-command', 'fixture-task', 'pause');
    await invoke('downloads-clear');
    await invoke('downloads-open', 'fixture-task', true);
    expect(fixture.downloads.manager.list).toHaveBeenCalledOnce();
    expect(fixture.downloads.enqueue).toHaveBeenCalledExactlyOnceWith(request);
    expect(fixture.downloads.manager.command).toHaveBeenCalledExactlyOnceWith('fixture-task', 'pause');
    expect(fixture.downloads.manager.clearFinished).toHaveBeenCalledOnce();
    expect(fixture.downloads.open).toHaveBeenCalledExactlyOnceWith('fixture-task', true);
    for (const name of ['downloads-list', 'downloads-enqueue', 'downloads-command', 'downloads-clear', 'downloads-open']) {
      const handler = fixture.handlers.get(`easyhub:${name}`)!;
      expect(() => handler({ sender: {}, senderFrame: {} }, request)).toThrow('来源无效');
      expect(() => handler({ sender: fixture.windows[0]!.webContents, senderFrame: {} }, request)).toThrow('来源无效');
    }
    expect(fixture.downloads.enqueue).toHaveBeenCalledOnce();
  });

  it('selects the macOS system proxy adapter in production while preserving the native window and menu', async () => {
    vi.resetModules();
    vi.stubEnv('EASYHUB_TEST_MODE', '0');
    fixture.windows.length = 0;
    fixture.proxies.length = 0;
    await import('./index');
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1));
    expect(fixture.systemAdapters).toEqual(['mac']);
    expect(fixture.proxies[0]!.dependencies).toHaveProperty('systemProxy');
    expect(fixture.proxies[0]!.dependencies).toHaveProperty('systemRelay');
    expect(fixture.hosts).not.toHaveBeenCalled();
    expect(fixture.windows[0]!.options).toMatchObject({ frame: true, titleBarStyle: 'hidden' });
  });

  it('waits for a validated renderer state and disables account-only commands in Demo mode', () => {
    expect(findMenuItem('easyhub-home').enabled).toBe(false);
    expect(findMenuItem('easyhub-settings').enabled).toBe(true);
    clickMenuItem('easyhub-home');
    expect(fixture.windows[0]!.webContents.send).not.toHaveBeenCalledWith('easyhub:menu-command', 'home');
    invoke('menu-state', state({ demoOnly: true }));
    for (const command of ['home', 'projects', 'issues', 'profile', 'settings', 'new-project', 'add-folder', 'download-project', 'search', 'proxy-settings']) {
      expect(findMenuItem(`easyhub-${command}`).enabled).toBe(true);
    }
    for (const command of ['discover', 'reviews', 'starred', 'refresh']) {
      expect(findMenuItem(`easyhub-${command}`).enabled).toBe(false);
      clickMenuItem(`easyhub-${command}`);
    }
    expect(fixture.windows[0]!.webContents.send).not.toHaveBeenCalled();
    // A malformed combination must not turn Demo into an authenticated workspace.
    invoke('menu-state', state({ signedIn: true, demoOnly: true }));
    expect(findMenuItem('easyhub-discover').enabled).toBe(false);
    expect(findMenuItem('easyhub-profile').enabled).toBe(true);
  });

  it('rejects incomplete, mistyped or extra state fields and untrusted frames without marking the renderer ready', () => {
    for (const value of [null, [], {}, { ...state(), language: 'fr' }, { ...state(), busy: 1 },
      { ...state(), signedIn: 'true' }, { language: 'zh', signedIn: true, busy: false, modalOpen: false },
      { ...state(), unexpected: true }]) {
      expect(() => invoke('menu-state', value)).toThrow('菜单状态无效');
    }
    const handler = fixture.handlers.get('easyhub:menu-state')!;
    expect(() => handler({ sender: {}, senderFrame: {} }, state())).toThrow('来源无效');
    expect(() => handler({ sender: fixture.windows[0]!.webContents, senderFrame: {} }, state())).toThrow('来源无效');
    expect(findMenuItem('easyhub-home').enabled).toBe(false);
  });

  it('localizes native menus and sends only permitted navigation commands to the main renderer', () => {
    invoke('menu-state', state({ language: 'en', signedIn: true }));
    expect(menuItems().map((item) => item.label)).toEqual(['EasyHub', 'File', 'Edit', 'View', 'Window', 'Help']);
    expect(findMenuItem('easyhub-settings')).toMatchObject({ label: 'Settings…', accelerator: 'Command+,' });
    expect(findMenuItem('easyhub-search').accelerator).toBe('Command+F');
    expect(findMenuItem('easyhub-refresh').accelerator).toBe('Command+R');
    expect(findMenuItem('easyhub-reviews')).toMatchObject({ label: 'Pull Request Reviews', accelerator: 'Command+5' });
    expect(findMenuItem('easyhub-about').role).toBe('about');
    clickMenuItem('easyhub-reviews');
    expect(fixture.windows[0]!.webContents.send).toHaveBeenCalledExactlyOnceWith('easyhub:menu-command', 'reviews');
    expect(fixture.windows[0]!.focus).toHaveBeenCalledOnce();
    invoke('menu-state', state({ signedIn: true }));
    expect(menuItems().map((item) => item.label)).toEqual(['EasyHub', '文件', '编辑', '显示', '窗口', '帮助']);
    expect(findMenuItem('easyhub-reviews').label).toBe('合并请求审查');
    clickMenuItem('easyhub-project-home');
    clickMenuItem('easyhub-feedback');
    expect(fixture.shell.openExternal.mock.calls.map(([url]) => url)).toEqual([
      'https://github.com/FuFu-Flash/EasyHub', 'https://github.com/FuFu-Flash/EasyHub/issues/new/choose',
    ]);
    expect(fixture.github.authStatus).not.toHaveBeenCalled();
  });

  it('gates busy actions and blocks stale navigation callbacks while leaving native edit and window roles available', () => {
    invoke('menu-state', state({ signedIn: true }));
    const staleHomeClick = findMenuItem('easyhub-home').click as () => void;
    invoke('menu-state', state({ signedIn: true, busy: true }));
    for (const command of ['new-project', 'add-folder', 'download-project', 'refresh']) {
      expect(findMenuItem(`easyhub-${command}`).enabled).toBe(false);
    }
    expect(findMenuItem('easyhub-home').enabled).toBe(true);
    clickMenuItem('easyhub-home');
    expect(fixture.windows[0]!.webContents.send).toHaveBeenCalledExactlyOnceWith('easyhub:menu-command', 'home');
    fixture.windows[0]!.webContents.send.mockClear();
    invoke('menu-state', state({ signedIn: true, modalOpen: true }));
    for (const command of ['home', 'projects', 'discover', 'issues', 'reviews', 'starred', 'profile', 'settings',
      'new-project', 'add-folder', 'download-project', 'search', 'refresh', 'proxy-settings']) {
      expect(findMenuItem(`easyhub-${command}`).enabled).toBe(false);
    }
    staleHomeClick();
    expect(fixture.windows[0]!.webContents.send).not.toHaveBeenCalled();
    const edit = findMenuItem('easyhub-edit-menu').submenu as MenuItemConstructorOptions[];
    const window = findMenuItem('easyhub-window-menu').submenu as MenuItemConstructorOptions[];
    expect(edit.find((item) => item.role === 'copy')).toMatchObject({ role: 'copy', accelerator: 'Command+C' });
    expect(edit.find((item) => item.role === 'copy')?.enabled).not.toBe(false);
    expect(window.find((item) => item.role === 'minimize')?.enabled).not.toBe(false);
  });

  it('shows a localized native error instead of silently ignoring failed Help browser actions', async () => {
    fixture.shell.openExternal.mockRejectedValue(new Error('Fixture browser refused'));
    clickMenuItem('easyhub-project-home');
    await vi.waitFor(() => expect(fixture.dialog.showErrorBox).toHaveBeenCalledExactlyOnceWith(
      '无法打开浏览器', '请检查默认浏览器设置，然后重试。'));
    invoke('menu-state', state({ language: 'en' }));
    clickMenuItem('easyhub-feedback');
    await vi.waitFor(() => expect(fixture.dialog.showErrorBox).toHaveBeenLastCalledWith(
      'Could not open the browser', 'Check your default browser and try again.'));
  });

  it('reopens a closed window, preserves language and buffers only the latest settings command until ready', () => {
    invoke('menu-state', state({ language: 'en', signedIn: true }));
    closeMainWindow();
    expect(findMenuItem('easyhub-discover').enabled).toBe(false);
    expect(findMenuItem('easyhub-settings').label).toBe('Settings…');
    clickMenuItem('easyhub-settings');
    expect(fixture.windows).toHaveLength(1);
    const second = fixture.windows[0]!;
    expect(second.loadFile).toHaveBeenCalledOnce();
    expect(second.focus).toHaveBeenCalledOnce();
    clickMenuItem('easyhub-proxy-settings');
    expect(second.webContents.send).not.toHaveBeenCalled();
    invoke('menu-state', state({ language: 'en', signedIn: true }));
    expect(second.webContents.send).toHaveBeenCalledExactlyOnceWith('easyhub:menu-command', 'proxy-settings');
    invoke('menu-state', state({ language: 'en', signedIn: true }));
    expect(second.webContents.send).toHaveBeenCalledOnce();
  });

  it('restores the minimized window from the Window menu without inventing a renderer command', () => {
    const window = fixture.windows[0]!;
    window.isMinimized.mockReturnValue(true);
    clickMenuItem('easyhub-show-window');
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(window.webContents.send).not.toHaveBeenCalled();
    closeMainWindow();
    clickMenuItem('easyhub-show-window');
    expect(fixture.windows).toHaveLength(1);
    invoke('menu-state', state());
    expect(fixture.windows[0]!.webContents.send).not.toHaveBeenCalled();
  });

  it('clears stale authenticated menu state on a main-frame reload but not on in-page or child navigation', () => {
    invoke('menu-state', state({ signedIn: true }));
    const navigation = fixture.windows[0]!.webContents.on.mock.calls.find(([name]) => name === 'did-start-navigation')?.[1] as
      ((_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => void) | undefined;
    expect(navigation).toBeTypeOf('function');
    navigation!({}, 'file:///fixture', true, true);
    expect(findMenuItem('easyhub-discover').enabled).toBe(true);
    navigation!({}, 'file:///fixture', false, false);
    expect(findMenuItem('easyhub-discover').enabled).toBe(true);
    navigation!({}, 'file:///fixture', false, true);
    expect(findMenuItem('easyhub-discover').enabled).toBe(false);
    expect(findMenuItem('easyhub-home').enabled).toBe(false);
    expect(findMenuItem('easyhub-settings').enabled).toBe(true);
  });
});
