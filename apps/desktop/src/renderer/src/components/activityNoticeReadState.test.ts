import { describe, expect, it, vi } from 'vitest';
import { activityNoticeStorageKey, markActivityNoticesSeen, parseSeenActivityNotices, readSeenActivityNotices, unreadActivityNoticeCount } from './activityNoticeReadState';

const activity = [
  { id: 'issues-1', title: 'project 有 23 个待处理的问题' },
  { id: 'pulls-1', title: 'project 有 7 个改进请求' },
];

describe('activity notification reads', () => {
  it('counts grouped notification rows, preserves tasks after reading, and makes a changed title unread again', () => {
    expect(unreadActivityNoticeCount(activity, {})).toBe(2);
    const seen = markActivityNoticesSeen({}, activity);
    expect(unreadActivityNoticeCount(activity, seen)).toBe(0);
    expect(activity).toHaveLength(2);
    expect(unreadActivityNoticeCount([{ ...activity[0]!, title: 'project 有 24 个待处理的问题' }, activity[1]!], seen)).toBe(1);
    expect(unreadActivityNoticeCount([...activity].reverse(), seen)).toBe(0);
  });

  it('isolates account keys and writes only that account’s records', () => {
    const alice = activityNoticeStorageKey('alice');
    const bob = activityNoticeStorageKey('bob');
    const values = new Map<string, string>([[alice, JSON.stringify({ ...markActivityNoticesSeen({}, activity), 'alice-only': 'Private task' })]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
    expect(alice).not.toBe(bob);
    expect(unreadActivityNoticeCount(activity, readSeenActivityNotices(storage, alice))).toBe(0);
    const bobSeen = readSeenActivityNotices(storage, bob);
    expect(unreadActivityNoticeCount(activity, bobSeen)).toBe(2);
    markActivityNoticesSeen(bobSeen, [activity[0]!], storage, bob);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(bob, JSON.stringify({ [activity[0]!.id]: activity[0]!.title }));
    expect(JSON.parse(values.get(bob)!)).not.toHaveProperty('alice-only');
    expect(unreadActivityNoticeCount(activity, readSeenActivityNotices(storage, alice))).toBe(0);
    expect(unreadActivityNoticeCount(activity, readSeenActivityNotices(storage, bob))).toBe(1);
  });

  it.each([null, '', '{broken', '[]', '42', 'null', '"string"'])('tolerates invalid persisted data (%s)', (raw) => {
    expect(parseSeenActivityNotices(raw)).toEqual({});
  });

  it('accepts only nonempty string values and ids, including ordinary object-property names', () => {
    const raw = '{"issues-1":"Read","number":5,"boolean":true,"array":[],"object":{},"null":null,"empty":"","":"Title","__proto__":"Read proto","constructor":"Read constructor"}';
    const parsed = parseSeenActivityNotices(raw);
    expect(Object.keys(parsed)).toEqual(['issues-1', '__proto__', 'constructor']);
    expect(unreadActivityNoticeCount([{ id: '__proto__', title: 'Read proto' }, { id: 'constructor', title: 'Read constructor' }], parsed)).toBe(0);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it('bounds stored records to 500 distinct entries and retains entries that were recently read', () => {
    const large = Object.fromEntries(Array.from({ length: 510 }, (_, index) => [`notice-${index}`, `Title ${index}`]));
    const parsed = parseSeenActivityNotices(JSON.stringify(large));
    expect(Object.keys(parsed)).toHaveLength(500);
    expect(parsed).not.toHaveProperty('notice-0');
    expect(parsed).toHaveProperty('notice-509');
    const next = markActivityNoticesSeen(parsed, [{ id: 'notice-10', title: 'New title' }, ...activity]);
    expect(Object.keys(next)).toHaveLength(500);
    expect(next).toHaveProperty('notice-10', 'New title');
    expect(next).not.toHaveProperty('notice-11');
    expect(unreadActivityNoticeCount(activity, next)).toBe(0);
  });

  it('keeps reads usable in memory when storage access is blocked or full', () => {
    const storage = { getItem: vi.fn(() => { throw new Error('Storage blocked'); }),
      setItem: vi.fn(() => { throw new Error('Storage full'); }) };
    const key = activityNoticeStorageKey('alice');
    const previous = readSeenActivityNotices(storage, key);
    expect(previous).toEqual({});
    const seen = markActivityNoticesSeen(previous, activity, storage, key);
    expect(unreadActivityNoticeCount(activity, seen)).toBe(0);
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it('reads every current row once when a large list exceeds 500 while keeping persisted records bounded', () => {
    const many = Array.from({ length: 750 }, (_, index) => ({ id: `notice-${index}`, title: `Title ${index}` }));
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const seen = markActivityNoticesSeen({}, many, storage, activityNoticeStorageKey('alice'));
    expect(unreadActivityNoticeCount(many, seen)).toBe(0);
    expect(Object.keys(JSON.parse(storage.setItem.mock.calls[0]![1]))).toHaveLength(500);
    const updated = many.map((item, index) => index === 0 ? { ...item, title: 'Changed title' } : item);
    expect(unreadActivityNoticeCount(updated, seen)).toBe(1);
    expect(unreadActivityNoticeCount(updated, markActivityNoticesSeen(seen, updated))).toBe(0);
  });

  it('keeps demo reads session-only without loading or modifying account storage', () => {
    const storage = { getItem: vi.fn(() => '{}'), setItem: vi.fn() };
    const seen = markActivityNoticesSeen(readSeenActivityNotices(storage, null), activity, storage, null);
    expect(unreadActivityNoticeCount(activity, seen)).toBe(0);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
