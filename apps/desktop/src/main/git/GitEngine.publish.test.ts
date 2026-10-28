import { afterEach, describe, expect, it } from 'vitest';
import * as git from 'isomorphic-git';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalPublishSelection } from '@easyhub/types';
import { GitEngine } from './GitEngine';
import { pendingPublication } from './LocalChanges';
import type { GitProgress, GitRepository } from './GitEngine';

const author = { name: 'Test', email: 'test@example.com' };
const repo: GitRepository = { owner: 'person', name: 'sample', defaultBranch: 'main' };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

/** GitHub is a map of branch name to head; no network is used. */
class FakeGithubEngine extends GitEngine {
  readonly remote = new Map<string, string>();
  readonly pushes: Array<{ head: string; branch: string }> = [];
  offline = false;
  protected override async remoteBranchHead(_repo: GitRepository, branch: string): Promise<string | null> { return this.remote.get(branch) ?? null; }
  protected override async fetchRemote(_dir: string, _repo: GitRepository, branch: string): Promise<string | null> { return this.remote.get(branch) ?? null; }
  protected override async sendPush(_dir: string, _repo: GitRepository, _token: string, head: string, branch: string): Promise<void> {
    if (this.offline) throw new Error('offline');
    this.pushes.push({ head, branch });
    this.remote.set(branch, head);
  }
}

async function project(files: Record<string, string> = { 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c', 'd.txt': 'd' }): Promise<{ dir: string; engine: FakeGithubEngine; first: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'easyhub-publish-test-')); directories.push(dir);
  await git.init({ fs, dir, defaultBranch: 'main' });
  for (const [name, value] of Object.entries(files)) { await writeFile(join(dir, name), value); await git.add({ fs, dir, filepath: name }); }
  const first = await git.commit({ fs, dir, message: 'start', author });
  const engine = new FakeGithubEngine();
  engine.remote.set('main', first);
  return { dir, engine, first };
}
async function commitFile(dir: string, name: string, value: string, message: string): Promise<string> {
  await writeFile(join(dir, name), value); await git.add({ fs, dir, filepath: name });
  return git.commit({ fs, dir, message, author });
}
async function selectionFor(engine: GitEngine, dir: string, paths: string[], extra: Partial<LocalPublishSelection> = {}): Promise<LocalPublishSelection> {
  return { snapshot: (await engine.getPublishPreview(dir)).snapshot, paths, ...extra };
}
async function messages(dir: string): Promise<string[]> { return (await git.log({ fs, dir })).map((entry) => entry.commit.message.trim()); }
async function waiting(dir: string, branch: string) { return pendingPublication(dir, await git.resolveRef({ fs, dir, ref: branch }), branch); }
async function startFeature(dir: string): Promise<void> { await git.branch({ fs, dir, ref: 'feature', checkout: true }); }

describe('publishing to the current branch', () => {
  it('publishes to the default branch exactly as before', async () => {
    const { dir, engine } = await project();
    await writeFile(join(dir, 'a.txt'), 'a changed');
    const result = await engine.publishUpdate(dir, repo, author, 'token', 'Change a', undefined, await selectionFor(engine, dir, ['a.txt']));
    expect(result.changed).toBe(1);
    expect(engine.pushes).toEqual([{ head: result.head, branch: 'main' }]);
    expect(await messages(dir)).toEqual(['Change a', 'start']);
    expect(await waiting(dir, 'main')).toBeNull();
  });

  it('publishes a snapshot from another branch to the same-named GitHub branch and leaves the default branch alone', async () => {
    const { dir, engine, first } = await project();
    await startFeature(dir);
    await writeFile(join(dir, 'b.txt'), 'b on feature');
    const result = await engine.publishUpdate(dir, repo, author, 'token', 'Feature work', undefined, await selectionFor(engine, dir, ['b.txt']));
    expect(engine.pushes).toEqual([{ head: result.head, branch: 'feature' }]);
    expect(engine.remote.get('main')).toBe(first);
    expect(engine.remote.get('feature')).toBe(result.head);
    expect(await git.currentBranch({ fs, dir })).toBe('feature');
  });

  it('refuses a selection reviewed on a different branch', async () => {
    const { dir, engine } = await project();
    await writeFile(join(dir, 'a.txt'), 'changed');
    const reviewedOnMain = await selectionFor(engine, dir, ['a.txt']);
    await startFeature(dir);
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Wrong branch', undefined, reviewedOnMain)).rejects.toThrow('文件在你查看后又发生了变化');
    expect(engine.pushes).toEqual([]);
    expect(await messages(dir)).toEqual(['start']);
  });

  it('refuses to publish from a detached head', async () => {
    const { dir, engine, first } = await project();
    await git.checkout({ fs, dir, ref: first });
    await writeFile(join(dir, 'a.txt'), 'changed');
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Detached', undefined, { snapshot: 'a'.repeat(64), paths: ['a.txt'] })).rejects.toThrow('暂时无法确认项目的当前工作版本');
    expect(engine.pushes).toEqual([]);
  });

  it('still asks for confirmation of sensitive files on any branch', async () => {
    const { dir, engine } = await project();
    await startFeature(dir);
    await writeFile(join(dir, '.env'), 'TOKEN=secret');
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Env', undefined, await selectionFor(engine, dir, ['.env']))).rejects.toThrow('[SENSITIVE_FILES]');
    expect(engine.pushes).toEqual([]);
    expect(await messages(dir)).toEqual(['start']);
    const confirmed = await engine.publishUpdate(dir, repo, author, 'token', 'Env', undefined, await selectionFor(engine, dir, ['.env'], { sensitiveConfirmed: true }));
    expect(confirmed.changed).toBe(1);
    expect(engine.pushes.at(-1)?.branch).toBe('feature');
  });

  it('keeps a failed upload waiting on its own branch and retries it without saving the version twice', async () => {
    const { dir, engine } = await project();
    await startFeature(dir);
    await writeFile(join(dir, 'a.txt'), 'changed');
    engine.offline = true;
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Feature a', undefined, await selectionFor(engine, dir, ['a.txt']))).rejects.toThrow('还没有上传成功');
    const savedHead = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    expect(await waiting(dir, 'feature')).toMatchObject({ head: savedHead, branch: 'feature', paths: ['a.txt'] });
    expect((await engine.getStatus(dir)).pendingPublish).toBe(true);
    // Another branch never sees this waiting upload.
    await git.checkout({ fs, dir, ref: 'main' });
    expect((await engine.getStatus(dir)).pendingPublish).toBe(false);
    await git.checkout({ fs, dir, ref: 'feature' });
    engine.offline = false;
    const retry = await engine.publishUpdate(dir, repo, author, 'token', 'retry', undefined, await selectionFor(engine, dir, []));
    expect(retry).toEqual({ head: savedHead, changed: 1 });
    expect(engine.pushes).toEqual([{ head: savedHead, branch: 'feature' }]);
    expect(await messages(dir)).toEqual(['Feature a', 'start']);
    expect(await waiting(dir, 'feature')).toBeNull();
  });

  it('does not clear one branch\'s waiting upload when another branch is published', async () => {
    const { dir, engine } = await project();
    await startFeature(dir);
    await writeFile(join(dir, 'a.txt'), 'feature change');
    engine.offline = true;
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Feature a', undefined, await selectionFor(engine, dir, ['a.txt']))).rejects.toThrow();
    engine.offline = false;
    const featureHead = await git.resolveRef({ fs, dir, ref: 'feature' });
    await git.checkout({ fs, dir, ref: 'main', force: true });
    await writeFile(join(dir, 'b.txt'), 'main change');
    await engine.publishUpdate(dir, repo, author, 'token', 'Main b', undefined, await selectionFor(engine, dir, ['b.txt']));
    expect(engine.pushes.map((push) => push.branch)).toEqual(['main']);
    // The upload that is still waiting on the feature branch is neither cleared nor overwritten.
    expect(await pendingPublication(dir, featureHead, 'feature')).toMatchObject({ head: featureHead, branch: 'feature', paths: ['a.txt'] });
    expect(await waiting(dir, 'main')).toBeNull();
  });
});

describe('publishing in several steps', () => {
  it('saves one version per batch in order and uploads once', async () => {
    const { dir, engine, first } = await project();
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) await writeFile(join(dir, name), `${name} changed`);
    const progress: GitProgress[] = [];
    const selection = await selectionFor(engine, dir, ['a.txt', 'b.txt', 'c.txt'], {
      batches: [{ paths: ['a.txt'], message: 'First' }, { paths: ['b.txt', 'c.txt'] }],
    });
    const result = await engine.publishUpdate(dir, repo, author, 'token', 'Shared message', (value) => progress.push(value), selection);
    expect(result.changed).toBe(3);
    expect(await messages(dir)).toEqual(['Shared message', 'First', 'start']);
    expect(engine.pushes).toEqual([{ head: result.head, branch: 'main' }]);
    expect(engine.remote.get('main')).toBe(result.head);
    expect(await git.isDescendent({ fs, dir, oid: result.head, ancestor: first })).toBe(true);
    // The file that was not selected is still waiting on this computer.
    expect((await engine.getStatus(dir)).files).toEqual([{ path: 'd.txt', kind: 'modified' }]);
    expect(progress.some((value) => value.phase.includes('1/2'))).toBe(true);
  });

  it('rejects batches that do not match the selected files before saving anything', async () => {
    const { dir, engine } = await project();
    for (const name of ['a.txt', 'b.txt']) await writeFile(join(dir, name), `${name} changed`);
    const selection = await selectionFor(engine, dir, ['a.txt', 'b.txt'], { batches: [{ paths: ['a.txt'] }, { paths: ['a.txt'] }] });
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Bad', undefined, selection)).rejects.toThrow('分批发布的文件选择无效');
    expect(await messages(dir)).toEqual(['start']);
  });

  it('checks every batch for sensitive files before saving the first one', async () => {
    const { dir, engine } = await project();
    await writeFile(join(dir, 'a.txt'), 'a changed');
    await writeFile(join(dir, '.env'), 'TOKEN=secret');
    const selection = await selectionFor(engine, dir, ['a.txt', '.env'], { batches: [{ paths: ['a.txt'] }, { paths: ['.env'] }] });
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Two steps', undefined, selection)).rejects.toThrow('[SENSITIVE_FILES]');
    expect(await messages(dir)).toEqual(['start']);
    expect(engine.pushes).toEqual([]);
  });

  it('keeps saved batches waiting to upload when a later batch fails, and never saves them again', async () => {
    const { dir, engine } = await project();
    for (const name of ['a.txt', 'b.txt']) await writeFile(join(dir, name), `${name} changed`);
    const selection = await selectionFor(engine, dir, ['a.txt', 'b.txt'], { batches: [{ paths: ['a.txt'], message: 'Step one' }, { paths: ['b.txt'], message: 'Step two' }] });
    // The second file changes after the first version is saved.
    const edit = (value: GitProgress): void => { if (value.loaded === 1 && value.total === 2) fs.writeFileSync(join(dir, 'b.txt'), 'edited meanwhile'); };
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Shared', edit, selection)).rejects.toThrow('前 1 批已安全保存到本地，第 2 批没有完成');
    const savedHead = await git.resolveRef({ fs, dir, ref: 'HEAD' });
    expect(await messages(dir)).toEqual(['Step one', 'start']);
    expect(engine.pushes).toEqual([]);
    expect(await waiting(dir, 'main')).toMatchObject({ head: savedHead, branch: 'main', paths: ['a.txt'] });
    expect((await engine.getStatus(dir)).pendingPublish).toBe(true);
    const retry = await engine.publishUpdate(dir, repo, author, 'token', 'retry', undefined, await selectionFor(engine, dir, []));
    expect(retry).toEqual({ head: savedHead, changed: 1 });
    expect(engine.pushes).toEqual([{ head: savedHead, branch: 'main' }]);
    expect(await messages(dir)).toEqual(['Step one', 'start']);
    expect((await engine.getStatus(dir)).files).toEqual([{ path: 'b.txt', kind: 'modified' }]);
  });

  it('counts every saved file when a multi-step upload is retried', async () => {
    const { dir, engine } = await project();
    for (const name of ['a.txt', 'b.txt']) await writeFile(join(dir, name), `${name} changed`);
    const selection = await selectionFor(engine, dir, ['a.txt', 'b.txt'], { batches: [{ paths: ['a.txt'] }, { paths: ['b.txt'] }] });
    engine.offline = true;
    await expect(engine.publishUpdate(dir, repo, author, 'token', 'Both', undefined, selection)).rejects.toThrow('还没有上传成功');
    expect(await messages(dir)).toEqual(['Both', 'Both', 'start']);
    engine.offline = false;
    const retry = await engine.publishUpdate(dir, repo, author, 'token', 'retry', undefined, await selectionFor(engine, dir, []));
    expect(retry.changed).toBe(2);
    expect(engine.remote.get('main')).toBe(retry.head);
  });
});

describe('pushing a branch', () => {
  it('uploads commits made with another tool exactly as they are', async () => {
    const { dir, engine, first } = await project();
    await startFeature(dir);
    const made = await commitFile(dir, 'extra.txt', 'from another tool', 'Made elsewhere');
    expect((await engine.getStatus(dir)).pushable).toBe(true);
    expect(await engine.pushBranch(dir, repo, 'token')).toEqual({ state: 'created', branch: 'feature' });
    expect(engine.pushes).toEqual([{ head: made, branch: 'feature' }]);
    expect(engine.remote.get('main')).toBe(first);
    expect(await messages(dir)).toEqual(['Made elsewhere', 'start']);
  });

  it('pushes new commits onto an existing GitHub branch when GitHub is behind', async () => {
    const { dir, engine, first } = await project();
    const made = await commitFile(dir, 'extra.txt', 'later work', 'Later work');
    await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/main', value: first, force: true });
    expect((await engine.getStatus(dir)).pushable).toBe(true);
    expect(await engine.pushBranch(dir, repo, 'token')).toEqual({ state: 'pushed', branch: 'main' });
    expect(engine.remote.get('main')).toBe(made);
  });

  it('says the branch is already current when GitHub has the same version', async () => {
    const { dir, engine } = await project();
    expect(await engine.pushBranch(dir, repo, 'token')).toEqual({ state: 'current', branch: 'main' });
    expect(engine.pushes).toEqual([]);
  });

  it('refuses a diverged branch and never forces', async () => {
    const { dir, engine, first } = await project();
    await commitFile(dir, 'mine.txt', 'mine', 'Local only');
    const githubHead = await (async () => {
      await git.branch({ fs, dir, ref: 'other', object: first, checkout: true });
      const oid = await commitFile(dir, 'theirs.txt', 'theirs', 'Only on GitHub');
      await git.checkout({ fs, dir, ref: 'main', force: true });
      return oid;
    })();
    engine.remote.set('main', githubHead);
    await expect(engine.pushBranch(dir, repo, 'token')).rejects.toThrow('GitHub 上这个分支有新内容');
    expect(engine.pushes).toEqual([]);
    expect(engine.remote.get('main')).toBe(githubHead);
  });

  it('refuses while files still have unpublished changes', async () => {
    const { dir, engine } = await project();
    await startFeature(dir);
    await commitFile(dir, 'extra.txt', 'x', 'Made elsewhere');
    await writeFile(join(dir, 'a.txt'), 'edited');
    await expect(engine.pushBranch(dir, repo, 'token')).rejects.toThrow('还有没发布的修改');
    expect(engine.pushes).toEqual([]);
  });

  it('reports a failed upload with a friendly message', async () => {
    const { dir, engine } = await project();
    await startFeature(dir);
    await commitFile(dir, 'extra.txt', 'x', 'Made elsewhere');
    engine.offline = true;
    await expect(engine.pushBranch(dir, repo, 'token')).rejects.toThrow('分支没有推送成功');
  });
});

describe('switching and creating branches', () => {
  it('creates a branch, keeps unpublished edits and refuses bad or repeated names', async () => {
    const { dir, engine } = await project();
    await writeFile(join(dir, 'a.txt'), 'edited');
    expect(await engine.createBranch(dir, 'feature/login')).toEqual({ current: 'feature/login', branches: ['feature/login'] });
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('edited');
    await expect(engine.createBranch(dir, 'feature/login')).rejects.toThrow('已经有叫这个名字的分支');
    await expect(engine.createBranch(dir, 'bad name')).rejects.toThrow('分支名只能用');
    await expect(engine.createBranch(dir, 'a..b')).rejects.toThrow('分支名只能用');
  });

  it('switches only when nothing is waiting to be published', async () => {
    const { dir, engine } = await project();
    await startFeature(dir);
    await writeFile(join(dir, 'a.txt'), 'edited');
    await expect(engine.switchBranch(dir, 'main')).rejects.toThrow('还有没发布的修改');
    expect((await engine.listBranches(dir)).current).toBe('feature');
    await writeFile(join(dir, 'a.txt'), 'a');
    expect((await engine.switchBranch(dir, 'main')).current).toBe('main');
    await expect(engine.switchBranch(dir, 'missing')).rejects.toThrow('找不到这个分支');
  });
});
