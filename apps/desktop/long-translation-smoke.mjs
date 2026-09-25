import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  const page = await app.firstWindow();
  const source = '中'.repeat(Number(process.argv.find((arg) => /^\d+$/u.test(arg)) ?? 80_001));
  const translated = await page.evaluate((text) => window.easyHub?.translateContent({
    id: 'long-readme-regression', text, format: 'text', target: 'zh-CN',
  }), source);
  assert.equal(translated, source);
  await assert.rejects(page.evaluate((text) => window.easyHub?.translateContent({
    id: 'over-limit-regression', text, format: 'text', target: 'zh-CN',
  }), '中'.repeat(1_000_001)), /内容太长/u);
  process.stdout.write('Long translation IPC smoke test passed.\n');
} finally { await app.close(); }
