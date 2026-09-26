import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const vault = vi.hoisted(() => ({ password: undefined as string | undefined }));
const desktop = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn(), reveal: vi.fn() }));
vi.mock('@napi-rs/keyring', () => ({ AsyncEntry: class {
  async getPassword(): Promise<string | undefined> { return vault.password; }
  async setPassword(value: string): Promise<void> { vault.password = value; }
  async deleteCredential(): Promise<boolean> { vault.password = undefined; return true; }
} }));
vi.mock('electron', () => ({ dialog: { showSaveDialog: desktop.save, showMessageBox: desktop.confirm }, shell: { showItemInFolder: desktop.reveal }, net: { fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) } }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vault.password = undefined; });

describe('GitHub device authorization', () => {
  it('keeps device and access tokens inside the main service and refreshes expired credentials', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/device/code')) return Response.json({ device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
      if (url.endsWith('/access_token') && requests.filter((item) => item.endsWith('/access_token')).length === 1) return Response.json({ error: 'authorization_pending' });
      if (url.endsWith('/access_token') && requests.filter((item) => item.endsWith('/access_token')).length === 2) return Response.json({ access_token: 'private-access-token', refresh_token: 'private-refresh-token', expires_in: 60 });
      if (url.endsWith('/access_token')) return Response.json({ access_token: 'renewed-token', refresh_token: 'renewed-refresh-token', expires_in: 3600 });
      if (url.endsWith('/user')) return Response.json({ login: 'tester', name: null, avatar_url: '', html_url: 'https://github.com/tester' });
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('./githubService');
    const start = await service.startDeviceLogin('Ov23lixRW8K0uXzZqwMj');
    expect(start).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device' });
    expect(JSON.stringify(start)).not.toContain('private-device-code');
    expect(await service.pollDeviceLogin()).toMatchObject({ state: 'waiting' });
    vi.advanceTimersByTime(5_000);
    const completed = await service.pollDeviceLogin();
    expect(completed).toMatchObject({ state: 'complete', user: { login: 'tester' } });
    expect(JSON.stringify(completed)).not.toContain('private-access-token');
    expect(vault.password).toContain('private-access-token');
    vi.advanceTimersByTime(120_000);
    expect(await service.githubAction('user', [])).toMatchObject({ login: 'tester' });
    expect(vault.password).toContain('renewed-token');
  });

  it('rejects danger actions without repository administration permission', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const requests: { url: string; method: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET' });
      if (url.endsWith('/repos/other/sample')) return Response.json({ id: 9, name: 'sample', owner: { login: 'other' }, permissions: { admin: false } });
      if (url.endsWith('/user')) return Response.json({ login: 'tester', name: null, avatar_url: '', html_url: '' });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const service = await import('./githubService');
    await expect(service.githubAction('updateVisibility', ['other', 'sample', true])).rejects.toThrow('你没有这个项目的管理权限');
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });

  it('validates pull request sources before sending them to GitHub', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const fetchMock = vi.fn(async () => Response.json({ id: 1, number: 1, title: 'Improve search' }));
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('./githubService');
    await expect(service.githubAction('createPullRequest', ['owner', 'repo', {
      title: 'Improve search', body: '', head: 'writer:../main', base: 'main',
    }])).rejects.toThrow('填写的内容无效');
    expect(fetchMock).not.toHaveBeenCalled();
    await service.githubAction('createPullRequest', ['owner', 'repo', {
      title: 'Improve search', body: 'Details', head: 'writer:fix-search', base: 'main',
    }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('creates a fork and submits only changes from its verified parent', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const calls: Array<{ url: string; method: string }> = [];
    let existingPull = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.endsWith('/user')) return Response.json({ login: 'writer', name: null, avatar_url: '', html_url: '' });
      if (url.includes('/user/repos?')) return Response.json([{ id: 20, name: 'Search', fork: true, owner: { login: 'writer' } }]);
      if (url.endsWith('/repos/author/Search')) return Response.json({ id: 10, name: 'Search', private: false, archived: false, allow_forking: true, default_branch: 'main', owner: { login: 'author' }, permissions: { pull: true, push: false } });
      if (url.endsWith('/repos/author/Search/forks')) return Response.json({ id: 20, name: 'Search', fork: true, owner: { login: 'writer' } }, { status: 202 });
      if (url.endsWith('/repos/writer/Search')) return Response.json({ id: 20, name: 'Search', fork: true, default_branch: 'main', owner: { login: 'writer' }, parent: { id: 10, full_name: 'author/Search', name: 'Search', default_branch: 'main', owner: { login: 'author' } } });
      if (url.includes('/compare/')) return Response.json({ ahead_by: 1, behind_by: 0, files: [{ filename: 'fix.txt' }] });
      if (url.includes('/pulls?')) return Response.json(existingPull ? [{ id: 30, number: 1, html_url: 'https://github.com/author/Search/pull/1' }] : []);
      if (url.endsWith('/repos/author/Search/pulls')) return Response.json({ id: 30, number: 1, title: 'Fix', html_url: 'https://github.com/author/Search/pull/1' }, { status: 201 });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const service = await import('./githubService');
    expect(await service.githubAction('forkRepo', ['author', 'Search', 'Search'])).toMatchObject({ id: 20, fork: true });
    expect(await service.githubAction('myFork', ['author', 'Search'])).toMatchObject({ id: 20, fork: true });
    expect(await service.githubAction('forkComparison', ['writer', 'Search'])).toMatchObject({ ahead_by: 1 });
    expect(await service.githubAction('submitForkContribution', ['writer', 'Search', 'Fix', 'Details'])).toMatchObject({ number: 1 });
    existingPull = true;
    expect(await service.githubAction('forkComparison', ['writer', 'Search'])).toMatchObject({ openRequest: { number: 1 } });
    expect(await service.githubAction('submitForkContribution', ['writer', 'Search', 'Fix again', 'Details'])).toMatchObject({ number: 1 });
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.url)).toEqual([
      'https://api.github.com/repos/author/Search/forks', 'https://api.github.com/repos/author/Search/pulls',
    ]);
    await expect(service.githubAction('submitForkContribution', ['other', 'Search', 'Fix', ''])).rejects.toThrow();
  });

  it('loads an authenticated project address, including a private project, after validating its parts', async () => {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    const fetchMock = vi.fn(async () => Response.json({ id: 7, name: 'PrivateTool', private: true, owner: { login: 'tester' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = await import('./githubService');
    await expect(service.githubAction('repository', ['../other', 'PrivateTool'])).rejects.toThrow('填写的内容无效');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await service.githubAction('repository', ['tester', 'PrivateTool'])).toMatchObject({ id: 7, private: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('safe improvement request handling', () => {
  const headSha = 'a'.repeat(40);
  const blobSha = 'b'.repeat(40);
  const repository = { id: 10, name: 'sample', full_name: 'owner/sample', owner: { login: 'owner' }, permissions: { push: true, admin: false }, archived: false };
  const originalPull = { number: 7, state: 'open', merged: false, merged_at: null, draft: false, changed_files: 1, head: { sha: headSha, ref: 'fix', repo: { id: 20, name: 'copy', owner: { login: 'writer' } } }, base: { sha: 'c'.repeat(40), ref: 'main', repo: { id: 10 } } };
  const originalFile = { filename: 'src/fix.ts', status: 'modified', sha: blobSha, additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' };

  async function setup(options: { repository?: object; pull?: object; files?: object[]; changeHeadAfterFiles?: boolean; changeBaseAfterFiles?: boolean; mergeStatus?: number; commentStatus?: number; closeStatus?: number; onBlob?: () => Promise<void> } = {}) {
    vi.resetModules();
    vault.password = JSON.stringify({ clientId: 'Ov23lixRW8K0uXzZqwMj', accessToken: 'test-token' });
    let filesFetched = false;
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/repos/owner/sample')) return Response.json(options.repository ?? repository);
      if (url.includes('/pulls/7/files?')) { filesFetched = true; return Response.json(options.files ?? [originalFile]); }
      if (url.endsWith('/pulls/7/merge')) return options.mergeStatus ? new Response(null, { status: options.mergeStatus }) : Response.json({ merged: true, sha: 'd'.repeat(40), message: 'Server text' });
      if (url.endsWith('/issues/7/comments')) return options.commentStatus ? new Response(null, { status: options.commentStatus }) : Response.json({ id: 1, body: 'Not suitable' });
      if (url.endsWith('/pulls/7')) {
        if (init?.method === 'PATCH') return options.closeStatus ? new Response(null, { status: options.closeStatus }) : Response.json({ ...originalPull, state: 'closed' });
        return Response.json(options.pull ?? { ...originalPull, ...(filesFetched && options.changeHeadAfterFiles ? { head: { ...originalPull.head, sha: 'e'.repeat(40) } } : {}), ...(filesFetched && options.changeBaseAfterFiles ? { base: { ...originalPull.base, sha: 'e'.repeat(40) } } : {}) });
      }
      if (url.endsWith(`/repos/writer/copy/git/blobs/${blobSha}`)) { await options.onBlob?.(); return new Response('changed content', { headers: { 'content-length': '15' } }); }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { service: await import('./githubService'), fetchMock };
  }

  it('merges only the reviewed revision with current write permission', async () => {
    const { service, fetchMock } = await setup();
    expect(await service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).toMatchObject({ merged: true, message: '改进请求已批准并合入。' });
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['https://api.github.com/repos/owner/sample', 'https://api.github.com/repos/owner/sample/pulls/7', 'https://api.github.com/repos/owner/sample/pulls/7/merge']);
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({ sha: headSha, merge_method: 'merge' });
  });

  it.each([
    { repository: { ...repository, permissions: { push: false, admin: false } }, message: '审批权限' },
    { repository: { ...repository, archived: true }, message: '已存档' },
    { pull: { ...originalPull, draft: true }, message: '准备中' },
    { pull: { ...originalPull, state: 'closed' }, message: '已经处理' },
    { pull: { ...originalPull, merged: true }, message: '已经处理' },
    { pull: { ...originalPull, base: { repo: { id: 999 } } }, message: '所属的项目' },
    { pull: { ...originalPull, head: { sha: 'e'.repeat(40) } }, message: '新修改' },
    { pull: { ...originalPull, mergeable: false }, message: '作者确认' },
  ])('blocks a write when fresh repository or request checks fail: $message', async (options) => {
    const { service, fetchMock } = await setup(options);
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow(options.message);
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });

  it('keeps project rules in force and reports concurrent changes naturally', async () => {
    for (const status of [405, 409]) {
      const { service } = await setup({ mergeStatus: status });
      await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow(status === 405 ? '检查和审批要求' : '新修改');
    }
  });

  it('chooses an allowed merge method and refuses disabled methods', async () => {
    for (const method of ['squash', 'rebase'] as const) {
      const { service, fetchMock } = await setup({ repository: { ...repository, allow_merge_commit: false, allow_squash_merge: method === 'squash', allow_rebase_merge: true } });
      await service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }]);
      expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string).merge_method).toBe(method);
    }
    const { service, fetchMock } = await setup({ repository: { ...repository, allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: false } });
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow('不允许这种合入方式');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('rejects by closing the request without changing repository content', async () => {
    const { service, fetchMock } = await setup();
    expect(await service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).toMatchObject({ state: 'closed' });
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(writes[0]?.[1]?.body as string)).toEqual({ state: 'closed' });
  });

  it('keeps rejection open on comment failure and reports a separately failed close', async () => {
    const failedComment = await setup({ commentStatus: 403 });
    await expect(failedComment.service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, reason: 'Not suitable' }])).rejects.toThrow('未继续关闭');
    expect(failedComment.fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    const failedClose = await setup({ closeStatus: 403 });
    await expect(failedClose.service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, reason: 'Not suitable' }])).rejects.toThrow('拒绝说明已发送');
    const successful = await setup();
    expect(await successful.service.githubAction('rejectPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, reason: 'Not suitable' }])).toMatchObject({ state: 'closed' });
    expect(successful.fetchMock.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'GET', 'POST', 'GET', 'GET', 'PATCH']);
  });

  it('rejects malformed action input before network requests', async () => {
    const { service, fetchMock } = await setup();
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: 'main' }])).rejects.toThrow('填写');
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha, method: 'force' }])).rejects.toThrow('填写');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses approval and rejection if the reviewed destination was retargeted or updated', async () => {
    for (const base of [{ ...originalPull.base, ref: 'release' }, { ...originalPull.base, sha: 'f'.repeat(40) }]) {
      const { service, fetchMock } = await setup({ pull: { ...originalPull, base } });
      for (const action of ['acceptPullRequest', 'rejectPullRequest']) {
        await expect(service.githubAction(action, ['owner', 'sample', 7, { expectedHeadSha: headSha, expectedBaseRef: originalPull.base.ref, expectedBaseSha: originalPull.base.sha }])).rejects.toThrow('接收改进的位置或内容已经改变');
      }
      expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    }
    const { service, fetchMock } = await setup();
    await expect(service.githubAction('acceptPullRequest', ['owner', 'sample', 7, { expectedHeadSha: headSha }])).rejects.toThrow('填写');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('detects changed request contents while loading review files', async () => {
    for (const options of [{ changeHeadAfterFiles: true }, { changeBaseAfterFiles: true }]) {
      const { service } = await setup(options);
      await expect(service.getPullRequestReviewContext('owner', 'sample', 7, headSha)).rejects.toThrow('新修改');
    }
    const { service } = await setup({ pull: { ...originalPull, changed_files: 2 } });
    expect(await service.getPullRequestReviewContext('owner', 'sample', 7, headSha)).toMatchObject({ filesTruncated: true, files: [originalFile] });
  });

  it('exposes only a validated current file snapshot through the renderer read action', async () => {
    const { service, fetchMock } = await setup();
    await expect(service.githubAction('pullReviewContext', ['owner', 'sample', 0, headSha])).rejects.toThrow('填写');
    await expect(service.githubAction('pullReviewContext', ['owner', 'sample', 7, 'main'])).rejects.toThrow('填写');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await service.githubAction('pullReviewContext', ['owner', 'sample', 7, headSha])).toMatchObject({ pullRequest: { head: { sha: headSha } }, files: [originalFile], filesTruncated: false });
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
    const stale = await setup({ changeHeadAfterFiles: true });
    await expect(stale.service.githubAction('pullReviewContext', ['owner', 'sample', 7, headSha])).rejects.toThrow('新修改');
  });

  it('cancels review snapshot reads using the shared read cancellation control', async () => {
    const { service } = await setup();
    let requestStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      requestStarted?.();
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const pending = service.githubAction('pullReviewContext', ['owner', 'sample', 7, headSha]);
    await started;
    service.cancelGithubReads();
    await expect(pending).rejects.toThrow('操作已取消');
  });

  it('downloads only a selected request file from its immutable blob and registers the saved file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-download-'));
    try {
      const path = join(folder, 'fix.ts');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      const { service, fetchMock } = await setup();
      const progress = vi.fn();
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', progress, headSha)).toBe(path);
      expect(await readFile(path, 'utf8')).toBe('changed content');
      expect(progress).toHaveBeenLastCalledWith({ loaded: 15, total: 15, percent: 100 });
      service.revealDownloadedArchive(path);
      expect(desktop.reveal).toHaveBeenCalledWith(path);
      const blobCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/git/blobs/'));
      expect(blobCall?.[0]).toBe(`https://api.github.com/repos/writer/copy/git/blobs/${blobSha}`);
      expect(blobCall?.[1]?.redirect).toBe('error');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('blocks path injection, unknown files and removed files before selecting a destination', async () => {
    const { service, fetchMock } = await setup();
    for (const path of ['../fix.ts', '/etc/passwd', 'https://evil.test/file', 'src\\fix.ts']) {
      await expect(service.downloadPullRequestFile('owner', 'sample', 7, path, vi.fn(), headSha)).rejects.toThrow('填写');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(service.downloadPullRequestFile('owner', 'sample', 7, 'secret.txt', vi.fn(), headSha)).rejects.toThrow('不在改进请求');
    const removed = await setup({ files: [{ ...originalFile, status: 'removed' }] });
    await expect(removed.service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).rejects.toThrow('已被删除');
    expect(desktop.save).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing download without confirmation', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-overwrite-'));
    try {
      const path = join(folder, 'fix.ts');
      await writeFile(path, 'keep my file');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      desktop.confirm.mockResolvedValue({ response: 0 });
      const { service, fetchMock } = await setup();
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).toBeNull();
      expect(await readFile(path, 'utf8')).toBe('keep my file');
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/git/blobs/'))).toBe(true);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('asks at final save when a new local file appears during the download', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-race-'));
    try {
      const path = join(folder, 'fix.ts');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      desktop.confirm.mockResolvedValue({ response: 0 });
      const { service } = await setup({ onBlob: () => writeFile(path, 'created while downloading') });
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).toBeNull();
      expect(await readFile(path, 'utf8')).toBe('created while downloading');
      expect(desktop.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('下载已完成') }));
    } finally { await rm(folder, { recursive: true, force: true }); }
  });

  it('replaces an existing file only after final explicit confirmation', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'easyhub-pull-confirmed-'));
    try {
      const path = join(folder, 'fix.ts');
      await writeFile(path, 'before download');
      desktop.save.mockResolvedValue({ canceled: false, filePath: path });
      let checkedLatest = false;
      desktop.confirm.mockImplementation(async () => { checkedLatest = (await readFile(path, 'utf8')) === 'latest edit'; return { response: 1 }; });
      const { service } = await setup({ onBlob: () => writeFile(path, 'latest edit') });
      expect(await service.downloadPullRequestFile('owner', 'sample', 7, 'src/fix.ts', vi.fn(), headSha)).toBe(path);
      expect(checkedLatest).toBe(true);
      expect(await readFile(path, 'utf8')).toBe('changed content');
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
