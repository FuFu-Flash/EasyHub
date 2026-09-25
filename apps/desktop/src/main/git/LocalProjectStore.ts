import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LocalProjectRecord { id: string; repositoryId: number; owner: string; name: string; localPath: string; lastOpenedAt: string }

export class LocalProjectStore {
  private records: LocalProjectRecord[] | null = null;
  private saving: Promise<void> = Promise.resolve();
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
    const all = await this.list();
    const prior = all.find((item) => item.localPath === input.localPath);
    const record: LocalProjectRecord = { ...input, id: prior?.id ?? randomUUID(), lastOpenedAt: new Date().toISOString() };
    this.records = [...all.filter((item) => item.id !== record.id), record];
    await this.persist();
    return record;
  }

  async remove(id: string): Promise<void> {
    this.records = (await this.list()).filter((item) => item.id !== id);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.records);
    this.saving = this.saving.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${randomUUID()}.tmp`;
      await writeFile(temp, snapshot, 'utf8');
      await rename(temp, this.filePath);
    });
    await this.saving;
  }
}
