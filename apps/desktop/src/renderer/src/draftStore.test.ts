import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftKey, readDraft, writeDraft, removeDraft } from './draftStore';

let values: Map<string, string>;
beforeEach(() => { values = new Map(); vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }); });
afterEach(() => vi.unstubAllGlobals());
describe('local user drafts', () => {
  it('isolates account, repository, type and discussion but ignores account casing', () => {
    const key = createDraftKey('Alice', 'Owner/Project', 'reply', 7);
    expect(writeDraft(key, 'Unsent reply')).toBe(true);
    expect(readDraft(createDraftKey('alice', 'owner/project', 'reply', 7))).toBe('Unsent reply');
    for (const other of [createDraftKey('Bob', 'Owner/Project', 'reply', 7), createDraftKey('Alice', 'Owner/Other', 'reply', 7), createDraftKey('Alice', 'Owner/Project', 'reply', 8), createDraftKey('Alice', 'Owner/Project', 'release', 7)]) expect(readDraft(other)).toBe('');
    removeDraft(key); expect(readDraft(key)).toBe('');
  });
  it('keeps the newest 50 drafts without silently truncating an individual draft', () => {
    for (let index = 0; index < 60; index++) writeDraft(String(index), 'content');
    expect(readDraft('0')).toBe(''); expect(readDraft('59')).toBe('content');
    expect(JSON.parse(values.get('easyhub:user-drafts:v1')!).length).toBe(50);
    expect(writeDraft('59', 'x'.repeat(131073))).toBe(false); expect(readDraft('59')).toBe('content');
  });
  it('caps total storage and rejects corrupted or hostile records', () => {
    for (let index = 0; index < 50; index++) writeDraft(String(index), 'x'.repeat(131072));
    expect(values.get('easyhub:user-drafts:v1')!.length).toBeLessThanOrEqual(1048576);
    values.set('easyhub:user-drafts:v1', '{ broken'); expect(readDraft('0')).toBe('');
    values.set('easyhub:user-drafts:v1', JSON.stringify([{ key: 'x', value: 123, updated: 1 }, null])); expect(readDraft('x')).toBe('');
  });
  it('never throws when persistence is disabled or full', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled'); }, setItem: () => { throw new Error('quota'); } });
    expect(readDraft('a')).toBe(''); expect(writeDraft('a', 'still editing')).toBe(false); expect(() => removeDraft('a')).not.toThrow();
  });
});
