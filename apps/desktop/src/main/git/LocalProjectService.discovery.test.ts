import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../services/githubService', () => ({
  gitHubIdentity: vi.fn(async () => ({ user: { login: 'mine' }, token: 'not-used' })),
  repositoryDetails: vi.fn(async (owner: string, name: string) => ({ id: owner === 'mine' ? 1 : 2, owner: { login: owner }, name, permissions: { push: owner === 'mine' } })),
}));
vi.mock('./gitTaskRunner', () => ({
  runGitTask: vi.fn((task: { path: string }) => ({ result: Promise.resolve({ root: task.path, isGit: true,
    owner: task.path.endsWith('Owned') ? 'mine' : 'someone-else', repo: 'Sample' }), cancel: () => undefined })),
}));

import { LocalProjectService } from './LocalProjectService';
import { LocalProjectStore } from './LocalProjectStore';
import { DiscoveryRootsStore } from './LocalProjectDiscovery';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('local project auto linking', () => {
  it('registers only a verified writable project from an approved location without changing its files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-auto-link-')); temporary.push(root);
    const search = join(root, 'Projects');
    const owned = join(search, 'Owned');
    const foreign = join(search, 'Foreign');
    await mkdir(join(owned, '.git'), { recursive: true });
    await mkdir(join(foreign, '.git'), { recursive: true });
    await writeFile(join(owned, 'notes.txt'), 'keep my work');
    const service = new LocalProjectService(new LocalProjectStore(join(root, 'links.json')), () => undefined,
      new DiscoveryRootsStore(join(root, 'roots.json')));
    try {
      await service.grant(search);
      await service.addDiscoveryRoot(search);
      const found = await service.scanDiscoveryRoots();
      expect(found.added).toBe(1);
      expect(found.skipped).toBe(1);
      expect(await service.list()).toEqual([expect.objectContaining({ repositoryId: 1, localPath: owned })]);
      expect(await readFile(join(owned, 'notes.txt'), 'utf8')).toBe('keep my work');
      expect((await service.scanDiscoveryRoots()).alreadyAdded).toBe(1);
    } finally { service.stopWatching(); }
  });
});
