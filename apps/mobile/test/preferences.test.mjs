import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePreferences, defaultPreferences } from '../features/preferences/model.ts';

test('mobile preferences restore English and translation without accepting malformed values', () => {
  assert.deepEqual(parsePreferences('{broken'), defaultPreferences);
  assert.deepEqual(parsePreferences(JSON.stringify({ language: 'en', translationEnabled: true })), { language: 'en', translationEnabled: true });
  assert.deepEqual(parsePreferences(JSON.stringify({ language: 'fr', translationEnabled: 'yes' })), defaultPreferences);
});
