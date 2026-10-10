import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function settingsWindow(storage: Pick<Storage, 'getItem' | 'setItem'>): EventTarget & { localStorage: typeof storage } {
  return Object.assign(new EventTarget(), { localStorage: storage });
}

describe('program review installation prompts', () => {
  it.each([null, undefined, '', 'true', 'False', 'unexpected', false, true, 0, {}])('keeps prompts enabled for an absent or invalid preference: %s', async (value) => {
    const { parseProgramReviewNoticesEnabled } = await import('./programReviewNotice');
    expect(parseProgramReviewNoticesEnabled(value)).toBe(true);
    expect(parseProgramReviewNoticesEnabled('false')).toBe(false);
  });

  it('uses one device preference and keeps permanent ignore after a module reload', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
    vi.stubGlobal('window', settingsWindow(storage));
    const first = await import('./programReviewNotice');
    expect(first.readProgramReviewNoticesEnabled()).toBe(true);
    first.writeProgramReviewNoticesEnabled(false);
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(first.PROGRAM_REVIEW_NOTICE_KEY, 'false');
    vi.resetModules();
    const reopened = await import('./programReviewNotice');
    expect(reopened.readProgramReviewNoticesEnabled()).toBe(false);
    expect(storage.getItem).toHaveBeenLastCalledWith(reopened.PROGRAM_REVIEW_NOTICE_KEY);
  });

  it('restores prompts persistently and broadcasts each preference change', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
    const target = settingsWindow(storage);
    vi.stubGlobal('window', target);
    const preference = await import('./programReviewNotice');
    const changed = vi.fn();
    target.addEventListener(preference.PROGRAM_REVIEW_NOTICE_CHANGED_EVENT, changed);
    preference.writeProgramReviewNoticesEnabled(false);
    preference.writeProgramReviewNoticesEnabled(true);
    expect(preference.readProgramReviewNoticesEnabled()).toBe(true);
    expect(storage.setItem).toHaveBeenNthCalledWith(2, preference.PROGRAM_REVIEW_NOTICE_KEY, 'true');
    expect(changed).toHaveBeenCalledTimes(2);
    expect((changed.mock.calls[0]![0] as CustomEvent).detail).toEqual({ enabled: false });
    expect((changed.mock.calls[1]![0] as CustomEvent).detail).toEqual({ enabled: true });
    vi.resetModules();
    expect((await import('./programReviewNotice')).readProgramReviewNoticesEnabled()).toBe(true);
  });

  it('defaults to enabled when saved settings cannot be read', async () => {
    const storage = { getItem: vi.fn(() => { throw new Error('Storage blocked'); }), setItem: vi.fn() };
    vi.stubGlobal('window', settingsWindow(storage));
    const preference = await import('./programReviewNotice');
    expect(preference.readProgramReviewNoticesEnabled()).toBe(true);
  });

  it('keeps a failed write usable across panel remounts in the same session', async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn(() => { throw new Error('Storage full'); }) };
    const target = settingsWindow(storage);
    vi.stubGlobal('window', target);
    const preference = await import('./programReviewNotice');
    const changed = vi.fn();
    target.addEventListener(preference.PROGRAM_REVIEW_NOTICE_CHANGED_EVENT, changed);
    preference.writeProgramReviewNoticesEnabled(false);
    expect(preference.readProgramReviewNoticesEnabled()).toBe(false);
    expect((changed.mock.calls[0]![0] as CustomEvent).detail).toEqual({ enabled: false });
    preference.writeProgramReviewNoticesEnabled(true);
    expect(preference.readProgramReviewNoticesEnabled()).toBe(true);
  });

  it('recovers persistence when storage becomes available again', async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
    storage.setItem.mockImplementationOnce(() => { throw new Error('Storage full'); });
    vi.stubGlobal('window', settingsWindow(storage));
    const preference = await import('./programReviewNotice');
    preference.writeProgramReviewNoticesEnabled(false);
    expect(preference.readProgramReviewNoticesEnabled()).toBe(false);
    preference.writeProgramReviewNoticesEnabled(true);
    values.set(preference.PROGRAM_REVIEW_NOTICE_KEY, 'false');
    expect(preference.readProgramReviewNoticesEnabled()).toBe(false);
  });

  it('works without a browser and when access to browser storage is blocked', async () => {
    vi.stubGlobal('window', undefined);
    const preference = await import('./programReviewNotice');
    expect(preference.readProgramReviewNoticesEnabled()).toBe(true);
    expect(() => preference.writeProgramReviewNoticesEnabled(false)).not.toThrow();
    expect(preference.readProgramReviewNoticesEnabled()).toBe(false);
    const target = new EventTarget();
    Object.defineProperty(target, 'localStorage', { get: () => { throw new Error('Storage unavailable'); } });
    vi.stubGlobal('window', target);
    expect(() => preference.writeProgramReviewNoticesEnabled(true)).not.toThrow();
    expect(preference.readProgramReviewNoticesEnabled()).toBe(true);
  });
});
