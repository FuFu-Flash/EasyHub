import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
it.each(process.platform === 'win32' ? ['package-mac.mjs'] : ['package-win.mjs', 'package-demo.mjs'])(
  'rejects %s on the wrong host before creating artifacts or starting a build', async script => {
    const directory = await mkdtemp(join(tmpdir(), 'easyhub-wrong-platform-'));
    try {
      const result = spawnSync(process.execPath, [join(desktop, script)], {
        cwd: directory, encoding: 'utf8', env: { ...process.env, npm_execpath: '' },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Windows|Apple Silicon/);
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  },
);
