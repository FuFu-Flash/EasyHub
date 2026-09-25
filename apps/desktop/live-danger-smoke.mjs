import assert from 'node:assert/strict';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const packaged = process.argv.includes('--packaged');
const app = await electron.launch({ executablePath: packaged ? join(process.cwd(), 'release/win-unpacked/EasyHub.exe') : electronPath, args: packaged ? [] : ['.'], cwd: process.cwd() });
try {
  await app.evaluate(({ ipcMain }) => {
    const repo = { id: 901, name: 'owned-repo', full_name: 'test-owner/owned-repo', description: 'A sample project', private: false, archived: false, permissions: { admin: true, push: true, pull: true }, updated_at: new Date().toISOString(), default_branch: 'main', owner: { login: 'test-owner' }, open_issues_count: 0 };
    ipcMain.removeHandler('easyhub:auth-status');
    ipcMain.handle('easyhub:auth-status', () => ({ user: { login: 'test-owner', name: 'Owner', avatar_url: '', html_url: '' }, clientId: 'test-client' }));
    ipcMain.removeHandler('easyhub:github');
    ipcMain.handle('easyhub:github', (_event, action, ...args) => {
      if (action === 'repos') return [repo];
      if (action === 'readme') return '# Owned repo';
      if (action === 'issues' || action === 'commits') return [];
      if (action === 'updateVisibility') return { ...repo, private: args[2] };
      if (action === 'setArchived') return { ...repo, private: true, archived: args[2] };
      throw new Error(`Unexpected action: ${action}`);
    });
    ipcMain.removeHandler('easyhub:choose-folder');
    ipcMain.handle('easyhub:choose-folder', () => 'C:\\Projects\\NewTool');
    ipcMain.removeHandler('easyhub:local-inspect');
    ipcMain.handle('easyhub:local-inspect', () => ({ path: 'C:\\Projects\\NewTool', state: 'new', name: 'NewTool' }));
    ipcMain.removeHandler('easyhub:local-list');
    ipcMain.handle('easyhub:local-list', () => []);
  });
  const page = await app.firstWindow();
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.getByRole('button', { name: '新建项目' }).first().click();
  await page.locator('.live-create-form .choice-grid').waitFor();
  assert.equal(await page.locator('.live-create-form .choice.chosen').getByText('只有我').count(), 1);
  await page.screenshot({ path: 'out/live-create-options.png' });
  await page.locator('.live-create-form .choice').filter({ hasText: '所有人' }).click();
  assert.equal(await page.locator('.live-create-form .choice').filter({ hasText: '所有人' }).getAttribute('aria-pressed'), 'true');
  await page.locator('.live-create-form').getByRole('button', { name: '选择文件夹' }).click();
  await page.locator('.live-create-form').getByText('C:\\Projects\\NewTool').waitFor();
  await page.locator('.sidebar-nav button').nth(1).click();
  await page.getByRole('button', { name: /我的云端项目/ }).click();
  await page.locator('.cloud-row').filter({ hasText: 'owned-repo' }).getByRole('button', { name: '查看' }).click();
  const danger = page.getByRole('region', { name: '危险区' });
  await danger.waitFor();
  await page.screenshot({ path: 'out/live-danger-zone.png' });
  await danger.getByRole('button', { name: '改变可见性' }).click();
  const dialog = page.getByRole('dialog', { name: '变更项目可见性' });
  await dialog.getByRole('textbox', { name: '确认项目名称' }).fill('owned-repo');
  await dialog.getByRole('button', { name: '改变可见性' }).click();
  await danger.getByText('这个项目目前只有你能看到。').waitFor();
  await danger.getByRole('button', { name: '存档此项目' }).click();
  await page.getByRole('dialog', { name: '存档此项目' }).getByRole('textbox', { name: '确认项目名称' }).fill('owned-repo');
  await page.getByRole('dialog', { name: '存档此项目' }).getByRole('button', { name: '存档此项目' }).click();
  await danger.getByRole('button', { name: '取消存档' }).waitFor();
  process.stdout.write('Live danger zone and new project options smoke test passed.\n');
} finally {
  await app.close();
}
