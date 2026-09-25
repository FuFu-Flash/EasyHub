import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const savePath = join(process.cwd(), 'out', `easyhub-download-check-${randomUUID()}.zip`);
const assetPath = join(process.cwd(), 'out', `easyhub-asset-check-${randomUUID()}.download`);
const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  const page = await app.firstWindow();
  const status = await page.evaluate(() => window.easyHub?.authStatus());
  if (!status?.user) throw new Error('EasyHub is not currently signed in; live project download could not be checked.');
  await page.evaluate(() => { window.easyhubDownloadCheckProgress = []; window.easyhubDownloadCheckStop = window.easyHub.onDownloadProgress((value) => window.easyhubDownloadCheckProgress.push(value)); });
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, savePath);
  const result = await page.evaluate(() => window.easyHub?.downloadArchive('octocat', 'Hello-World', 'master'));
  assert.equal(result, savePath);
  const [file, details] = await Promise.all([readFile(savePath), stat(savePath)]);
  assert.equal(file.subarray(0, 2).toString(), 'PK');
  assert.ok(details.size > 100, 'Downloaded ZIP should contain project files.');
  const archiveProgress = await page.evaluate(() => window.easyhubDownloadCheckProgress);
  assert.equal(archiveProgress.at(-1)?.percent, 100);
  assert.equal(archiveProgress.at(-1)?.loaded, details.size);
  process.stdout.write(`Real GitHub project ZIP download passed (${details.size} bytes).\n`);
  await page.evaluate(() => { window.easyhubDownloadCheckProgress = []; });
  const asset = await page.evaluate(async () => {
    const releases = await window.easyHub?.github('releases', 'BurntSushi', 'ripgrep');
    if (!Array.isArray(releases)) return null;
    const choices = releases.flatMap((release) => release.assets ?? []).filter((item) => item.state === 'uploaded' && item.size > 100 && item.size < 5_000_000);
    return choices.sort((a, b) => a.size - b.size)[0] ?? null;
  });
  if (!asset) throw new Error('No small public Release asset was available for the live check.');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, assetPath);
  const assetResult = await page.evaluate((id) => window.easyHub?.downloadReleaseAsset('BurntSushi', 'ripgrep', id), asset.id);
  assert.equal(assetResult, assetPath);
  const downloadedAsset = await readFile(assetPath);
  assert.equal(downloadedAsset.length, asset.size);
  assert.notEqual(downloadedAsset.subarray(0, 1).toString(), '{');
  const assetProgress = await page.evaluate(() => window.easyhubDownloadCheckProgress);
  assert.equal(assetProgress.at(-1)?.percent, 100);
  assert.equal(assetProgress.at(-1)?.loaded, asset.size);
  await page.evaluate(() => window.easyhubDownloadCheckStop());
  process.stdout.write(`Real GitHub Release asset download passed (${asset.name}, ${asset.size} bytes).\n`);
} finally {
  await app.close();
  await unlink(savePath).catch(() => undefined);
  await unlink(assetPath).catch(() => undefined);
}
