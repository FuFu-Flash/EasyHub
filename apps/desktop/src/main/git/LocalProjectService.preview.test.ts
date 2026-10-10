import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../services/githubService', () => ({}));
vi.mock('./gitTaskRunner', () => ({ runGitTask: vi.fn() }));
import { runGitTask } from './gitTaskRunner';
import { LocalProjectService } from './LocalProjectService';
import { LocalProjectStore } from './LocalProjectStore';
const directories: string[] = [];
afterEach(async () => { vi.mocked(runGitTask).mockReset(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'easyhub-preview-service-')); directories.push(dir);
  const store = new LocalProjectStore(join(dir, 'links.json'));
  const first = await store.upsert({ owner: 'fixture', name: 'one', repositoryId: 1, localPath: join(dir, 'one') });
  const second = await store.upsert({ owner: 'fixture', name: 'two', repositoryId: 2, localPath: join(dir, 'two') });
  return { first, second, service: new LocalProjectService(store, () => undefined) };
}
function heldTask() {
  let resolve!: (value: unknown) => void; let reject!: (reason: Error) => void;
  const result = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  const cancel = vi.fn(() => reject(new Error('cancelled fixture preview')));
  vi.mocked(runGitTask).mockReturnValueOnce({ result, cancel });
  return { resolve, cancel };
}
describe('preview cancellation scope', () => {
  it('cancels the active preview and invalidates queued previews of that project', async () => {
    const { service, first } = await fixture(); const task = heldTask();
    const active = service.previewChanges(first.id); const activeError = active.catch((cause: unknown) => cause);
    await vi.waitFor(() => expect(runGitTask).toHaveBeenCalledTimes(1));
    const queued = service.fileDiff(first.id, 'one.txt', 'a'.repeat(64)); const queuedError = queued.catch((cause: unknown) => cause);
    await new Promise((resolve) => setTimeout(resolve, 0)); await service.cancelPreview(first.id);
    expect(await activeError).toBeInstanceOf(Error); expect(await queuedError).toBeInstanceOf(Error); expect(task.cancel).toHaveBeenCalledTimes(1); expect(runGitTask).toHaveBeenCalledTimes(1);
    vi.mocked(runGitTask).mockReturnValueOnce({ result: Promise.resolve({ snapshot: 'b'.repeat(64), files: [], needsReview: false }), cancel: vi.fn() });
    expect((await service.previewChanges(first.id)).snapshot).toBe('b'.repeat(64));
  });
  it('does not cancel another project preview or a non-preview operation', async () => {
    const { service, first, second } = await fixture(); const preview = heldTask(); const reading = service.previewChanges(first.id);
    await vi.waitFor(() => expect(runGitTask).toHaveBeenCalledTimes(1)); await service.cancelPreview(second.id); expect(preview.cancel).not.toHaveBeenCalled(); preview.resolve({ files: [], needsReview: false }); await reading;
    const status = heldTask(); const checking = service.status(first.id); await vi.waitFor(() => expect(runGitTask).toHaveBeenCalledTimes(2)); await service.cancelPreview(first.id); expect(status.cancel).not.toHaveBeenCalled(); status.resolve({ files: [], hasPreparedChanges: false }); await checking;
  });
});
