import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// This optional live check writes only to EasyHub's existing account-check repository.
const owner = 'FuFu-Flash';
const repo = 'easyhub-account-check-20260924-dhaqxv';
const parent = await mkdtemp(join(tmpdir(), 'easyhub-local-check-'));
const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  const page = await app.firstWindow();
  const auth = await page.evaluate(() => window.easyHub?.authStatus());
  if (auth?.user?.login !== owner) throw new Error('The account-check repository owner is not signed in.');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, parent);
  const selected = await page.evaluate(() => window.easyHub?.chooseFolder());
  assert.equal(selected, await realpath(parent));
  const link = await page.evaluate(({ owner, repo, path }) => window.easyHub?.localDownload(owner, repo, path), { owner, repo, path: selected });
  assert.equal(link.name, repo);
  const localPath = join(parent, repo);
  assert.equal(link.localPath, localPath);
  assert.ok((await readFile(join(localPath, 'README.md'), 'utf8')).length > 0);
  assert.deepEqual((await page.evaluate((id) => window.easyHub?.localStatus(id), link.id)).files, []);

  const filename = `phase3-check-${randomUUID()}.txt`;
  const message = `验证本地项目发布 ${filename}`;
  await writeFile(join(localPath, filename), 'EasyHub local project check\n');
  const changed = await page.evaluate((id) => window.easyHub?.localStatus(id), link.id);
  assert.ok(changed.files.some((file) => file.path === filename && file.kind === 'added'));
  const published = await page.evaluate(({ id, message }) => window.easyHub?.localPublish(id, message), { id: link.id, message });
  assert.ok(published.changed >= 1);
  assert.deepEqual((await page.evaluate((id) => window.easyHub?.localStatus(id), link.id)).files, []);
  const commits = await page.evaluate(({ owner, repo }) => window.easyHub?.github('commits', owner, repo), { owner, repo });
  assert.equal(commits[0]?.commit.message, message);
  process.stdout.write('Live local clone, change scan, publish and GitHub history check passed.\n');
} finally {
  await app.close();
  const resolved = await realpath(parent).catch(() => null);
  const temp = await realpath(tmpdir());
  if (resolved?.startsWith(`${temp}${sep}easyhub-local-check-`)) await rm(resolved, { recursive: true, force: true });
}
