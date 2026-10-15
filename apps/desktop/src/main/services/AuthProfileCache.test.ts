import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthProfileCache } from './AuthProfileCache';
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
describe('cached startup profile', () => {
  it('stores only basic identity without credentials and never restores a different account', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'easyhub-auth-cache-')); folders.push(dir);
    const file = join(dir, 'profile.json'); const cache = new AuthProfileCache(file);
    expect(await cache.read('fixture-token')).toBeNull();
    await cache.save('fixture-token', { login: 'tester', name: 'Test', avatar_url: 'https://example.com/avatar', html_url: '', bio: 'not cached' });
    expect(await cache.read('fixture-token')).toMatchObject({ login: 'tester', name: 'Test' });
    expect(await cache.read('other-token')).toBeNull();
    const bytes = await readFile(file, 'utf8'); expect(bytes).not.toContain('fixture-token'); expect(bytes).not.toContain('not cached');
    await cache.clear(); expect(await cache.read('fixture-token')).toBeNull();
  });
});
