import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePublicBookmarks, togglePublicBookmark } from '../features/github/publicBookmarks.ts';
import { readmeReleaseLink } from '../features/github/releaseLink.ts';

test('public bookmarks discard invalid and duplicate entries', () => {
  assert.deepEqual(parsePublicBookmarks(JSON.stringify([
    { owner: 'Alice', repo: 'Demo' }, { owner: 'alice', repo: 'demo' }, { owner: '..', repo: 'secret' },
    { owner: 'Bob', repo: 'App' },
  ])), [{ owner: 'Alice', repo: 'Demo' }, { owner: 'Bob', repo: 'App' }]);
  assert.deepEqual(parsePublicBookmarks('{bad'), []);
  assert.deepEqual(togglePublicBookmark([{ owner: 'Alice', repo: 'Demo' }], { owner: 'alice', repo: 'demo' }), []);
});

test('README release links route to in-app releases', () => {
  assert.deepEqual(readmeReleaseLink('https://github.com/Alice/Demo/releases'), { owner: 'Alice', repo: 'Demo' });
  assert.deepEqual(readmeReleaseLink('https://github.com/Alice/Demo/releases/tag/v1.0.0'), { owner: 'Alice', repo: 'Demo', tag: 'v1.0.0' });
  assert.equal(readmeReleaseLink('https://github.com/Alice/Demo/issues'), null);
  assert.equal(readmeReleaseLink('https://evilgithub.com/Alice/Demo/releases'), null);
});
