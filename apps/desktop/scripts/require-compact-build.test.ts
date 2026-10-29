import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const check = (await import('./require-compact-build.mjs')).default as
  (context: { packager: { info: { appDir: string } } }) => Promise<void>;
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    expect(dirname(directory)).toBe(resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture(main?: string, renderer?: string, platform = 'windows') {
  const root = await mkdtemp(join(tmpdir(), 'easyhub-compact-build-'));
  directories.push(root);
  for (const [target, text] of [['main', main], ['renderer', renderer]]) {
    if (text === undefined) continue;
    const directory = join(root, 'out', platform, target!);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'bundled-dependency-notices.txt'), text);
  }
  return { packager: { info: { appDir: root } } };
}
const mainNotices = 'Permission is hereby granted\nopenai@1\nisomorphic-git@1\nhttps-proxy-agent@1\ntar@1\nyauzl@1';
const rendererNotices = 'Permission is hereby granted\nreact@19\nreact-markdown@10';

it('rejects ordinary builds before dependency filtering can create a broken app', async () => {
  await expect(check(await fixture())).rejects.toThrow('pnpm package:win');
});
it('rejects missing or incomplete dependency license output', async () => {
  await expect(check(await fixture(mainNotices))).rejects.toThrow('pnpm package:win');
  await expect(check(await fixture('openai@1', rendererNotices))).rejects.toThrow('pnpm package:win');
  await expect(check(await fixture(mainNotices.replace('yauzl@1', ''), rendererNotices))).rejects.toThrow('pnpm package:win');
});
it('accepts release output containing the bundled dependency notices', async () => {
  await expect(check(await fixture(mainNotices, rendererNotices))).resolves.toBeUndefined();
});

it('rejects Mac and Linux release output even when it has complete bundled notices', async () => {
  await expect(check(await fixture(mainNotices, rendererNotices, 'macos'))).rejects.toThrow('pnpm package:win');
  await expect(check(await fixture(mainNotices, rendererNotices, 'linux'))).rejects.toThrow('pnpm package:win');
});
