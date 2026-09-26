import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiscoveryRootsStore, findGitProjects } from './LocalProjectDiscovery';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('local project discovery', () => {
  it('finds project roots without descending into dependencies or existing projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-discovery-')); temporary.push(root);
    const project = join(root, 'Projects', 'MyTool');
    await mkdir(join(project, '.git'), { recursive: true });
    await mkdir(join(project, 'nested', '.git'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'other', '.git'), { recursive: true });
    await mkdir(join(root, 'archive'), { recursive: true });
    await writeFile(join(root, 'archive', '.git'), 'gitdir: elsewhere');
    const found = await findGitProjects(root, new AbortController().signal);
    expect(found.folders).toEqual(expect.arrayContaining([project, join(root, 'archive')]));
    expect(found.folders).not.toContain(join(project, 'nested'));
    expect(found.folders).not.toContain(join(root, 'node_modules', 'other'));
  });

  it('does not follow a directory link outside the approved location', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-discovery-')); temporary.push(root);
    const outside = await mkdtemp(join(tmpdir(), 'easyhub-discovery-outside-')); temporary.push(outside);
    await mkdir(join(outside, '.git'));
    try { await symlink(outside, join(root, 'linked'), 'junction'); }
    catch { return; } // Creating a junction can be unavailable in restricted Windows sessions.
    expect((await findGitProjects(root, new AbortController().signal)).folders).toEqual([]);
  });

  it('persists only approved search locations and stops when cancelled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-discovery-')); temporary.push(root);
    const file = join(root, 'roots.json');
    const store = new DiscoveryRootsStore(file);
    expect(await store.add(join(root, 'Projects'))).toEqual([join(root, 'Projects')]);
    expect(await store.add(join(root, 'Projects'))).toHaveLength(1);
    expect(await new DiscoveryRootsStore(file).list()).toEqual([join(root, 'Projects')]);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([join(root, 'Projects')]);
    const cancelled = new AbortController(); cancelled.abort();
    await expect(findGitProjects(root, cancelled.signal)).rejects.toThrow('查找已取消');
  });
});
