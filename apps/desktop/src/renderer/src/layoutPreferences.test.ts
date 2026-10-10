import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAYOUT_PREFERENCE_KEY, parseLayoutPreference, readLayoutPreference, resolveLayoutDensity } from './layoutPreferences';

afterEach(() => vi.unstubAllGlobals());

describe('layout preferences', () => {
  it.each([null, undefined, '', 'unexpected', 1, {}])('uses automatic layout for an absent or invalid preference: %s', (value) => {
    expect(parseLayoutPreference(value)).toBe('auto');
  });

  it('adapts automatic layout and respects either manual override', () => {
    expect(resolveLayoutDensity('auto', true)).toBe('compact');
    expect(resolveLayoutDensity('auto', false)).toBe('comfortable');
    expect(resolveLayoutDensity('comfortable', true)).toBe('comfortable');
    expect(resolveLayoutDensity('compact', false)).toBe('compact');
  });

  it('reads the saved layout from the shared desktop setting', () => {
    const getItem = vi.fn().mockReturnValue('compact');
    vi.stubGlobal('window', { localStorage: { getItem } });
    expect(readLayoutPreference()).toBe('compact');
    expect(getItem).toHaveBeenCalledWith(LAYOUT_PREFERENCE_KEY);
  });

  it('keeps automatic layout available when local settings cannot be read', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('Storage unavailable'); } } });
    expect(readLayoutPreference()).toBe('auto');
  });
});
