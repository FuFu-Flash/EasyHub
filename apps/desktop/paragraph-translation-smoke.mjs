import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const project = { id: 200, name: 'sample-public', full_name: 'another-author/sample-public', description: 'A public sample', private: false,
  updated_at: new Date().toISOString(), default_branch: 'main', owner: { login: 'another-author' }, open_issues_count: 0 };
const readme = '# Sample project\n\nSee [Guide][guide] and write updates.\n\n' +
  Array.from({ length: 60 }, (_, index) => `Paragraph ${index}: A separate explanation about this public project and how it works.`).join('\n\n') +
  '\n\n[guide]: https://github.com/another-author/sample-public/wiki';

const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  await app.evaluate(({ ipcMain }, { project: sampleProject, readme: sampleReadme }) => {
    ipcMain.removeHandler('easyhub:auth-status');
    ipcMain.handle('easyhub:auth-status', () => ({ user: { login: 'test-user', name: 'Test User', avatar_url: '', html_url: '' }, clientId: 'test-client' }));
    ipcMain.removeHandler('easyhub:github');
    ipcMain.handle('easyhub:github', (_event, action) => {
      if (action === 'repos') return [];
      if (action === 'searchPublicRepos') return [sampleProject];
      if (action === 'readme') return sampleReadme;
      if (action === 'issues' || action === 'commits') return [];
      throw new Error(`Unexpected read: ${action}`);
    });
    ipcMain.removeHandler('easyhub:translate-content');
    globalThis.paragraphTranslationRequests = [];
    ipcMain.handle('easyhub:translate-content', (_event, input) => {
      globalThis.paragraphTranslationRequests.push(input);
      return `译文 ${input.text}`;
    });
    ipcMain.removeHandler('easyhub:cancel-translation');
    ipcMain.handle('easyhub:cancel-translation', () => undefined);
  }, { project, readme });
  const page = await app.firstWindow();
  await page.evaluate(() => { window.localStorage.setItem('easyhub:auto-translate', 'false'); window.localStorage.setItem('easyhub:language', 'zh'); });
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.locator('.sidebar-nav button').nth(1).click();
  await page.getByRole('button', { name: '所有公开项目' }).click();
  await page.locator('.toolbar input').fill('sample');
  await page.locator('.cloud-row').filter({ hasText: 'another-author/sample-public' }).getByRole('button', { name: '只读浏览' }).click();
  const content = page.getByTestId('public-project-browser').locator('.public-browser-content');
  const translation = content.locator('.paragraph-translatable-content');
  await translation.waitFor();
  assert.equal(await translation.locator('.translation-paragraph').count(), 62);
  assert.equal((await app.evaluate(() => globalThis.paragraphTranslationRequests)).length, 0);
  assert.equal(await content.getByRole('link', { name: 'Guide' }).getAttribute('href'), 'https://github.com/another-author/sample-public/wiki');

  await page.getByRole('button', { name: '开启翻译' }).click();
  await translation.locator('.translation-paragraph').filter({ hasText: 'Paragraph 0:' }).getByText('译文', { exact: false }).waitFor();
  const firstRequests = await app.evaluate(() => globalThis.paragraphTranslationRequests);
  assert.ok(firstRequests.length > 0 && firstRequests.length < 62, 'Only visible paragraphs should translate initially.');
  assert.ok(firstRequests.every((request) => request.text.length < readme.length));
  assert.ok(firstRequests.every((request) => !request.text.includes('Paragraph 59:')));

  const last = translation.locator('.translation-paragraph').filter({ hasText: 'Paragraph 59:' });
  await last.scrollIntoViewIfNeeded();
  await last.getByText('译文', { exact: false }).waitFor();
  assert.ok((await app.evaluate(() => globalThis.paragraphTranslationRequests)).some((request) => request.text.includes('Paragraph 59:')));
  await page.screenshot({ path: 'out/paragraph-translation-smoke.png' });
  await page.getByRole('button', { name: '关闭翻译' }).click();
  assert.equal(await last.getByText('译文', { exact: false }).count(), 0);
  await page.setViewportSize({ width: 700, height: 760 });
  await page.getByRole('button', { name: '开启翻译' }).click();
  const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  assert.ok(layout.content <= layout.viewport + 1, `Narrow README should not overflow horizontally: ${JSON.stringify(layout)}`);
  await page.screenshot({ path: 'out/paragraph-translation-narrow-smoke.png' });
  process.stdout.write('Paragraph translation UI smoke test passed.\n');
} finally { await app.close(); }
