import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  const page = await app.firstWindow();
  const text = 'This public project provides a simple desktop application.';
  const translated = await page.evaluate((source) => window.easyHub?.translateContent({ id: `translation-check-${Date.now()}`, text: source, format: 'text', target: 'zh-CN' }), text);
  assert.notEqual(translated, text);
  assert.match(translated, /[\u3400-\u9fff]/u);
  const namedText = 'Install Sunshine v1.2.3 from setup.exe.';
  const namedTranslation = await page.evaluate((source) => window.easyHub?.translateContent({
    id: `translation-names-check-${Date.now()}`, text: source, format: 'text', target: 'zh-CN',
    repository: { name: 'Sunshine', owner: 'ExampleOrg' },
  }), namedText);
  assert.match(namedTranslation, /Sunshine/u);
  assert.match(namedTranslation, /v1\.2\.3/u);
  assert.match(namedTranslation, /setup\.exe/u);
  assert.match(namedTranslation, /[\u3400-\u9fff]/u);
  const issueText = '### Bug type\n\nBehavior bug (incorrect output/state without crash)';
  const issueTranslation = await page.evaluate((source) => window.easyHub?.translateContent({
    id: `translation-issue-check-${Date.now()}`, text: source, format: 'markdown', target: 'zh-CN',
    repository: { name: 'openclaw', owner: 'openclaw', fullName: 'openclaw/openclaw' },
  }), issueText);
  assert.notEqual(issueTranslation, issueText);
  assert.match(issueTranslation, /[\u3400-\u9fff]/u);
  process.stdout.write('Live public-content translation passed.\n');
} finally { await app.close(); }
