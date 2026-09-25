import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: process.cwd() });
try {
  const page = await app.firstWindow();
  const result = await page.evaluate(async (target) => {
    const readme = await window.easyHub.github('readme', 'openclaw', 'openclaw');
    const translated = await window.easyHub.translateContent({
      id: `openclaw-readme-${Date.now()}`, text: readme, format: 'markdown', target,
      repository: { name: 'openclaw', owner: 'openclaw', fullName: 'openclaw/openclaw' },
    });
    return { length: readme.length, translatedLength: translated.length,
      hasChinese: /[\u3400-\u9fff]/u.test(translated), preservesName: translated.includes('OpenClaw'),
    };
  }, process.argv[2] ?? 'en');
  assert.ok(result.length > 80_000);
  assert.ok(result.preservesName);
  if (process.argv[2] === 'zh-CN') assert.ok(result.hasChinese);
  process.stdout.write(`OpenClaw README translation: ${JSON.stringify(result)}\n`);
} finally { await app.close(); }
