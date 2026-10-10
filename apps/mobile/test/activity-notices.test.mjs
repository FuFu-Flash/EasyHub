import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSeenActivityNotices, unreadActivityNoticeCount, markActivityNoticesSeen } from '../features/github/activityNotices.ts';

test('notifications become read when opened and changes notify again without removing pending rows', () => {
  const items = [{ id: 'issues-1', revision: '2' }, { id: 'pulls-1', revision: '1' }];
  assert.equal(unreadActivityNoticeCount(items, {}), 2);
  const seen = markActivityNoticesSeen({}, items);
  assert.equal(unreadActivityNoticeCount(items, seen), 0);
  assert.equal(items.length, 2);
  assert.equal(unreadActivityNoticeCount([{ id: 'issues-1', revision: '3' }, items[1]], seen), 1);
  assert.deepEqual(parseSeenActivityNotices(JSON.stringify(seen)), seen);
});

test('read state rejects malformed values and keeps recently seen entries', () => {
  assert.deepEqual(parseSeenActivityNotices('{broken'), {});
  assert.deepEqual(parseSeenActivityNotices('["bad"]'), {});
  assert.deepEqual(parseSeenActivityNotices('{"valid":"2","invalid":1}'), { valid: '2' });
  const older = Object.fromEntries(Array.from({ length: 510 }, (_, index) => [`old-${index}`, '1']));
  const seen = markActivityNoticesSeen(older, [{ id: 'old-0', revision: '2' }]);
  assert.equal(Object.keys(seen).length, 500);
  assert.equal(seen['old-0'], '2');
});
