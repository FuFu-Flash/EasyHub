import assert from 'node:assert/strict';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const app = await electron.launch({
  executablePath: join(process.cwd(), 'release/demo/win-unpacked/EasyHub Demo.exe'),
  args: [],
  cwd: process.cwd(),
});
try {
  const page = await app.firstWindow();
  await page.getByText('演示版 · 不连接 GitHub').waitFor();
  assert.equal(await page.getByRole('button', { name: '使用 GitHub 登录' }).count(), 0);
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置' }).click();
  await page.getByText('这是独立演示版，只展示模拟数据。安装正式版后可以连接 GitHub。').waitFor();
  await page.getByText('版本 1.1.0').waitFor();
  assert.equal(await page.getByRole('button', { name: '使用 GitHub 登录' }).count(), 0);
  process.stdout.write('Standalone demo UI smoke test passed.\n');
} finally { await app.close(); }
