import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchHistory, rememberSearch } from '../features/github/searchHistory.ts';

test('mobile discovery keeps ten distinct recent searches by scope', () => {
  let history = [];
  for (let i = 0; i < 12; i++) history = rememberSearch(history, `project ${i}`, 'projects');
  history = rememberSearch(history, 'project 7', 'projects');
  assert.equal(history.length, 10);
  assert.equal(history[0].query, 'project 7');
  assert.equal(history.filter((entry) => entry.query === 'project 7').length, 1);
  history = rememberSearch(history, 'project 7', 'users');
  assert.equal(history[0].scope, 'users');
  assert.equal(history[1].scope, 'projects');
});

test('mobile discovery ignores malformed history records', () => {
  assert.deepEqual(parseSearchHistory('invalid'), []);
  assert.deepEqual(parseSearchHistory(JSON.stringify([{ query: 'EasyHub', scope: 'projects' }, { query: 5, scope: 'users' }])), [{ query: 'EasyHub', scope: 'projects' }]);
});
