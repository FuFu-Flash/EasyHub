import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { GitHubUser } from '@easyhub/github';

const fingerprint = (token: string): string => createHash('sha256').update(token).digest('hex');
export class AuthProfileCache {
  constructor(private readonly file: string) {}
  async read(token: string): Promise<GitHubUser | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as { credential?: string; user?: GitHubUser };
      const user = value.user;
      if (value.credential !== fingerprint(token) || !user || typeof user.login !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(user.login)
        || typeof user.avatar_url !== 'string' || user.name !== null && typeof user.name !== 'string') return null;
      return { login: user.login, name: user.name, avatar_url: user.avatar_url, html_url: `https://github.com/${user.login}` };
    } catch { return null; }
  }
  async save(token: string, user: GitHubUser): Promise<void> {
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(temp, JSON.stringify({ credential: fingerprint(token), user: { login: user.login, name: user.name ?? null, avatar_url: user.avatar_url ?? '', html_url: `https://github.com/${user.login}` } }), { mode: 0o600, flag: 'wx' });
      await rename(temp, this.file);
    } finally { await rm(temp, { force: true }); }
  }
  async clear(): Promise<void> { await rm(this.file, { force: true }); }
}
