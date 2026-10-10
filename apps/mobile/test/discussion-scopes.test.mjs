import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionScopes, selectedDiscussionScope } from '../features/github/discussionScope.ts';

const publicRepo = { id: 1, owner: { login: 'writer' }, name: 'public', full_name: 'writer/public', private: false };
const privateRepo = { id: 2, owner: { login: 'writer' }, name: 'private', full_name: 'writer/private', private: true };

test('cross-project discussion searches retain private repositories without enabling translation', () => {
  const scopes = discussionScopes([publicRepo, privateRepo, { ...privateRepo, id: 3, private: undefined }]);
  assert.equal(scopes.length, 3);
  assert.equal(selectedDiscussionScope(scopes, 1).isPublic, true);
  assert.equal(selectedDiscussionScope(scopes, 2).isPublic, false);
  assert.equal(selectedDiscussionScope(scopes, 3).isPublic, false);
  assert.equal(selectedDiscussionScope(scopes, 2).repo, 'private');
});

test('project scope changes cannot keep a removed account repository or mismatched identity', () => {
  const scopes = discussionScopes([publicRepo, privateRepo, { ...publicRepo }, { ...privateRepo, id: 4, full_name: 'another/private' }, { ...privateRepo, id: 5, owner: { login: 'writer is:public' } }]);
  assert.deepEqual(scopes.map((item) => item.id), [1, 2]);
  const newAccount = discussionScopes([{ ...publicRepo, id: 6, owner: { login: 'other' }, full_name: 'other/public' }]);
  assert.equal(selectedDiscussionScope(newAccount, 2).owner, 'other');
  assert.equal(selectedDiscussionScope([], 2), undefined);
});
