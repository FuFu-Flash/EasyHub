import { randomUUID } from 'node:crypto';
import { readdir, readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const omitted = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.next', '.turbo', '.cache', 'dist', 'build', 'target', 'vendor', '$recycle.bin', 'system volume information']);
const maximumDirectories = 5000;
const maximumProjects = 100;
const maximumDepth = 4;

export interface DiscoveryScan { folders: string[]; visited: number; limited: boolean }

export async function findGitProjects(root: string, signal: AbortSignal, onProgress?: (visited: number) => void): Promise<DiscoveryScan> {
  const queue = [{ path: root, depth: 0 }];
  const folders: string[] = [];
  let visited = 0;
  let depthLimited = false;
  for (let index = 0; index < queue.length && visited < maximumDirectories && folders.length < maximumProjects; index += 1) {
    if (signal.aborted) throw new Error('查找已取消。');
    const current = queue[index]!;
    let entries;
    try { entries = await readdir(current.path, { withFileTypes: true }); }
    catch { continue; }
    visited += 1;
    if (visited % 50 === 0) onProgress?.(visited);
    if (entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))) {
      folders.push(current.path);
      continue;
    }
    if (current.depth >= maximumDepth) {
      if (entries.some((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !omitted.has(entry.name.toLowerCase()))) depthLimited = true;
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || omitted.has(entry.name.toLowerCase())) continue;
      queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
    }
  }
  onProgress?.(visited);
  return { folders, visited, limited: depthLimited || visited >= maximumDirectories || folders.length >= maximumProjects };
}

export class DiscoveryRootsStore {
  private roots: string[] | null = null;
  private saving: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    if (!this.roots) {
      try {
        const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
        this.roots = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.length <= 4096).slice(0, 12) : [];
      } catch { this.roots = []; }
    }
    return [...this.roots];
  }

  async add(path: string): Promise<string[]> {
    const roots = await this.list();
    if (roots.includes(path)) return roots;
    if (roots.length >= 12) throw new Error('查找位置已达到上限，请先移除一个位置。');
    this.roots = [...roots, path];
    await this.persist();
    return this.list();
  }

  async remove(path: string): Promise<string[]> {
    this.roots = (await this.list()).filter((root) => root !== path);
    await this.persist();
    return this.list();
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.roots);
    this.saving = this.saving.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, 'utf8');
      await rename(temp, this.filePath);
    });
    await this.saving;
  }
}
