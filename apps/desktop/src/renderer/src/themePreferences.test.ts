import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_PREFERENCE_KEY, parseThemePreference, readThemePreference, resolveTheme } from './themePreferences';

afterEach(() => vi.unstubAllGlobals());

describe('theme preferences', () => {
  it.each([null, undefined, '', 'unexpected', 1, {}])(
    'follows the system for an absent or invalid preference: %s',
    (value) => {
      expect(parseThemePreference(value)).toBe('system');
    },
  );

  it('follows the system appearance and respects either manual choice', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('reads the saved theme from the desktop setting', () => {
    const getItem = vi.fn().mockReturnValue('dark');
    vi.stubGlobal('window', { localStorage: { getItem } });
    expect(readThemePreference()).toBe('dark');
    expect(getItem).toHaveBeenCalledWith(THEME_PREFERENCE_KEY);
  });

  it('falls back to the system theme when local settings cannot be read', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('Storage unavailable');
        },
      },
    });
    expect(readThemePreference()).toBe('system');
  });
});
