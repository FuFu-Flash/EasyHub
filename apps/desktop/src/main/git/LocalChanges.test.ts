import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as git from 'isomorphic-git';
import { GitEngine } from './GitEngine';
import { commitSelectedChanges, snapshotChanges, safeChangePath } from './LocalChanges';

vi.mock('isomorphic-git', async (original) => ({ ...await original<typeof import('isomorphic-git')>(), push: vi.fn() }));
const paths: string[] = [];
const author = { name: 'Fixture', email: 'fixture@example.invalid' };
const repo = { owner: 'fixture', name: 'project', defaultBranch: 'main' };
afterEach(async () => { vi.restoreAllMocks(); vi.mocked(git.push).mockReset(); await Promise.all(paths.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string | Buffer> = { 'one.txt': 'first\nsecond\n', 'other.txt': 'original\n' }) {
  const dir = await mkdtemp(join(tmpdir(), 'easyhub-selection-')); paths.push(dir);
  await git.init({ fs, dir, defaultBranch: 'main' });
  for (const [name, content] of Object.entries(files)) { await writeFile(join(dir, name), content); await git.add({ fs, dir, filepath: name }); }
  const head = await git.commit({ fs, dir, author, message: 'initial' });
  const engine = new GitEngine();
  const scan = async () => snapshotChanges(dir, await engine.getStatus(dir));
  return { dir, head, engine, scan };
}
async function blob(dir: string, oid: string, filepath: string) { return Buffer.from((await git.readBlob({ fs, dir, oid, filepath })).blob).toString(); }
async function cleanMetadata(dir: string) { expect((await readdir(join(dir, '.git'))).filter((name) => name.endsWith('.lock') || name.startsWith('easyhub-index-') || name === 'easyhub-publish-incomplete')).toEqual([]); }

describe('safe file selection and preview', () => {
  it('commits selected additions, modifications, deletion and rename, retaining all unselected working files', async () => {
    const { dir, head, engine, scan } = await fixture({ 'one.txt': 'before\n', 'other.txt': 'other\n', 'remove.txt': 'delete me', 'old.txt': 'rename me' });
    await writeFile(join(dir, 'one.txt'), 'after\n'); await writeFile(join(dir, 'other.txt'), 'keep my edits\n');
    await writeFile(join(dir, 'add.txt'), 'new selected'); await writeFile(join(dir, 'unselected.txt'), 'keep my new file');
    await unlink(join(dir, 'remove.txt')); await rename(join(dir, 'old.txt'), join(dir, 'renamed.txt'));
    const before = await scan();
    expect(before.preview.files).toContainEqual({ path: 'renamed.txt', previousPath: 'old.txt', kind: 'renamed' });
    const result = await commitSelectedChanges(dir, author, 'selected update', { snapshot: before.preview.snapshot, paths: ['one.txt', 'add.txt', 'remove.txt', 'renamed.txt'] }, scan);
    expect(result.changed).toBe(4); expect(await blob(dir, result.head, 'one.txt')).toBe('after\n'); expect(await blob(dir, result.head, 'other.txt')).toBe(await blob(dir, head, 'other.txt'));
    expect(await blob(dir, result.head, 'renamed.txt')).toBe('rename me'); expect(await blob(dir, result.head, 'add.txt')).toBe('new selected');
    await expect(blob(dir, result.head, 'remove.txt')).rejects.toThrow(); await expect(blob(dir, result.head, 'old.txt')).rejects.toThrow(); await expect(blob(dir, result.head, 'unselected.txt')).rejects.toThrow();
    expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('keep my edits\n'); expect(await readFile(join(dir, 'unselected.txt'), 'utf8')).toBe('keep my new file');
    const status = await engine.getStatus(dir); expect(status.hasPreparedChanges).toBe(false); expect(status.pendingPublish).toBe(true);
    expect(status.files).toEqual([{ path: 'other.txt', kind: 'modified' }, { path: 'unselected.txt', kind: 'added' }]);
    await cleanMetadata(dir);
  });
  it('shows actual old/new line numbers and handles binary, large files and renamed content', async () => {
    const { dir, engine } = await fixture(); await writeFile(join(dir, 'one.txt'), 'first\nchanged\nlast\n');
    await writeFile(join(dir, 'binary.bin'), Buffer.from([1, 0, 2])); await writeFile(join(dir, 'large.txt'), 'a'.repeat(270_000));
    const preview = await engine.getPublishPreview(dir); const diff = await engine.getFileDiff(dir, 'one.txt', preview.snapshot);
    expect(diff.additions).toBe(2); expect(diff.deletions).toBe(1); expect(diff.lines).toContainEqual({ kind: 'deleted', text: 'second', before: 2 }); expect(diff.lines).toContainEqual({ kind: 'added', text: 'changed', after: 2 });
    expect((await engine.getFileDiff(dir, 'binary.bin', preview.snapshot)).unavailable).toBe('binary'); expect((await engine.getFileDiff(dir, 'large.txt', preview.snapshot)).unavailable).toBe('large');
    await expect(engine.getFileDiff(dir, '../secret', preview.snapshot)).rejects.toThrow();
  });
  it('rejects stale choices without changing files, current version or index', async () => {
    const { dir, head, engine, scan } = await fixture(); await writeFile(join(dir, 'one.txt'), 'selected'); const preview = await engine.getPublishPreview(dir);
    await writeFile(join(dir, 'one.txt'), 'new work'); await engine.getStatus(dir); const index = await readFile(join(dir, '.git', 'index'));
    await expect(commitSelectedChanges(dir, author, 'update', { snapshot: preview.snapshot, paths: ['one.txt'] }, scan)).rejects.toThrow('发生了变化');
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(head); expect(await readFile(join(dir, '.git', 'index'))).toEqual(index); expect(await readFile(join(dir, 'one.txt'), 'utf8')).toBe('new work'); await cleanMetadata(dir);
  });
  it('does not include or discard changes staged by another tool', async () => {
    const { dir, head, scan } = await fixture(); await writeFile(join(dir, 'one.txt'), 'selected'); await writeFile(join(dir, 'other.txt'), 'staged elsewhere'); await git.add({ fs, dir, filepath: 'other.txt' });
    const snapshot = await scan(); const index = await readFile(join(dir, '.git', 'index'));
    await expect(commitSelectedChanges(dir, author, 'update', { snapshot: snapshot.preview.snapshot, paths: ['one.txt'] }, scan)).rejects.toThrow('其他工具');
    expect(await readFile(join(dir, '.git', 'index'))).toEqual(index); expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(head); await cleanMetadata(dir);
  });
  it('does not remove another tool’s lock', async () => {
    const { dir, scan } = await fixture(); await writeFile(join(dir, 'one.txt'), 'selected'); const snapshot = await scan(); await writeFile(join(dir, '.git', 'index.lock'), 'belongs to another tool');
    await expect(commitSelectedChanges(dir, author, 'update', { snapshot: snapshot.preview.snapshot, paths: ['one.txt'] }, scan)).rejects.toThrow('另一个工具');
    expect(await readFile(join(dir, '.git', 'index.lock'), 'utf8')).toBe('belongs to another tool');
  });
  it('rejects a branch change even when the other branch points at the same version', async () => {
    const { dir, head, engine, scan } = await fixture(); await writeFile(join(dir, 'one.txt'), 'selected'); const preview = await engine.getPublishPreview(dir);
    await git.branch({ fs, dir, ref: 'other' }); await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/other\n');
    await expect(commitSelectedChanges(dir, author, 'update', { snapshot: preview.snapshot, paths: ['one.txt'] }, scan)).rejects.toThrow('发生了变化');
    expect(await git.resolveRef({ fs, dir, ref: 'main' })).toBe(head); expect(await git.resolveRef({ fs, dir, ref: 'other' })).toBe(head); await cleanMetadata(dir);
  });
  it('checks again just before saving and cleans temporary metadata on failure', async () => {
    const { dir, head, scan } = await fixture(); await writeFile(join(dir, 'one.txt'), 'selected'); const snapshot = await scan(); let calls = 0;
    await expect(commitSelectedChanges(dir, author, 'update', { snapshot: snapshot.preview.snapshot, paths: ['one.txt'] }, async () => { if (++calls === 2) await writeFile(join(dir, 'one.txt'), 'new work during save'); return scan(); })).rejects.toThrow('发生了变化');
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(head); expect(await readFile(join(dir, 'one.txt'), 'utf8')).toBe('new work during save'); await cleanMetadata(dir);
  });
  it('rejects traversal, metadata and Windows alternate stream paths', () => {
    for (const path of ['../secret', '/outside', '.git/config', 'nested/.GIT/index', 'a\\b', 'a:stream', 'a//b', 'a./b']) expect(safeChangePath(path)).toBe(false);
    expect(safeChangePath('src/组件.tsx')).toBe(true);
  });
});

describe('selected publishing retries', () => {
  function remote(engine: GitEngine, head: string | null) { return vi.spyOn(engine as unknown as { fetchRemote: () => Promise<string | null> }, 'fetchRemote').mockResolvedValue(head); }
  it('retries the saved exact version after push failure with zero remaining changes', async () => {
    const { dir, head, engine } = await fixture(); remote(engine, head); await writeFile(join(dir, 'one.txt'), 'selected');
    const preview = await engine.getPublishPreview(dir); const selection = { snapshot: preview.snapshot, paths: ['one.txt'] };
    vi.mocked(git.push).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, error: null, refs: {} });
    const progress: Array<{ cancelable?: boolean; phase: string }> = [];
    await expect(engine.publishUpdate(dir, repo, author, 'fixture-token', 'selected update', (value) => progress.push(value), selection)).rejects.toThrow('重试发布');
    const saved = await git.resolveRef({ fs, dir, ref: 'HEAD' }); expect(saved).not.toBe(head); expect((await engine.getStatus(dir)).files).toEqual([]); expect((await engine.getStatus(dir)).pendingPublish).toBe(true);
    expect(progress.find((item) => item.phase === '正在保存选中的修改')?.cancelable).toBe(false);
    const result = await engine.publishUpdate(dir, repo, author, 'fixture-token', 'selected update', undefined, selection); expect(result.head).toBe(saved); expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(saved);
    expect(vi.mocked(git.push).mock.calls.map(([options]) => ({ ref: options.ref, remoteRef: options.remoteRef, force: options.force }))).toEqual([{ ref: saved, remoteRef: 'refs/heads/main', force: false }, { ref: saved, remoteRef: 'refs/heads/main', force: false }]);
    expect((await engine.getStatus(dir)).pendingPublish).toBe(false); await cleanMetadata(dir);
  });
  it('uploads existing local versions without falsely reporting remote changes', async () => {
    const { dir, head, engine } = await fixture(); await writeFile(join(dir, 'one.txt'), 'existing saved'); await git.add({ fs, dir, filepath: 'one.txt' }); const saved = await git.commit({ fs, dir, author, message: 'saved elsewhere' });
    remote(engine, head); vi.mocked(git.push).mockResolvedValue({ ok: true, error: null, refs: {} }); const preview = await engine.getPublishPreview(dir);
    expect((await engine.publishUpdate(dir, repo, author, 'fixture-token', 'upload saved', undefined, { snapshot: preview.snapshot, paths: [] })).head).toBe(saved); expect(vi.mocked(git.push).mock.calls[0]?.[0].ref).toBe(saved);
  });
  it('rejects a checkout during the remote check without publishing to the wrong version', async () => {
    const { dir, head, engine } = await fixture(); await git.branch({ fs, dir, ref: 'other' }); await writeFile(join(dir, 'one.txt'), 'selected'); const preview = await engine.getPublishPreview(dir);
    remote(engine, head).mockImplementation(async () => { await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/other\n'); return head; });
    await expect(engine.publishUpdate(dir, repo, author, 'fixture-token', 'update', undefined, { snapshot: preview.snapshot, paths: ['one.txt'] })).rejects.toThrow('工作版本发生了变化'); expect(git.push).not.toHaveBeenCalled(); expect(await git.resolveRef({ fs, dir, ref: 'main' })).toBe(head); await cleanMetadata(dir);
  });
  it('does not mix remaining edits into a saved-version retry after refreshing the preview', async () => {
    const { dir, head, engine } = await fixture(); remote(engine, head); await writeFile(join(dir, 'one.txt'), 'selected'); await writeFile(join(dir, 'other.txt'), 'unselected');
    const first = await engine.getPublishPreview(dir); vi.mocked(git.push).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, error: null, refs: {} });
    await expect(engine.publishUpdate(dir, repo, author, 'fixture-token', 'update', undefined, { snapshot: first.snapshot, paths: ['one.txt'] })).rejects.toThrow('重试发布');
    const saved = await git.resolveRef({ fs, dir, ref: 'HEAD' }); await writeFile(join(dir, 'later.txt'), 'later unselected work'); const refreshed = await engine.getPublishPreview(dir);
    await engine.publishUpdate(dir, repo, author, 'fixture-token', 'retry', undefined, { snapshot: refreshed.snapshot, paths: ['other.txt', 'later.txt'] });
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(saved); expect(await blob(dir, saved, 'other.txt')).toBe('original\n'); expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('unselected'); expect(await readFile(join(dir, 'later.txt'), 'utf8')).toBe('later unselected work');
    expect(vi.mocked(git.push).mock.calls.at(-1)?.[0].ref).toBe(saved);
  });
  it('retains the saved-version marker when GitHub returns a rejected upload result', async () => {
    const { dir, head, engine } = await fixture(); remote(engine, head); await writeFile(join(dir, 'one.txt'), 'selected'); const preview = await engine.getPublishPreview(dir);
    vi.mocked(git.push).mockResolvedValue({ ok: false, error: 'denied', refs: {} });
    await expect(engine.publishUpdate(dir, repo, author, 'fixture-token', 'update', undefined, { snapshot: preview.snapshot, paths: ['one.txt'] })).rejects.toThrow('重试发布');
    expect((await engine.getStatus(dir)).pendingPublish).toBe(true);
  });
  it('blocks remote updates before touching the selected or unselected local files', async () => {
    const { dir, head, engine } = await fixture(); await git.branch({ fs, dir, ref: 'cloud' }); await git.checkout({ fs, dir, ref: 'cloud' }); await writeFile(join(dir, 'other.txt'), 'cloud work'); await git.add({ fs, dir, filepath: 'other.txt' }); const cloud = await git.commit({ fs, dir, author, message: 'cloud' }); await git.checkout({ fs, dir, ref: 'main' });
    await writeFile(join(dir, 'one.txt'), 'selected'); await writeFile(join(dir, 'other.txt'), 'unselected local'); const preview = await engine.getPublishPreview(dir); remote(engine, cloud);
    await expect(engine.publishUpdate(dir, repo, author, 'fixture-token', 'update', undefined, { snapshot: preview.snapshot, paths: ['one.txt'] })).rejects.toThrow('GitHub 上有新内容');
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(head); expect(await readFile(join(dir, 'one.txt'), 'utf8')).toBe('selected'); expect(await readFile(join(dir, 'other.txt'), 'utf8')).toBe('unselected local'); expect(git.push).not.toHaveBeenCalled(); await cleanMetadata(dir);
  });
});
