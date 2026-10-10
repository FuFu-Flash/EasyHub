import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferences, defaultPreferences, normalizeTranslationNames } from '../features/preferences/model.ts';

test('mobile preferences restore English and translation without accepting malformed values', () => {
  assert.deepEqual(parsePreferences('{broken'), defaultPreferences);
  assert.deepEqual(parsePreferences(JSON.stringify({ language: 'en', translationEnabled: true })), { language: 'en', translationEnabled: true, translationNames: [] });
  assert.deepEqual(parsePreferences(JSON.stringify({ language: 'fr', translationEnabled: 'yes' })), defaultPreferences);
});

test('translation glossary normalizes names and restores them with preferences', () => {
  assert.deepEqual(normalizeTranslationNames([' EasyHub ', 'EasyHub', 2, '', 'x', 'a'.repeat(81)]), ['EasyHub']);
  assert.deepEqual(parsePreferences(JSON.stringify({ translationNames: [' EasyHub '] })).translationNames, ['EasyHub']);
});
