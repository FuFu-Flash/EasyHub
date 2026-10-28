import type { StaticMessageKey } from '../localization';
import type { GitHubCreatedRelease, GitHubReleaseAsset } from '@easyhub/github';
import type {
  AiSettingsStatus,
  BinaryAnalysisResult,
  BinaryAnalysisSettingsStatus,
  GitHubProxyStatus,
  PickedReleaseFile,
  ReleaseProgress,
} from '@easyhub/types';
import type { DownloadItem } from '../../../downloads';
import type { EasyHubBridge } from '../bridge';
import { aiProvider } from '../../../shared/aiProviders';
import { sensitiveFileReasons } from '../../../shared/sensitiveFiles';
import { copy, createDemoState, DEMO_USER, demoCommit, sha, type DemoLocal } from './demoData';
import { demoError, demoGithub, findRepository, writable } from './demoGithub';

export type DemoNotice = { key: StaticMessageKey };
type Notice = DemoNotice;
function signal<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe: (callback: (value: T) => void) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    emit: (value: T) => {
      for (const callback of listeners) callback(copy(value));
    },
    clear: () => listeners.clear(),
  };
}
type EventValue<K extends keyof EasyHubBridge> = EasyHubBridge[K] extends
  ((callback: (value: infer T) => void) => unknown) | undefined
  ? T
  : never;

/** A complete, per-workspace simulator. No network, files, native auth, keys or proxy writes. */
export function createDemoBridge(
  native?: Pick<
    EasyHubBridge,
    | 'minimizeWindow'
    | 'toggleMaximizeWindow'
    | 'closeWindow'
    | 'onNavigate'
    | 'openLicense'
    | 'platform'
    | 'setWindowControlStyle'
    | 'setMenuState'
    | 'onMenuCommand'
  >,
) {
  const state = createDemoState();
  const folders = new Map(state.locals.map((item) => [item.link.localPath, item]));
  const grants = new Set(folders.keys());
  const memoryStorage = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStorage.delete(key);
    },
  };
  const notices = signal<Notice>();
  const localEvents = signal<EventValue<'onLocalStatus'>>();
  const localProgress = signal<EventValue<'onLocalProgress'>>();
  const downloadsChanged = signal<DownloadItem[]>();
  const releaseProgress = signal<ReleaseProgress>();
  const aiProgress = signal<EventValue<'onAiReviewProgress'>>();
  const analysisProgress = signal<EventValue<'onBinaryAnalysisProgress'>>();
  const translationProgress = signal<EventValue<'onTranslationProgress'>>();
  const archiveProgress = signal<number>();
  const downloadProgress = signal<EventValue<'onDownloadProgress'>>();
  const nativeStops = new Set<() => void>();
  const jobs = new Map<string, AbortController>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const downloads: DownloadItem[] = [];
  const picked = new Map<string, PickedReleaseFile>();
  const roots: string[] = [];
  const reports: unknown[] = [];
  let disposed = false;
  let folderNumber = 0;
  let signedIn = true;
  let loginStarted = false;
  let ai: AiSettingsStatus = {
    providerId: 'openai',
    baseUrl: aiProvider('openai')!.baseUrl,
    model: aiProvider('openai')!.defaultModel,
    hasApiKey: true,
  };
  let analysisStatus: BinaryAnalysisSettingsStatus = {
    installed: false,
    state: 'missing',
    engineVersion: 'Demo',
    downloadBytes: 1024,
  };
  let proxy: GitHubProxyStatus = {
    enabled: false,
    state: 'off',
    checkedAt: null,
    error: null,
    checks: [],
    legacyHosts: false,
    system: { mode: 'off' },
  };
  const next = (): number => ++state.nextId;
  const notify = (key: StaticMessageKey): void => notices.emit({ key });
  const assertActive = (): void => {
    if (disposed) throw demoError('演示会话已结束，请重新打开。');
  };
  function local(id: string): DemoLocal {
    assertActive();
    const item = state.locals.find((entry) => entry.link.id === id);
    if (!item) throw demoError('找不到这个本地项目。', 'NOT_FOUND');
    return item;
  }
  function status(item: DemoLocal) {
    return {
      files: item.files.map((file) => ({
        ...file,
        sensitiveReasons: file.sensitiveReasons ?? sensitiveFileReasons(file.path),
      })),
      needsReview: false,
      branch: 'main',
      pushable: false,
    };
  }
  function snapshot(item: DemoLocal) {
    return { ...status(item), snapshot: sha(item.revision) + sha(item.link.repositoryId).slice(-24) };
  }
  function emitLocal(item: DemoLocal): void {
    localEvents.emit({ id: item.link.id, status: status(item) });
  }
  function addLocal(owner: string, name: string, path: string): DemoLocal {
    const repository = findRepository(state, owner, name);
    const prior = state.locals.find((entry) => entry.link.localPath === path);
    if (prior) {
      if (prior.link.repositoryId !== repository.repo.id) throw demoError('这个文件夹已经添加到另一个本地项目。');
      return prior;
    }
    const item: DemoLocal = {
      link: {
        id: `demo-local-${next()}`,
        repositoryId: repository.repo.id,
        owner,
        name,
        localPath: path,
        lastOpenedAt: new Date().toISOString(),
      },
      files: [],
      revision: 1,
      remote: false,
      readme: repository.readme,
    };
    state.locals.push(item);
    folders.set(path, item);
    grants.add(path);
    return item;
  }
  async function operation<T>(key: string, work: () => T): Promise<T> {
    assertActive();
    if (jobs.has(key)) throw demoError('这个操作正在进行，请稍候。');
    const controller = new AbortController();
    jobs.set(key, controller);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 40);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(demoError('操作已取消。'));
          },
          { once: true },
        );
      });
      assertActive();
      controller.signal.throwIfAborted();
      return copy(work());
    } finally {
      if (jobs.get(key) === controller) jobs.delete(key);
    }
  }
  const cancel = (key: string): void => {
    jobs.get(key)?.abort();
  };
  const release = (owner: string, repo: string, id: number): GitHubCreatedRelease => {
    const entry = findRepository(state, owner, repo);
    writable(entry);
    const value = entry.releases.find((item) => item.id === id);
    if (!value) throw demoError('找不到这个发行版。', 'NOT_FOUND');
    return value;
  };
  function assets(ids: string[], existing: GitHubReleaseAsset[] = []): GitHubReleaseAsset[] {
    if (new Set(ids).size !== ids.length) throw demoError('不能重复添加同一个文件。');
    const files = ids.map((id) => {
      const file = picked.get(id);
      if (!file) throw demoError('请重新选择要上传的文件。');
      return file;
    });
    if (
      new Set([...existing.map((entry) => entry.name), ...files.map((entry) => entry.name)]).size !==
      existing.length + files.length
    )
      throw demoError('发行版中已有同名文件，请先删除旧文件。');
    return files.map((file) => ({
      id: next(),
      name: file.name,
      label: null,
      size: file.size,
      content_type: file.mimeType,
      state: 'uploaded',
      download_count: 0,
    }));
  }
  function finishDownload(item: DownloadItem): void {
    if (disposed || item.state !== 'running') return;
    item.loaded = item.total ?? 1024;
    item.percent = 100;
    item.state = 'complete';
    item.seen = false;
    item.bytesPerSecond = null;
    item.phase = '演示下载已完成';
    item.path = `demo://downloads/${item.id}/${item.request.fileName}`;
    if (item.request.kind === 'project') {
      const link = addLocal(
        item.request.repo.owner.login,
        item.request.repo.name,
        `C:/EasyHub Demo/Downloads/${item.request.repo.name}`,
      );
      item.localLinkId = link.link.id;
      item.path = link.link.localPath;
    }
    if (item.request.kind === 'archive' && item.request.offerAdd) {
      const folder = addLocal(
        item.request.repo.owner.login,
        item.request.repo.name,
        `C:/EasyHub Demo/Downloads/${item.id}`,
      );
      state.locals = state.locals.filter((entry) => entry !== folder);
      item.path = folder.link.localPath;
    }
    timers.delete(item.id);
    downloadsChanged.emit(downloads);
  }
  const scheduleDownload = (item: DownloadItem): void => {
    item.state = 'running';
    timers.set(
      item.id,
      setTimeout(() => finishDownload(item), 180),
    );
    downloadsChanged.emit(downloads);
  };
  const simulatedAi = (language: 'zh' | 'en' = 'zh'): string =>
    language === 'en'
      ? 'Demo result: the change updates the selected code. Review its inputs, error handling and permissions before merging. No code was sent to an AI service.'
      : '演示结果：这次修改调整了选中的代码。合入前应检查输入、错误处理和权限。没有向 AI 服务发送代码。';
  const limited = (language: 'zh' | 'en' = 'zh'): string[] => [
    language === 'en'
      ? 'Simulated output for exploring the interface; no actual analysis was performed.'
      : '这是体验界面的模拟结果，没有执行实际审查。',
  ];
  const explanation = (id: string, language: 'zh' | 'en') =>
    operation(id, () => ({ explanation: simulatedAi(language), model: ai.model }));
  const api: Required<EasyHubBridge> = {
    platform: native?.platform ?? 'win32',
    setWindowControlStyle: async (style, density) => {
      await native?.setWindowControlStyle?.(style, density);
    },
    setMenuState: async (value) => {
      await native?.setMenuState?.(value);
    },
    onMenuCommand: (callback) => native?.onMenuCommand?.(callback) ?? (() => undefined),
    copyPairingCode: async () => false,
    macProxy: {
      status: async () => ({ status: 'disconnected', pacURL: 'http://127.0.0.1:8869/github.pac', socksPort: 8868 }),
      setEnabled: async () => ({ status: 'disconnected', pacURL: 'http://127.0.0.1:8869/github.pac', socksPort: 8868 }),
      probe: async () => ({ status: 'disconnected', pacURL: 'http://127.0.0.1:8869/github.pac', socksPort: 8868 }),
      openSettings: async () => ({
        status: 'disconnected',
        pacURL: 'http://127.0.0.1:8869/github.pac',
        socksPort: 8868,
      }),
      onChanged: () => () => undefined,
    },
    reportRendererError: async (report) => {
      reports.push(copy(report));
    },
    onNavigate: (callback) => {
      const stop = native?.onNavigate?.(callback) ?? (() => undefined);
      nativeStops.add(stop);
      return () => {
        nativeStops.delete(stop);
        stop();
      };
    },
    minimizeWindow: async () => {
      await native?.minimizeWindow();
    },
    toggleMaximizeWindow: async () => {
      await native?.toggleMaximizeWindow();
    },
    closeWindow: async () => {
      await native?.closeWindow();
    },
    openLicense: async () => {
      await native?.openLicense();
    },
    authStatus: async () => ({
      state: signedIn ? 'signed-in' : 'signed-out',
      user: signedIn ? copy(DEMO_USER) : null,
      clientId: 'demo',
    }),
    authStart: async () => {
      loginStarted = true;
      return {
        userCode: 'DEMO-0000',
        verificationUri: 'https://github.com/login/device',
        expiresAt: Date.now() + 600000,
        interval: 1,
      };
    },
    authStartDeletion: async () => api.authStart(),
    authPoll: async () => {
      if (!loginStarted) return { state: 'waiting' };
      signedIn = true;
      loginStarted = false;
      return { state: 'complete', user: copy(DEMO_USER) };
    },
    authCancel: async () => {
      loginStarted = false;
    },
    authLogout: async () => {
      signedIn = false;
    },
    github: async <T>(action: string, ...args: unknown[]): Promise<T> => {
      assertActive();
      return copy(demoGithub(state, action, ...args)) as T;
    },
    cancelGithubReads: async () => undefined,
    chooseFolder: async () => {
      const path = `C:/EasyHub Demo/NewProject-${++folderNumber}`;
      grants.add(path);
      return path;
    },
    localList: async () => copy(state.locals.map((entry) => entry.link)),
    localStatus: async (id) => copy(status(local(id))),
    localPreviewChanges: async (id) => copy(snapshot(local(id))),
    localRelocate: async (id, path) => {
      const item = local(id);
      if (!grants.has(path)) throw demoError('请先选择演示文件夹。');
      const occupied = folders.get(path);
      if (occupied && occupied !== item) throw demoError('这个文件夹属于另一个项目。');
      folders.delete(item.link.localPath);
      item.link.localPath = path;
      folders.set(path, item);
      item.revision++;
      return copy(item.link);
    },
    localRemove: async (id) => {
      local(id);
      state.locals = state.locals.filter((entry) => entry.link.id !== id);
    },
    localInspect: async (path) => {
      const existing = folders.get(path);
      return existing
        ? { path, state: 'github', owner: existing.link.owner, name: existing.link.name }
        : { path, state: 'new' };
    },
    localConnect: async (path) => {
      const item = folders.get(path);
      if (!item) throw demoError('这个演示文件夹还没有连接项目，请先创建项目。');
      if (!state.locals.some((entry) => entry.link.id === item.link.id)) state.locals.push(item);
      return copy(item.link);
    },
    localCreate: async (path, name, description, privateRepo) => {
      if (!grants.has(path)) throw demoError('请先选择演示文件夹。');
      if (folders.has(path)) throw demoError('这个文件夹已经连接项目。');
      const repo = demoGithub(state, 'createRepo', name, description, privateRepo) as {
        owner: { login: string };
        name: string;
      };
      const item = addLocal(repo.owner.login, repo.name, path);
      item.readme = '';
      item.files = [{ path: 'README.md', kind: 'added' }];
      return copy(item.link);
    },
    localDownload: async (owner, name, parent) => copy(addLocal(owner, name, `${parent}/${name}`).link),
    localFileDiff: async (id, path, expected) => {
      const item = local(id);
      if (snapshot(item).snapshot !== expected) throw demoError('文件已发生变化，请重新读取。', 'CONFLICT');
      const file = item.files.find((entry) => entry.path === path);
      if (!file) throw demoError('找不到这个修改文件。');
      if (/\.(png|jpg|gif|exe|zip)$/iu.test(path))
        return { path, kind: file.kind, lines: [], additions: 0, deletions: 0, unavailable: 'binary' };
      return {
        path,
        kind: file.kind,
        additions: file.kind === 'deleted' ? 0 : 1,
        deletions: file.kind === 'added' ? 0 : 1,
        lines: [
          ...(file.kind === 'added' ? [] : [{ kind: 'deleted' as const, text: '// Original demo content', before: 1 }]),
          ...(file.kind === 'deleted'
            ? []
            : [
                {
                  kind: 'added' as const,
                  text: path === '.env' ? 'DEMO_ONLY=true' : '// Updated demo content',
                  after: 1,
                },
              ]),
        ],
      };
    },
    localCancelPreview: async () => undefined,
    localPublish: async (id, message, selection) =>
      operation('local', () => {
        const item = local(id);
        const repo = findRepository(state, item.link.owner, item.link.name);
        writable(repo);
        if (!selection || snapshot(item).snapshot !== selection.snapshot)
          throw demoError('请重新查看并选择本次发布的文件。', 'CONFLICT');
        const batches = selection.batches ?? [{ paths: selection.paths, message }];
        if (
          !message.trim() ||
          !selection.paths.length ||
          new Set(selection.paths).size !== selection.paths.length ||
          selection.paths.some((path) => !item.files.some((file) => file.path === path)) ||
          batches.map((batch) => batch.paths.join('\n')).join('\n') !== selection.paths.join('\n') ||
          batches.some((batch) => !batch.paths.length)
        )
          throw demoError('请填写说明，并选择有效的修改文件。');
        const chosen = status(item).files.filter((file) => selection.paths.includes(file.path));
        if (chosen.some((file) => file.sensitiveReasons.length) && !selection.sensitiveConfirmed)
          throw demoError('[SENSITIVE_FILES] 请确认可能包含密码或密钥的文件。');
        item.files = item.files.filter((file) => !selection.paths.includes(file.path));
        item.revision++;
        for (const batch of batches) repo.commits.unshift(demoCommit(next(), batch.message?.trim() || message, batch.paths));
        repo.repo.updated_at = new Date().toISOString();
        if (selection.paths.includes('README.md')) repo.readme = item.readme;
        emitLocal(item);
        localProgress.emit({ phase: '演示发布完成', loaded: 1, total: 1, cancelable: false });
        return { changed: chosen.length };
      }),
    localPushBranch: async () => ({ state: 'current', branch: 'main' }),
    localCheckSync: async (id) => {
      const item = local(id);
      return {
        state: !item.remote ? 'current' : item.files.length ? 'review' : 'ready',
        remoteRevision: sha(item.revision),
        changedFiles: item.remote ? 1 : 0,
        files:
          item.remote && item.files.length
            ? item.files.map((file) => ({
                path: file.path,
                mine: item.readme,
                github: findRepository(state, item.link.owner, item.link.name).readme,
                previewable: true,
              }))
            : [],
      };
    },
    localSync: async (id, revision, decisions) => {
      const item = local(id);
      if (revision && revision !== sha(item.revision)) throw demoError('修改内容已更新，请重新检查。', 'CONFLICT');
      if (item.remote && item.files.length) {
        if (
          item.files.some(
            (file) =>
              !decisions.some((choice) => choice.path === file.path && ['mine', 'github'].includes(choice.choice)),
          )
        )
          throw demoError('请先选择每个文件要保留的内容。');
        for (const choice of decisions)
          if (choice.choice === 'github') {
            item.files = item.files.filter((file) => file.path !== choice.path);
            if (choice.path === 'README.md')
              item.readme = findRepository(state, item.link.owner, item.link.name).readme;
          }
      }
      const updated = item.remote ? 1 : 0;
      item.remote = false;
      item.revision++;
      emitLocal(item);
      return { updated };
    },
    localCancel: async () => {
      cancel('local');
    },
    localOpenFolder: async (id) => {
      local(id);
      notify('demo.notice1');
    },
    localReadIntroduction: async (id) => local(id).readme,
    localSaveIntroduction: async (id, expected, content) => {
      const item = local(id);
      if (item.readme !== expected) throw demoError('项目介绍已变化，请重新打开编辑。', 'CONFLICT');
      item.readme = content;
      item.revision++;
      if (!item.files.some((file) => file.path === 'README.md'))
        item.files.push({ path: 'README.md', kind: 'modified' });
      emitLocal(item);
    },
    localDiscoveryRoots: async () => [...roots],
    localDiscoveryAddRoot: async (path) => {
      if (!roots.includes(path)) roots.push(path);
      return [...roots];
    },
    localDiscoveryRemoveRoot: async (path) => {
      const index = roots.indexOf(path);
      if (index >= 0) roots.splice(index, 1);
      return [...roots];
    },
    localDiscoveryScan: async () => ({
      added: 0,
      alreadyAdded: state.locals.length,
      scanned: state.locals.length,
      skipped: 0,
      limited: false,
    }),
    onLocalStatus: localEvents.subscribe,
    onLocalProgress: localProgress.subscribe,
    downloadsList: async () => copy(downloads),
    downloadsEnqueue: async (request) => {
      findRepository(state, request.repo.owner.login, request.repo.name);
      const item: DownloadItem = {
        id: `demo-download-${next()}`,
        request: copy(request),
        state: 'queued',
        percent: 0,
        loaded: 0,
        total: 1024,
        bytesPerSecond: null,
        phase: '正在准备演示下载',
        seen: true,
      };
      downloads.unshift(item);
      scheduleDownload(item);
      return copy(item);
    },
    downloadsCommand: async (id, command) => {
      const item = downloads.find((entry) => entry.id === id);
      if (!item) throw demoError('找不到这个演示下载。');
      clearTimeout(timers.get(id));
      timers.delete(id);
      if (command === 'seen') item.seen = true;
      else if (command === 'remove') downloads.splice(downloads.indexOf(item), 1);
      else if (command === 'pause') {
        if (item.state === 'running') item.state = 'paused';
      } else if (command === 'cancel') {
        if (!['complete', 'cancelled'].includes(item.state)) {
          item.state = 'cancelled';
          item.seen = false;
        }
      } else if (command === 'resume' && ['paused', 'failed', 'cancelled'].includes(item.state)) scheduleDownload(item);
      downloadsChanged.emit(downloads);
    },
    downloadsClear: async () => {
      for (let index = downloads.length - 1; index >= 0; index--)
        if (['complete', 'failed', 'cancelled'].includes(downloads[index]!.state)) downloads.splice(index, 1);
      downloadsChanged.emit(downloads);
    },
    downloadsOpen: async (id) => {
      if (!downloads.some((entry) => entry.id === id && entry.state === 'complete'))
        throw demoError('这个下载还没有完成。');
      notify('demo.notice2');
    },
    onDownloadsChanged: downloadsChanged.subscribe,
    downloadArchive: async (owner, repo) => {
      findRepository(state, owner, repo);
      archiveProgress.emit(100);
      downloadProgress.emit({ loaded: 1024, total: 1024, percent: 100 });
      return `demo://archives/${repo}.zip`;
    },
    downloadReleaseAsset: async (owner, repo, assetId) => {
      const item = findRepository(state, owner, repo);
      const asset = item.releases.flatMap((entry) => entry.assets).find((entry) => entry.id === assetId);
      if (!asset) throw demoError('找不到这个发行文件。');
      return `demo://downloads/${asset.name}`;
    },
    downloadPullRequestFile: async (owner, repo, number, path, headSha) => {
      demoGithub(state, 'pullReviewContext', owner, repo, number, headSha);
      return `demo://files/${encodeURIComponent(path)}`;
    },
    revealDownloadedArchive: async () => {
      notify('demo.notice3');
    },
    openDownloadedFile: async () => {
      notify('demo.notice4');
    },
    cancelArchive: async () => {
      cancel('archive');
    },
    onArchiveProgress: archiveProgress.subscribe,
    onDownloadProgress: downloadProgress.subscribe,
    chooseReleaseFiles: async (inline) => {
      const file: PickedReleaseFile = {
        id: `demo-picked-${next()}`,
        name: inline ? `screenshot-${state.nextId}.png` : `demo-file-${state.nextId}.zip`,
        size: 1024,
        mimeType: inline ? 'image/png' : 'application/zip',
        ...(inline
          ? {
              previewDataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
            }
          : {}),
      };
      picked.set(file.id, file);
      return [copy(file)];
    },
    publishRelease: async (input) =>
      operation('release', () => {
        const item = findRepository(state, input.owner, input.repo);
        writable(item);
        if (item.releases.some((entry) => entry.tag_name === input.tagName))
          throw demoError('这个版本号已经发布，请换一个版本号。', 'CONFLICT');
        const added = assets(input.assetIds);
        const result: GitHubCreatedRelease = {
          id: next(),
          tag_name: input.tagName,
          name: input.title,
          body: input.body,
          draft: false,
          prerelease: input.channel !== 'stable',
          published_at: new Date().toISOString(),
          assets: added,
          upload_url: 'demo://uploads',
          html_url: `${item.repo.html_url}/releases/tag/${encodeURIComponent(input.tagName)}`,
        };
        item.releases.unshift(result);
        releaseProgress.emit({
          phase: '演示发行版已发布',
          loaded: added.length,
          total: added.length,
          cancelable: false,
        });
        return result;
      }),
    editRelease: async (input) =>
      operation('release', () => {
        const result = release(input.owner, input.repo, input.releaseId);
        result.name = input.title;
        result.body = input.body;
        result.prerelease = input.prerelease;
        return result;
      }),
    addReleaseAssets: async (input) =>
      operation('release', () => {
        const result = release(input.owner, input.repo, input.releaseId);
        result.assets.push(...assets(input.assetIds, result.assets));
        return result;
      }),
    removeReleaseAsset: async (input) =>
      operation('release', () => {
        const result = release(input.owner, input.repo, input.releaseId);
        if (!result.assets.some((entry) => entry.id === input.assetId)) throw demoError('找不到这个发行文件。');
        result.assets = result.assets.filter((entry) => entry.id !== input.assetId);
        return result;
      }),
    cancelRelease: async () => {
      cancel('release');
    },
    onReleaseProgress: releaseProgress.subscribe,
    aiSettings: async () => copy(ai),
    aiSaveSettings: async (input) => {
      const provider = aiProvider(input.providerId);
      if (!provider) throw demoError('请选择支持的演示提供商。');
      ai = {
        providerId: input.providerId,
        baseUrl: provider.baseUrl,
        model: input.model.trim() || provider.defaultModel,
        hasApiKey: Boolean(input.apiKey?.trim()) || ai.hasApiKey,
      };
      return copy(ai);
    },
    aiForgetKey: async () => {
      ai.hasApiKey = false;
      return copy(ai);
    },
    aiTestConnection: async () => {
      if (!ai.hasApiKey) throw demoError('请先填写演示密钥，例如 demo-key。');
      notify('demo.notice5');
    },
    aiReviewPull: async (input) =>
      operation(input.requestId, () => {
        if (!ai.hasApiKey) throw demoError('请先连接演示 AI 服务。');
        const context = demoGithub(
          state,
          'pullReviewContext',
          input.owner,
          input.repo,
          input.number,
          input.headSha,
        ) as { files: unknown[] };
        aiProgress.emit({ requestId: input.requestId, phase: '演示审查完成', completed: 1, total: 1 });
        return {
          headSha: input.headSha,
          summary: simulatedAi(input.language),
          findings: [],
          limitations: limited(input.language),
          reviewedFiles: context.files.length,
          totalFiles: context.files.length,
        };
      }),
    aiExplainCode: async (input) => explanation(input.requestId, input.language),
    aiExplainCommit: async (input) => {
      demoGithub(state, 'commit', input.owner, input.repo, input.sha);
      return { ...(await explanation(input.requestId, input.language)), includedFiles: 1, partial: false };
    },
    aiCancelReview: async (id) => {
      cancel(id);
    },
    onAiReviewProgress: aiProgress.subscribe,
    binaryAnalysisStatus: async () => copy(analysisStatus),
    binaryAnalysisInstall: async (id) =>
      operation(id, () => {
        analysisStatus = { installed: true, state: 'ready', engineVersion: 'Demo' };
        analysisProgress.emit({ requestId: id, phase: 'complete', completed: 1, total: 1 });
        return analysisStatus;
      }),
    binaryAnalysisChooseFile: async () => ({
      kind: 'local',
      fileId: 'demo-binary',
      name: 'demo-program.exe',
      size: 1024,
    }),
    binaryAnalyze: async (input) =>
      operation(input.requestId, () => {
        if (!analysisStatus.installed) throw demoError('请先安装演示分析组件。');
        const result: BinaryAnalysisResult = {
          id: `demo-analysis-${next()}`,
          fileName:
            input.source.kind === 'local' || input.source.kind === 'release' ? input.source.name : input.source.path,
          size: 1024,
          sha256: sha(1).padStart(64, '0'),
          format: 'Demo',
          architecture: 'x64',
          functionCount: 1,
          functions: [{ name: 'demo_main', address: '0x1000', code: 'int demo_main(void) { return 0; }' }],
          imports: [],
          strings: ['Demo only'],
          summary: simulatedAi(input.language),
          limitations: limited(input.language),
        };
        analysisProgress.emit({ requestId: input.requestId, phase: 'complete', completed: 1, total: 1 });
        return result;
      }),
    binaryAnalysisCancel: async (id) => {
      cancel(id);
    },
    binaryAiReview: async (input) =>
      operation(input.requestId, () => ({
        analysisId: input.analysisId,
        summary: simulatedAi(input.language),
        findings: [],
        limitations: limited(input.language),
      })),
    onBinaryAnalysisProgress: analysisProgress.subscribe,
    translateContent: async (input) => {
      const pairs: [string, string][] = [
        ['A small starter project for learning and collaboration.', '适合学习和协作的小型入门项目。'],
        ['Tools and examples for creative coding.', '用于创意编程的工具与示例。'],
        ['Installation', '安装'],
        ['Download a release or open the source code.', '下载发行版或查看源码。'],
      ];
      let result = input.text;
      const content = input.text.trim().replace(/^#{1,6}\s+/u, '');
      const names = [...(input.protectedNames ?? []), input.repository?.name];
      for (const [en, zh] of pairs) {
        const from = input.target === 'zh-CN' ? en : zh;
        if (content === from && !names.includes(from))
          result = input.text.replace(from, input.target === 'zh-CN' ? zh : en);
      }
      translationProgress.emit({ id: input.id, completed: 1, total: 1 });
      return result;
    },
    cancelTranslation: async () => undefined,
    onTranslationProgress: translationProgress.subscribe,
    hostsStatus: async () => ({ enabled: proxy.enabled, updatedAt: proxy.checkedAt, source: 'demo' }),
    hostsSetEnabled: async (enabled) => {
      await api.githubProxySetEnabled(enabled);
      return api.hostsStatus();
    },
    hostsRefresh: async () => api.hostsStatus(),
    githubProxyStatus: async () => copy(proxy),
    githubProxySetEnabled: async (enabled) => {
      proxy = {
        ...proxy,
        enabled,
        state: enabled ? 'ready' : 'off',
        checkedAt: new Date().toISOString(),
        checks: enabled
          ? [
              { target: 'login', ok: true },
              { target: 'api', ok: true },
              { target: 'download', ok: true },
            ]
          : [],
        system: { mode: enabled ? 'managed' : 'off' },
      };
      notify('demo.notice6');
      return copy(proxy);
    },
    githubProxyRefresh: async () => copy(proxy),
    githubProxyCancel: async () => undefined,
    openExternalLink: async () => {
      notify('demo.notice7');
    },
  };
  return {
    api,
    storage,
    user: copy(DEMO_USER),
    onNotice: notices.subscribe,
    dispose: () => {
      disposed = true;
      for (const stop of nativeStops) stop();
      nativeStops.clear();
      for (const controller of jobs.values()) controller.abort();
      for (const timer of timers.values()) clearTimeout(timer);
      jobs.clear();
      timers.clear();
      folders.clear();
      grants.clear();
      for (const event of [
        notices,
        localEvents,
        localProgress,
        downloadsChanged,
        releaseProgress,
        aiProgress,
        analysisProgress,
        translationProgress,
        archiveProgress,
        downloadProgress,
      ])
        event.clear();
      picked.clear();
      memoryStorage.clear();
      reports.length = 0;
    },
  };
}
