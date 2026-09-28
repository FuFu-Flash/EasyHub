import test from 'node:test';
import assert from 'node:assert/strict';
import { protectTranslationText, restoreTranslationText } from '../features/translation/protect.ts';

test('mobile brief translation protects project names, links, files and versions', () => {
  const input = 'OpenClaw v1.2 fixes setup. See https://example.com and config.json.';
  const protectedText = protectTranslationText(input, ['OpenClaw']);
  const output = restoreTranslationText(protectedText.value.replace('fixes setup', '修复设置'), protectedText);
  assert.equal(output, 'OpenClaw v1.2 修复设置. See https://example.com and config.json.');
  assert.equal(restoreTranslationText('broken placeholders', protectedText), null);
});
