import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// This optional live check publishes one small version to EasyHub's private account-check repository.
const owner = 'FuFu-Flash';
const repo = 'easyhub-account-check-20260924-dhaqxv';
const folder = await mkdtemp(join(tmpdir(), 'easyhub-release-check-'));
const imagePath = join(folder, 'release-preview.png');
const attachmentPath = join(folder, 'release-check.txt');
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const attachment = Buffer.from('EasyHub live release upload check\n', 'utf8');
await writeFile(imagePath, image);
await writeFile(attachmentPath, attachment);
const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ executablePath: packaged ? join(process.cwd(), 'release/win-unpacked/EasyHub.exe') : electronPath,
  args: packaged ? [] : ['.'], cwd: process.cwd() });
try {
  const page = await app.firstWindow();
  const auth = await page.evaluate(() => window.easyHub?.authStatus());
  if (auth?.user?.login !== owner) throw new Error('The account-check repository owner is not signed in.');
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (options) => ({ canceled: false, filePaths: [options.filters?.length ? paths.image : paths.attachment] });
  }, { image: imagePath, attachment: attachmentPath });
  await page.locator('.live-connected').waitFor();
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目' }).click();
  await page.getByRole('button', { name: /我的云端项目/ }).click();
  await page.locator('.cloud-row').filter({ hasText: repo }).getByRole('button', { name: '查看' }).click();
  await page.getByRole('button', { name: '发布新版本' }).click();
  await page.getByRole('heading', { name: '发布新版本' }).waitFor();
  const tag = await page.getByRole('textbox', { name: '版本号' }).inputValue();
  assert.match(tag, /^v0\.\d{2}$/);
  await page.getByRole('textbox', { name: '版本名称' }).fill('EasyHub 真实发布验证');
  await page.getByRole('textbox', { name: '版本介绍' }).fill('验证介绍、图片、链接与多个附件。');
  await page.getByRole('button', { name: '添加图片' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: '选择本地图片' }).click();
  await page.getByRole('button', { name: '添加链接' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: '链接地址' }).fill('https://example.com/easyhub-test');
  await page.getByRole('dialog').getByRole('button', { name: '插入' }).click();
  await page.locator('.release-add-files').click();
  await page.getByRole('button', { name: '预览发布效果' }).click();
  await page.locator('.release-presentation img').waitFor();
  await page.locator('.release-presentation .release-download-row').first().waitFor();
  await page.getByRole('button', { name: '确认发布新版本' }).click();
  await page.locator('.release-download-card').filter({ hasText: tag }).first().waitFor({ timeout: 120000 });
  let published;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const releases = await page.evaluate(({ owner, repo }) => window.easyHub?.github('releases', owner, repo), { owner, repo });
    published = releases.find((item) => item.tag_name === tag);
    if (published && !published.draft) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(published && !published.draft);
  assert.equal(published.name, 'EasyHub 真实发布验证');
  assert.ok(published.body.includes('https://example.com/easyhub-test'));
  assert.ok(published.body.includes(`https://github.com/${owner}/${repo}/releases/download/${tag}/release-preview.png`));
  assert.ok(!published.body.includes('/untagged-'));
  assert.equal(published.assets.length, 2);
  const expected = new Map([[imagePath, image], [attachmentPath, attachment]]);
  for (const [path, bytes] of expected) {
    const asset = published.assets.find((item) => item.name === path.split(/[\\/]/).at(-1));
    assert.ok(asset);
    assert.equal(asset.size, bytes.length);
    assert.equal(asset.digest, `sha256:${createHash('sha256').update(await readFile(path)).digest('hex')}`);
  }
  const downloadedPath = join(folder, 'downloaded-release-check.txt');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, downloadedPath);
  const textAsset = published.assets.find((item) => item.name === 'release-check.txt');
  assert.ok(textAsset);
  const savedPath = await page.evaluate(({ owner, repo, id }) => window.easyHub.downloadReleaseAsset(owner, repo, id), { owner, repo, id: textAsset.id });
  assert.equal(savedPath, downloadedPath);
  assert.deepEqual(await readFile(downloadedPath), attachment);
  process.stdout.write(`${packaged ? 'Packaged' : 'Development'} live release publish, preview, image, link, two uploads and download passed: ${tag}.\n`);
} finally {
  await app.close().catch(() => {});
  await rm(imagePath, { force: true });
  await rm(attachmentPath, { force: true });
  await rmdir(folder).catch(() => {});
}
