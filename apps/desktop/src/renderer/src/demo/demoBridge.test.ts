import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GitHubComment, GitHubCreatedRelease, GitHubIssue, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { createDemoBridge } from './demoBridge';
import { DEMO_USER } from './demoData';
import { readDraft, writeDraft } from '../draftStore';

const sessions: ReturnType<typeof createDemoBridge>[] = [];
afterEach(() => { sessions.splice(0).forEach((session) => session.dispose()); vi.useRealTimers(); });
function session() { const value = createDemoBridge(); sessions.push(value); return value; }
async function minecraft() { const value = session(); const link = (await value.api.localList()).find((item) => item.name === 'MinecraftMod')!; return { ...value, link }; }

describe('isolated demo bridge', () => {
  it('implements every preload method, including subscriptions', () => {
    const source = readFileSync(new URL('../../../preload/index.ts', import.meta.url), 'utf8');
    const names = [...source.matchAll(/^  (\w+):/gmu)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(80);
    expect(Object.keys(session().api).sort()).toEqual(names.sort());
  });
  it('returns independent data snapshots and resets all domain state in a new session', async () => {
    const first = session(); const repos = await first.api.github<GitHubRepo[]>('repos'); repos[0]!.name = 'mutated copy';
    expect((await first.api.github<GitHubRepo[]>('repos'))[0]!.name).toBe('MyTool');
    await first.api.github('createRepo', 'CreatedOnlyHere', '', true);
    expect((await session().api.github<GitHubRepo[]>('repos')).some((item) => item.name === 'CreatedOnlyHere')).toBe(false);
  });
  it('uses memory for demo drafts without reading or altering persistent storage', () => {
    const one = session(), two = session(); writeDraft('fixture', 'draft', one.storage);
    expect(readDraft('fixture', one.storage)).toBe('draft'); expect(readDraft('fixture', two.storage)).toBe('');
    one.dispose(); expect(readDraft('fixture', one.storage)).toBe('');
  });
  it('requires exact file selection and retains unselected changes after publishing', async () => {
    const { api, link } = await minecraft(); const before = await api.localPreviewChanges(link.id);
    await expect(api.localPublish(link.id, 'unsafe')).rejects.toThrow();
    const paths = ['src/main.ts']; expect(await api.localPublish(link.id, 'Publish one file', { snapshot: before.snapshot, paths })).toEqual({ changed: 1 });
    const after = await api.localPreviewChanges(link.id); expect(after.files.some((file) => file.path === 'src/main.ts')).toBe(false); expect(after.files.some((file) => file.path === '.env')).toBe(true);
    await expect(api.localPublish(link.id, 'stale', { snapshot: before.snapshot, paths: ['.env'], sensitiveConfirmed: true })).rejects.toThrow();
  });
  it('requires a second confirmation for sensitive files and rejects invalid selection', async () => {
    const { api, link } = await minecraft(); const preview = await api.localPreviewChanges(link.id);
    await expect(api.localPublish(link.id, 'env', { snapshot: preview.snapshot, paths: ['.env'] })).rejects.toThrow('SENSITIVE_FILES');
    await expect(api.localPublish(link.id, 'invalid', { snapshot: preview.snapshot, paths: ['outside.txt'] })).rejects.toThrow();
    expect(await api.localPublish(link.id, 'Confirmed demo env', { snapshot: preview.snapshot, paths: ['.env'], sensitiveConfirmed: true })).toEqual({ changed: 1 });
  });
  it('creates virtual projects only in picker-granted folders and keeps removed files reconnectable', async () => {
    const { api } = session(); await expect(api.localCreate('C:/real', 'NoGrant', '', true)).rejects.toThrow();
    const path = (await api.chooseFolder())!; const link = await api.localCreate(path, 'VirtualProject', '', true);
    await api.localSaveIntroduction(link.id, '', '# Unsaved files'); await api.localRemove(link.id);
    expect((await api.localInspect(path)).state).toBe('github'); const restored = await api.localConnect(path); expect(await api.localReadIntroduction(restored.id)).toBe('# Unsaved files');
  });
  it('updates issues, comments and aggregate counts coherently', async () => {
    const { api } = session(); const issue = await api.github<GitHubIssue>('createIssue', DEMO_USER.login, 'MyTool', 'New issue', 'body');
    await api.github('createComment', DEMO_USER.login, 'MyTool', issue.number, 'Reply');
    expect((await api.github<GitHubComment[]>('comments', DEMO_USER.login, 'MyTool', issue.number))[0]?.body).toBe('Reply');
    await api.github('updateIssue', DEMO_USER.login, 'MyTool', issue.number, 'closed');
    const counts = await api.github<Record<number, { issues: number; closedIssues: number }>>('activityCounts'); expect(counts[910001]).toEqual(expect.objectContaining({ issues: 3, closedIssues: 1 }));
  });
  it('forks, publishes a change, and submits it to the original project in memory', async () => {
    const { api } = session(); const fork = await api.github<GitHubRepo>('forkRepo', 'sample-author', 'StarterKit', 'StarterKit'); expect(fork.parent?.full_name).toBe('sample-author/StarterKit');
    const link = await api.localDownload(DEMO_USER.login, fork.name, 'C:/EasyHub Demo');
    const original = await api.localReadIntroduction(link.id); await api.localSaveIntroduction(link.id, original, original + '\nImproved');
    const preview = await api.localPreviewChanges(link.id); await api.localPublish(link.id, 'Improve README', { snapshot: preview.snapshot, paths: ['README.md'] });
    const pull = await api.github<GitHubPullRequest>('submitForkContribution', DEMO_USER.login, fork.name, 'Improve README', 'Details'); expect(pull.base.repo?.full_name).toBe('sample-author/StarterKit');
    await expect(api.github('submitForkContribution', DEMO_USER.login, fork.name, 'Duplicate', '')).rejects.toThrow();
    await expect(api.github('setArchived', 'sample-author', 'StarterKit', true)).rejects.toThrow();
  });
  it('checks both head/base snapshots before accepting or rejecting a merge request', async () => {
    const { api } = session(); const pull = await api.github<GitHubPullRequest>('pullRequest', DEMO_USER.login, 'MyTool', 10);
    const expected = { expectedHeadSha: pull.head.sha, expectedBaseRef: pull.base.ref, expectedBaseSha: pull.base.sha };
    await expect(api.github('acceptPullRequest', DEMO_USER.login, 'MyTool', 10, { ...expected, expectedHeadSha: '0'.repeat(40) })).rejects.toThrow();
    expect((await api.github<GitHubPullRequest>('pullRequest', DEMO_USER.login, 'MyTool', 10)).state).toBe('open');
    await api.github('acceptPullRequest', DEMO_USER.login, 'MyTool', 10, expected);
    expect((await api.github<GitHubPullRequest>('pullRequest', DEMO_USER.login, 'MyTool', 10)).merged).toBe(true);
    await expect(api.github('rejectPullRequest', DEMO_USER.login, 'MyTool', 10, expected)).rejects.toThrow();
  });
  it('publishes, edits, adds and removes release assets without duplicate writes', async () => {
    const { api } = session(); const picked = await api.chooseReleaseFiles(false);
    const input = { owner: DEMO_USER.login, repo: 'MyTool', tagName: 'v2.0.0', title: 'Second', body: 'Description', channel: 'stable' as const, assetIds: picked.map((item) => item.id) };
    const value = await api.publishRelease(input) as GitHubCreatedRelease; expect(value.assets).toHaveLength(1);
    await expect(api.publishRelease(input)).rejects.toThrow();
    const target = { owner: DEMO_USER.login, repo: 'MyTool', releaseId: value.id };
    expect((await api.editRelease({ ...target, title: 'Edited', body: 'Updated', prerelease: false })).name).toBe('Edited');
    const extra = await api.chooseReleaseFiles(false); const added = await api.addReleaseAssets({ ...target, assetIds: [extra[0]!.id] }) as GitHubCreatedRelease; expect(added.assets).toHaveLength(2);
    await expect(api.addReleaseAssets({ ...target, assetIds: [extra[0]!.id] })).rejects.toThrow();
    expect((await api.removeReleaseAsset({ ...target, assetId: value.assets[0]!.id })).assets).toHaveLength(1);
  });
  it('cancels pending writes before mutation and removes listeners when unsubscribed', async () => {
    const { api } = session(); const callback = vi.fn(); const stop = api.onReleaseProgress(callback); stop();
    const writing = api.publishRelease({ owner: DEMO_USER.login, repo: 'MyTool', tagName: 'v9.0.0', title: 'Cancel', body: '', channel: 'stable', assetIds: [] }); const failure = writing.catch((error: unknown) => error); await api.cancelRelease(); expect(await failure).toBeInstanceOf(Error);
    expect((await api.github<GitHubCreatedRelease[]>('releases', DEMO_USER.login, 'MyTool')).some((item) => item.tag_name === 'v9.0.0')).toBe(false); expect(callback).not.toHaveBeenCalled();
  });
  it('supports pause/resume/cancel/seen with browser-style virtual downloads', async () => {
    vi.useFakeTimers(); const { api } = session(); const repo = (await api.github<GitHubRepo[]>('repos'))[0]!; const callback = vi.fn(); const stop = api.onDownloadsChanged(callback);
    const item = (await api.downloadsEnqueue({ kind: 'archive', repo, ref: 'main', fileName: 'source.zip' }))!;
    await api.downloadsCommand(item.id, 'pause'); await vi.advanceTimersByTimeAsync(250); expect((await api.downloadsList())[0]?.state).toBe('paused');
    await api.downloadsCommand(item.id, 'resume'); await vi.advanceTimersByTimeAsync(250); expect((await api.downloadsList())[0]).toMatchObject({ state: 'complete', seen: false }); await api.downloadsCommand(item.id, 'seen'); expect((await api.downloadsList())[0]?.seen).toBe(true);
    stop(); const before = callback.mock.calls.length; await api.downloadsClear(); expect(callback).toHaveBeenCalledTimes(before);
  });
  it('never calls native network, credentials, proxy or file operations', async () => {
    const forbidden = vi.fn(() => { throw new Error('Native domain bridge reached'); });
    const native = new Proxy({}, { get: (_target, key) => ['minimizeWindow', 'toggleMaximizeWindow', 'closeWindow', 'openLicense', 'onNavigate'].includes(String(key)) ? vi.fn() : forbidden });
    const demo = createDemoBridge(native as Parameters<typeof createDemoBridge>[0]); sessions.push(demo);
    await demo.api.github('repos'); await demo.api.chooseFolder(); await demo.api.githubProxySetEnabled(true); await demo.api.aiSaveSettings({ providerId: 'deepseek', model: 'demo', apiKey: 'sample-key' }); await demo.api.authStart(); await demo.api.authPoll();
    expect(forbidden).not.toHaveBeenCalled(); expect(JSON.stringify(await demo.api.aiSettings())).not.toContain('sample-key');
  });
  it('rejects unknown actions instead of using native IPC and preserves code/links in sample translations', async () => {
    const { api } = session(); await expect(api.github('unsupported')).rejects.toThrow();
    for (const text of ['`Installation`', '[Installation](https://example.com/Installation)', '```\nInstallation\n```']) expect(await api.translateContent({ id: 'demo', text, target: 'zh-CN', format: 'markdown' })).toBe(text);
    expect(await api.translateContent({ id: 'demo', text: '# Installation', target: 'zh-CN', format: 'markdown' })).toBe('# 安装');
  });
  it('requires sync conflict choices and retains the selected local version', async () => {
    const { api } = session(); const link = (await api.localList()).find((item) => item.name === 'PersonalSite')!;
    const original = await api.localReadIntroduction(link.id); await api.localSaveIntroduction(link.id, original, '# My local edits');
    const preview = await api.localCheckSync(link.id); expect(preview.state).toBe('review');
    await expect(api.localSync(link.id, preview.remoteRevision, [])).rejects.toThrow();
    await api.localSync(link.id, preview.remoteRevision, [{ path: 'README.md', choice: 'mine' }]);
    expect(await api.localReadIntroduction(link.id)).toBe('# My local edits'); expect((await api.localStatus(link.id)).files).toHaveLength(1);
  });
  it('releases native navigation subscriptions when the demo ends', () => {
    const stop = vi.fn(); const demo = createDemoBridge({ onNavigate: () => stop, minimizeWindow: async () => undefined, toggleMaximizeWindow: async () => undefined, closeWindow: async () => undefined, openLicense: async () => undefined }); sessions.push(demo);
    demo.api.onNavigate(() => undefined); demo.dispose(); expect(stop).toHaveBeenCalledTimes(1);
  });
});
