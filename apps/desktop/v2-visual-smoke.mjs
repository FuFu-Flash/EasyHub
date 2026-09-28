import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const output = join(process.cwd(), 'out', 'v2-visual');
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.locator('.app-shell').waitFor({ timeout: 10000 }).catch(() => { throw new Error(`App did not render: ${errors.join('; ')}`); });
  await page.screenshot({ path: join(output, 'home.png') });
  await page.getByRole('button', { name: '通知' }).click();
  await page.getByRole('dialog', { name: '通知' }).waitFor();
  await page.screenshot({ path: join(output, 'notifications.png') });
  await page.getByRole('button', { name: '关闭通知' }).click();
  await page.getByRole('button', { name: '账户菜单' }).click();
  await page.screenshot({ path: join(output, 'profile-menu.png') });
  await page.getByRole('menuitem', { name: '我收藏的项目' }).click();
  await page.locator('.starred-project-card').first().waitFor();
  await page.screenshot({ path: join(output, 'starred-projects.png') });
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置' }).click();
  await page.screenshot({ path: join(output, 'settings.png') });
  assert.equal(await page.locator('.window-style-preview').count(), 2);
  await page.getByRole('button', { name: /圆点风格/ }).click();
  const left = await page.locator('.window-controls').boundingBox();
  const brand = await page.locator('.topbar-brand').boundingBox();
  assert.ok(left && brand && left.x + left.width < brand.x, 'round controls must be left of the brand');
  await page.screenshot({ path: join(output, 'settings-round.png') });
  await page.locator('.sidebar-nav').getByRole('button', { name: '我的项目' }).click();
  await page.screenshot({ path: join(output, 'projects.png') });
  await page.locator('.project-card .plain-heading').first().click();
  await page.screenshot({ path: join(output, 'project-detail.png') });
  await page.locator('.sidebar-nav').getByRole('button', { name: '问题' }).click();
  await page.screenshot({ path: join(output, 'issues.png') });

  const compact = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  compact.on('pageerror', (error) => errors.push(error.message));
  await compact.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  const overflow = await compact.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `900px window overflows by ${overflow}px`);
  await compact.screenshot({ path: join(output, 'home-compact.png') });
  assert.deepEqual(errors, []);
  console.log(`V2 integration visual checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
}
