import assert from 'node:assert/strict';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';

const executablePath = join(process.cwd(), 'out', 'installer-shell-build', 'win-unpacked', 'EasyHub 安装程序.exe');
const application = await electron.launch({ executablePath });
try {
  const page = await application.firstWindow();
  await page.getByRole('heading', { name: '安装 EasyHub' }).waitFor();
  await page.getByText('创建桌面快捷方式').waitFor();
  await page.waitForFunction(() => /^[A-Z]:\\/u.test(document.querySelector('#path')?.value || ''));
  const path = await page.locator('#path').inputValue();
  assert.match(path, /^[A-Z]:\\/u);
  assert.equal(await page.locator('#shortcut').isChecked(), true);
  assert.equal(await page.locator('#form-state').isVisible(), true);
  assert.equal(await page.locator('#progress-state').isVisible(), false);
  await page.locator('.shortcut-option').click();
  assert.equal(await page.locator('#shortcut').isChecked(), false);
  await page.locator('.shortcut-option').click();
  await page.screenshot({ path: join(process.cwd(), 'out', 'installer-shell.png') });
  console.log(`Custom installer UI passed: ${path}; shortcut checked; screenshot saved.`);
} finally {
  await application.close();
}
