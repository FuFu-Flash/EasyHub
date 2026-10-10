/** Adapts explicitly allowlisted, pre-existing smoke mocks to the persistent-download IPC.
 * No production handler or network operation is called. Transfer correctness is covered by
 * DownloadManager.test.ts against a local HTTP server; this adapter preserves UI fixtures.
 */
export async function installDownloadFixture(app, channels) {
  await app.evaluate(({ ipcMain }, allowedChannels) => {
    const handlers = ipcMain._invokeHandlers;
    if (!(handlers instanceof Map)) throw new Error('This Electron test runtime does not expose registered mock handlers.');
    const allowed = new Map(allowedChannels.map(channel => [channel, handlers.get(channel)]));
    for (const [channel, handler] of allowed) if (typeof handler !== 'function') throw new Error('Missing download mock: ' + channel);
    const rows = [];
    let sender;
    let nextId = 1;
    const emit = () => sender?.send('easyhub:downloads-changed', rows);
    // Some isolated launchers replace ipcMain.handle with a deny-by-default gate.
    // These exact new channels are part of this explicit fixture allowlist.
    const register = (channel, callback) => { ipcMain.removeHandler(channel); handlers.set(channel, callback); };
    const invoke = (channel, event, ...args) => {
      const handler = allowed.get(channel);
      if (!handler) throw new Error('Forbidden download fixture action: ' + channel);
      return handler(event, ...args);
    };
    const run = (item, event) => {
      const generation = item.generation = (item.generation ?? 0) + 1;
      item.state = 'running'; item.error = undefined; item.loaded = 0; item.total = null; item.percent = null;
      let sampledAt = Date.now();
      let sampledBytes = 0;
      let speed = null;
      const forwarded = { ...event, sender: { send: (channel, progress) => {
        if (channel === 'easyhub:download-progress') {
          const now = Date.now();
          if (now - sampledAt >= 2000) { speed = Math.round((progress.loaded - sampledBytes) * 1000 / (now - sampledAt)); sampledAt = now; sampledBytes = progress.loaded; }
          Object.assign(item, progress, { bytesPerSecond: speed }); emit();
        } else event.sender.send(channel, progress);
      } } };
      const request = item.request;
      const channel = request.kind === 'project' ? 'easyhub:local-download' : request.kind === 'pull-file' ? 'easyhub:download-pull-file' : request.assetId === undefined ? 'easyhub:download-archive' : 'easyhub:download-release-asset';
      const args = request.kind === 'pull-file' ? [request.repo.owner.login, request.repo.name, request.number, request.path, request.headSha]
        : [request.repo.owner.login, request.repo.name, request.assetId ?? request.ref];
      emit();
      void Promise.resolve().then(async () => {
        if (request.kind !== 'project') return invoke(channel, forwarded, ...args);
        const parent = await invoke('easyhub:choose-folder', event); if (!parent) return null;
        const link = await invoke(channel, forwarded, request.repo.owner.login, request.repo.name, parent);
        item.localLinkId = link.id; return link.localPath;
      }).then(path => {
        if (item.generation !== generation) return;
        if (!path) { rows.splice(rows.indexOf(item), 1); emit(); return; }
        Object.assign(item, { state: 'complete', path, percent: 100, phase: request.kind === 'pull-file' ? '修改文件已经下载完成。' : '项目已经下载完成。', seen: false }); emit();
      }).catch(error => {
        if (item.generation !== generation) return;
        Object.assign(item, { state: error.message.includes('取消') ? 'cancelled' : 'failed', error: error.message, seen: false }); emit();
      });
    };
    register('easyhub:downloads-list', event => { sender = event.sender; return rows; });
    register('easyhub:downloads-enqueue', (event, request) => {
      sender = event.sender;
      const item = { id: 'fixture-' + nextId++, request, state: 'running', phase: '正在下载…', percent: null, loaded: 0, total: null, bytesPerSecond: null, seen: true };
      rows.unshift(item); run(item, event); return item;
    });
    register('easyhub:downloads-command', (event, id, action) => {
      const item = rows.find(row => row.id === id); if (!item) return;
      if (action === 'seen') item.seen = true;
      else if (action === 'resume') run(item, event);
      else if (action === 'cancel') return invoke('easyhub:cancel-archive', event);
      else if (action === 'remove') rows.splice(rows.indexOf(item), 1);
      else throw new Error('Unsupported legacy fixture download command: ' + action);
      emit();
    });
    register('easyhub:downloads-clear', () => { for (let i = rows.length - 1; i >= 0; i--) if (['complete', 'cancelled', 'failed'].includes(rows[i].state)) rows.splice(i, 1); emit(); });
    register('easyhub:downloads-open', (event, id, folder) => { const item = rows.find(row => row.id === id); if (item) return invoke(folder ? 'easyhub:reveal-downloaded-archive' : 'easyhub:open-downloaded-file', event, item.path); });
  }, channels);
}
