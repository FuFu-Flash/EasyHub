import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LocalProjectRecord { id: string; repositoryId: number; owner: string; name: string; localPath: string; lastOpenedAt: string }

export class LocalProjectStore {
  private records: LocalProjectRecord[] | null = null;
  private saving: Promise<void> = Promise.resolve();
  private editing: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async list(): Promise<LocalProjectRecord[]> {
    if (!this.records) {
      try {
        const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
        this.records = Array.isArray(parsed) ? parsed.filter((item): item is LocalProjectRecord =>
          typeof item === 'object' && item !== null && typeof item.id === 'string' &&
          Number.isSafeInteger(item.repositoryId) && typeof item.localPath === 'string' &&
          typeof item.owner === 'string' && typeof item.name === 'string' && typeof item.lastOpenedAt === 'string') : [];
      } catch { this.records = []; }
    }
    return [...this.records];
  }

  async upsert(input: Omit<LocalProjectRecord, 'id' | 'lastOpenedAt'>): Promise<LocalProjectRecord> {
    return this.edit(async () => {
    const all = await this.list();
    const prior = all.find((item) => item.localPath === input.localPath);
    const record: LocalProjectRecord = { ...input, id: prior?.id ?? randomUUID(), lastOpenedAt: new Date().toISOString() };
    this.records = [...all.filter((item) => item.id !== record.id), record];
    await this.persist();
    return record;
    });
  }

  async remove(id: string): Promise<void> {
    return this.edit(async () => {
    this.records = (await this.list()).filter((item) => item.id !== id);
    await this.persist();
    });
  }

  async relocate(id: string, localPath: string): Promise<LocalProjectRecord> {
    return this.edit(async () => {
    const all = await this.list();
    const prior = all.find((item) => item.id === id);
    if (!prior) throw new Error('找不到这个本地项目。');
    if (all.some((item) => item.id !== id && item.localPath.toLowerCase() === localPath.toLowerCase())) throw new Error('这个文件夹已经添加到另一个本地项目。');
    const record = { ...prior, localPath, lastOpenedAt: new Date().toISOString() };
    this.records = all.map((item) => item.id === id ? record : item);
    await this.persist();
    return record;
    });
  }

  private async edit<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.editing;
    let release = (): void => undefined;
    this.editing = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = this.records;
    try { return await work(); }
    catch (error) { this.records = before; throw error; }
    finally { release(); }
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.records);
    this.saving = this.saving.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${randomUUID()}.tmp`;
      try { await writeFile(temp, snapshot, 'utf8'); await rename(temp, this.filePath); }
      finally { await rm(temp, { force: true }).catch(() => undefined); }
    });
    await this.saving;
  }
}
