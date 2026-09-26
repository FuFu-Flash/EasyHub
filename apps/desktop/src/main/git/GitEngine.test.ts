import { afterEach, describe, expect, it } from 'vitest';
import * as git from 'isomorphic-git';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir, rename, unlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitEngine, parseGithubOrigin } from './GitEngine';

const directories: string[] = [];
async function folder(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'easyhub-git-test-')); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('GitEngine', () => {
  it('recognizes edits to an existing file after an earlier clean scan', async () => {
    const dir = await folder();
    await git.init({ fs, dir, defaultBranch: 'main' });
    await writeFile(join(dir, 'existing.txt'), 'first');
    await git.add({ fs, dir, filepath: 'existing.txt' });
    await git.commit({ fs, dir, message: 'start', author: { name: 'Test', email: 'test@example.com' } });
    const engine = new GitEngine();
    expect((await engine.getStatus(dir)).files).toEqual([]);
    await writeFile(join(dir, 'existing.txt'), 'later');
    expect((await engine.getStatus(dir)).files).toEqual([{ path: 'existing.txt', kind: 'modified' }]);
    await writeFile(join(dir, 'existing.txt'), 'again');
    expect((await engine.getStatus(dir)).files).toEqual([{ path: 'existing.txt', kind: 'modified' }]);
  });

  async function cloudChange(localFiles: Record<string, string>, cloudFiles: Record<string, string>, removed: string[] = []) {
    const dir = await folder(); const author = { name: 'Test', email: 'test@example.com' };
    await git.init({ fs, dir, defaultBranch: 'main' });
    for (const [name, value] of Object.entries(localFiles)) { await writeFile(join(dir, name), value); await git.add({ fs, dir, filepath: name }); }
    await git.commit({ fs, dir, message: 'start', author });
    await git.branch({ fs, dir, ref: 'cloud' }); await git.checkout({ fs, dir, ref: 'cloud' });
    for (const [name, value] of Object.entries(cloudFiles)) { await writeFile(join(dir, name), value); await git.add({ fs, dir, filepath: name, force: true }); }
    for (const name of removed) { await unlink(join(dir, name)); await git.remove({ fs, dir, filepath: name }); }
    const cloudHead = await git.commit({ fs, dir, message: 'cloud', author });
    await git.checkout({ fs, dir, ref: 'main' });
    return { dir, cloudHead };
  }

  it('safely applies a remote update while retaining changes in a different local file', async () => {
    const { dir, cloudHead } = await cloudChange({ 'local.txt': 'before' }, { 'cloud.txt': 'from cloud' });
    await writeFile(join(dir, 'local.txt'), 'my work');
    const engine = new GitEngine();
    expect((await engine.inspectSync(dir, cloudHead)).state).toBe('ready');
    expect(await engine.applyFetchedSync(dir, 'main', cloudHead)).toEqual({ updated: 1 });
    expect(await readFile(join(dir, 'local.txt'), 'utf8')).toBe('my work');
    expect(await readFile(join(dir, 'cloud.txt'), 'utf8')).toBe('from cloud');
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(cloudHead);
    expect((await engine.getStatus(dir)).files).toEqual([{ path: 'local.txt', kind: 'modified' }]);
  });

  it('requires an explicit file choice when both sides changed the same file', async () => {
    const { dir, cloudHead } = await cloudChange({ 'shared.txt': 'before' }, { 'shared.txt': 'cloud version' });
    await writeFile(join(dir, 'shared.txt'), 'my version');
    const engine = new GitEngine();
    const preview = await engine.inspectSync(dir, cloudHead);
    expect(preview.state).toBe('review');
    expect(preview.files).toEqual([{ path: 'shared.txt', mine: 'my version', github: 'cloud version', previewable: true }]);
    await expect(engine.applyFetchedSync(dir, 'main', cloudHead)).rejects.toThrow('请先确认');
    expect(await readFile(join(dir, 'shared.txt'), 'utf8')).toBe('my version');
    await engine.applyFetchedSync(dir, 'main', cloudHead, [{ path: 'shared.txt', choice: 'mine' }]);
    expect(await readFile(join(dir, 'shared.txt'), 'utf8')).toBe('my version');
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(cloudHead);
    expect((await engine.getStatus(dir)).files).toEqual([{ path: 'shared.txt', kind: 'modified' }]);
  });

  it('uses the GitHub version only after an explicit choice', async () => {
    const { dir, cloudHead } = await cloudChange({ 'shared.txt': 'before' }, { 'shared.txt': 'cloud version' });
    await writeFile(join(dir, 'shared.txt'), 'my version');
    const engine = new GitEngine();
    await engine.applyFetchedSync(dir, 'main', cloudHead, [{ path: 'shared.txt', choice: 'github' }]);
    expect(await readFile(join(dir, 'shared.txt'), 'utf8')).toBe('cloud version');
    expect((await engine.getStatus(dir)).files).toEqual([]);
  });

  it('asks before removing a tracked file deleted on GitHub', async () => {
    const { dir, cloudHead } = await cloudChange({ 'keep.txt': 'important' }, {}, ['keep.txt']);
    const engine = new GitEngine();
    expect((await engine.inspectSync(dir, cloudHead)).files[0]?.path).toBe('keep.txt');
    await expect(engine.applyFetchedSync(dir, 'main', cloudHead)).rejects.toThrow('请先确认');
    expect(await readFile(join(dir, 'keep.txt'), 'utf8')).toBe('important');
    await engine.applyFetchedSync(dir, 'main', cloudHead, [{ path: 'keep.txt', choice: 'mine' }]);
    expect(await readFile(join(dir, 'keep.txt'), 'utf8')).toBe('important');
    expect((await engine.getStatus(dir)).files).toEqual([{ path: 'keep.txt', kind: 'added' }]);
  });

  it('removes a file only after choosing the GitHub version', async () => {
    const { dir, cloudHead } = await cloudChange({ 'old.txt': 'important' }, {}, ['old.txt']);
    const engine = new GitEngine();
    await engine.applyFetchedSync(dir, 'main', cloudHead, [{ path: 'old.txt', choice: 'github' }]);
    expect((await engine.getStatus(dir)).files).toEqual([]);
    await expect(readFile(join(dir, 'old.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('updates an unchanged local file and leaves no pending changes', async () => {
    const { dir, cloudHead } = await cloudChange({ 'shared.txt': 'before' }, { 'shared.txt': 'cloud' });
    const engine = new GitEngine();
    expect((await engine.inspectSync(dir, cloudHead)).state).toBe('ready');
    await engine.applyFetchedSync(dir, 'main', cloudHead);
    expect(await readFile(join(dir, 'shared.txt'), 'utf8')).toBe('cloud');
    expect((await engine.getStatus(dir)).files).toEqual([]);
  });

  it('stops an incomplete sync from advancing files or the project revision', async () => {
    const { dir, cloudHead } = await cloudChange({ 'shared.txt': 'before' }, { 'shared.txt': 'cloud' });
    const originalHead = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    await writeFile(join(dir, '.git', 'easyhub-sync-incomplete'), '{}');
    const engine = new GitEngine();
    await expect(engine.inspectSync(dir, cloudHead)).rejects.toThrow('上次获取最新内容没有完成');
    await expect(engine.applyFetchedSync(dir, 'main', cloudHead)).rejects.toThrow('上次获取最新内容没有完成');
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(originalHead);
    expect(await readFile(join(dir, 'shared.txt'), 'utf8')).toBe('before');
  });

  it('does not overwrite an ignored local file when GitHub adds the same path', async () => {
    const { dir, cloudHead } = await cloudChange({ '.gitignore': 'secret.txt\n' }, { 'secret.txt': 'cloud' });
    await writeFile(join(dir, 'secret.txt'), 'private local data');
    const engine = new GitEngine();
    expect((await engine.getStatus(dir)).files).toEqual([]);
    const preview = await engine.inspectSync(dir, cloudHead);
    expect(preview.state).toBe('review');
    expect(preview.files[0]).toMatchObject({ path: 'secret.txt', mine: 'private local data', github: 'cloud' });
    expect(await readFile(join(dir, 'secret.txt'), 'utf8')).toBe('private local data');
  });

  it('blocks divergent histories without changing the local version', async () => {
    const { dir, cloudHead } = await cloudChange({ 'shared.txt': 'before' }, { 'shared.txt': 'cloud' });
    await writeFile(join(dir, 'shared.txt'), 'locally committed');
    await git.add({ fs, dir, filepath: 'shared.txt' });
    const localHead = await git.commit({ fs, dir, message: 'local', author: { name: 'Test', email: 'test@example.com' } });
    const engine = new GitEngine();
    expect((await engine.inspectSync(dir, cloudHead)).state).toBe('blocked');
    await expect(engine.applyFetchedSync(dir, 'main', cloudHead)).rejects.toThrow();
    expect(await git.resolveRef({ fs, dir, ref: 'HEAD' })).toBe(localHead);
    expect(await readFile(join(dir, 'shared.txt'), 'utf8')).toBe('locally committed');
  });
  it('recognizes GitHub URLs and keeps other remotes out of the project model', () => {
    expect(parseGithubOrigin('https://github.com/person/sample.git')).toEqual({ owner: 'person', repo: 'sample' });
    expect(parseGithubOrigin('git@github.com:person/sample.git')).toEqual({ owner: 'person', repo: 'sample' });
    expect(parseGithubOrigin('https://example.com/person/sample.git')).toBeNull();
  });

  it('reports file changes, honors ignore rules, and does not scan dependency folders', async () => {
    const dir = await folder();
    await git.init({ fs, dir, defaultBranch: 'main' });
    await writeFile(join(dir, '.gitignore'), 'secret.txt\n');
    await writeFile(join(dir, 'kept.txt'), 'old');
    await writeFile(join(dir, 'removed.txt'), 'gone');
    await git.add({ fs, dir, filepath: '.gitignore' });
    await git.add({ fs, dir, filepath: 'kept.txt' });
    await git.add({ fs, dir, filepath: 'removed.txt' });
    await git.commit({ fs, dir, message: 'start', author: { name: 'Test', email: 'test@example.com' } });
    await writeFile(join(dir, 'kept.txt'), 'new');
    await unlink(join(dir, 'removed.txt'));
    await writeFile(join(dir, 'added.txt'), 'hello');
    await writeFile(join(dir, 'secret.txt'), 'hidden');
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'huge.txt'), 'ignored');
    const status = await new GitEngine().getStatus(dir);
    expect(status.files).toEqual(expect.arrayContaining([
      { path: 'kept.txt', kind: 'modified' },
      { path: 'removed.txt', kind: 'deleted' },
      { path: 'added.txt', kind: 'added' },
    ]));
    expect(status.files.map((file) => file.path)).not.toContain('secret.txt');
    expect(status.files.map((file) => file.path)).not.toContain('node_modules/huge.txt');
    expect(status.hasPreparedChanges).toBe(false);
  });

  it('recognizes a same-content rename and detects changes prepared by another tool', async () => {
    const dir = await folder();
    await git.init({ fs, dir, defaultBranch: 'main' });
    await writeFile(join(dir, 'old.txt'), 'same content');
    await git.add({ fs, dir, filepath: 'old.txt' });
    await git.commit({ fs, dir, message: 'start', author: { name: 'Test', email: 'test@example.com' } });
    await rename(join(dir, 'old.txt'), join(dir, 'new.txt'));
    const engine = new GitEngine();
    expect((await engine.getStatus(dir)).files).toContainEqual({ path: 'new.txt', previousPath: 'old.txt', kind: 'renamed' });
    await git.add({ fs, dir, filepath: 'new.txt' });
    expect((await engine.getStatus(dir)).hasPreparedChanges).toBe(true);
  });
});
