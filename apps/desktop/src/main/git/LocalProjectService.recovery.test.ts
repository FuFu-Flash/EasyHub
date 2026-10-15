import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../services/githubService', () => ({}));
vi.mock('./gitTaskRunner', () => ({ runGitTask: vi.fn() }));
import { runGitTask } from './gitTaskRunner';
import { LocalProjectStore } from './LocalProjectStore';
import { LocalProjectService } from './LocalProjectService';

const directories: string[] = []; const services: LocalProjectService[] = [];
afterEach(async () => { services.splice(0).forEach((service) => service.stopWatching()); vi.mocked(runGitTask).mockReset(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'easyhub-local-recovery-')); directories.push(dir);
  const file = join(dir, 'links.json'); const store = new LocalProjectStore(file);
  const record = await store.upsert({ owner: 'tester', name: 'sample', repositoryId: 7, localPath: join(dir, 'old') });
  const service = new LocalProjectService(store, () => undefined); services.push(service);
  const folder = join(dir, 'new'); await mkdir(folder); await writeFile(join(folder, 'keep.txt'), 'keep');
  return { dir, file, store, record, service, folder: await service.grant(folder) };
}
function inspect(path: string, repo = 'sample') { vi.mocked(runGitTask).mockReturnValueOnce({ result: Promise.resolve({ root: path, owner: 'tester', repo, isGit: true }), cancel: vi.fn() }); }
describe('local folder recovery', () => {
  it('preserves identity and persists a validated new location without network', async () => {
    const { record, service, folder, file } = await fixture(); inspect(folder);
    const moved = await service.relocate(record.id, folder);
    expect(moved).toMatchObject({ id: record.id, repositoryId: 7, localPath: folder });
    expect(await new LocalProjectStore(file).list()).toEqual([moved]);
    expect(vi.mocked(runGitTask).mock.calls[0]?.[0].action).toBe('inspect');
  });
  it('rejects a different repository and leaves the old association intact', async () => {
    const { record, service, folder } = await fixture(); inspect(folder, 'other');
    await expect(service.relocate(record.id, folder)).rejects.toThrow('原项目');
    expect(await service.list()).toEqual([record]);
  });
  it('requires a folder-picker grant and refuses to steal another local link', async () => {
    const { dir, record, store, service, folder } = await fixture();
    const ungranted = join(dir, 'ungranted'); await mkdir(ungranted);
    await expect(service.relocate(record.id, ungranted)).rejects.toThrow('选择器');
    await store.upsert({ owner: record.owner, name: record.name, repositoryId: 7, localPath: folder }); inspect(folder);
    await expect(service.relocate(record.id, folder)).rejects.toThrow('已经添加');
    expect((await store.list()).find((item) => item.id === record.id)?.localPath).toBe(record.localPath);
  });
  it('removes only metadata and keeps both local files and cloud identity untouched', async () => {
    const { record, service, folder } = await fixture(); inspect(folder); await service.relocate(record.id, folder);
    vi.mocked(runGitTask).mockClear(); await service.remove(record.id);
    expect(await service.list()).toEqual([]); expect(await readFile(join(folder, 'keep.txt'), 'utf8')).toBe('keep'); expect(runGitTask).not.toHaveBeenCalled();
    await expect(service.remove(record.id)).rejects.toThrow('找不到');
  });
  it('distinguishes a missing folder from an unreadable existing repository', async () => {
    const { record, service, folder } = await fixture();
    vi.mocked(runGitTask).mockReturnValueOnce({ result: Promise.reject(new Error('git lookup failed')), cancel: vi.fn() });
    await expect(service.status(record.id)).rejects.toMatchObject({ code: 'NOT_FOUND', message: '找不到这个文件夹。' });
    inspect(folder); await service.relocate(record.id, folder);
    vi.mocked(runGitTask).mockReturnValueOnce({ result: Promise.reject(new Error('EACCES: denied')), cancel: vi.fn() });
    await expect(service.status(record.id)).rejects.toThrow('EACCES');
  });
  it('keeps associations retryable when saving a removal or new location fails', async () => {
    const { record, store, file, folder } = await fixture();
    const backup = `${file}.backup`;
    await rename(file, backup); await mkdir(file);
    await expect(store.remove(record.id)).rejects.toThrow(); expect(await store.list()).toEqual([record]);
    await expect(store.relocate(record.id, folder)).rejects.toThrow(); expect(await store.list()).toEqual([record]);
    await rm(file, { recursive: true }); await rename(backup, file);
    await store.relocate(record.id, folder); await store.remove(record.id);
    expect(await new LocalProjectStore(file).list()).toEqual([]);
  });
});
