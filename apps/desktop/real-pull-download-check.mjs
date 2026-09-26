import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

// This check only reads the previously authorized test request and downloads
// one of its changed files. It never creates or changes GitHub content.
const desktopDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(desktopDir, 'out');
const repository = { owner: 'Astxswl', repo: 'TEst', number: 1 };
await mkdir(outputDir, { recursive: true });
const runDir = await mkdtemp(join(outputDir, 'pull-download-check-'));
const savePath = join(runDir, 'changed-file.download');
let app;

try {
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.', `--user-data-dir=${join(runDir, 'profile')}`],
    cwd: desktopDir,
  });
  const page = await app.firstWindow();
  const signedIn = await page.evaluate(async () => Boolean((await window.easyHub.authStatus()).user));
  assert.ok(signedIn, 'EasyHub must already be signed in to test real file downloads.');

  const pull = await page.evaluate(({ owner, repo, number }) => window.easyHub.github('pullRequest', owner, repo, number), repository);
  assert.equal(pull.number, repository.number);
  assert.match(pull.head?.sha ?? '', /^[a-f0-9]{40}$/u);
  const context = await page.evaluate(({ owner, repo, number, headSha }) => window.easyHub.github('pullReviewContext', owner, repo, number, headSha), {
    ...repository, headSha: pull.head.sha,
  });
  assert.equal(context.pullRequest.head.sha, pull.head.sha);
  assert.equal(context.repository.full_name.toLowerCase(), 'astxswl/test');
  const selected = context.files.find((file) => file.status !== 'removed' && /^[a-f0-9]{40}$/u.test(file.sha ?? ''));

  if (!selected) {
    process.stdout.write('SKIP: Astxswl/TEst request #1 has no downloadable changed file. No remote content was modified.\n');
  } else {
    await page.evaluate(() => {
      window.easyhubPullDownloadProgress = [];
      window.easyhubPullDownloadStop = window.easyHub.onDownloadProgress((value) => window.easyhubPullDownloadProgress.push(value));
    });
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, savePath);

    const downloaded = await page.evaluate(({ owner, repo, number, filename, headSha }) => window.easyHub.downloadPullRequestFile(owner, repo, number, filename, headSha), {
      ...repository, filename: selected.filename, headSha: pull.head.sha,
    });
    assert.equal(downloaded, savePath);
    const bytes = await readFile(savePath);
    const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blobSha, selected.sha, 'Downloaded bytes must match the file revision listed by GitHub.');
    await page.waitForFunction(() => window.easyhubPullDownloadProgress.at(-1)?.percent === 100, undefined, { timeout: 10_000 });
    const progress = await page.evaluate(() => window.easyhubPullDownloadProgress);
    assert.equal(progress.at(-1)?.percent, 100);
    assert.equal(progress.at(-1)?.loaded, bytes.length);
    assert.equal(progress.at(-1)?.total, bytes.length);
    await page.evaluate(() => window.easyhubPullDownloadStop());

    const after = await page.evaluate(({ owner, repo, number }) => window.easyHub.github('pullRequest', owner, repo, number), repository);
    assert.equal(after.state, pull.state, 'The download check must leave the request state unchanged.');
    assert.equal(after.merged, pull.merged);
    assert.equal(after.head.sha, pull.head.sha);
    process.stdout.write(`PASS: Astxswl/TEst request #1 file ${selected.filename}; ${bytes.length} bytes; blob SHA ${blobSha}; progress 100%; remote request unchanged.\n`);
  }
} finally {
  try { if (app) await app.close(); }
  finally {
    // Only remove the new random folder created by this invocation.
    assert.equal(dirname(resolve(runDir)), outputDir);
    assert.ok(runDir.startsWith(join(outputDir, 'pull-download-check-')));
    await rm(runDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
