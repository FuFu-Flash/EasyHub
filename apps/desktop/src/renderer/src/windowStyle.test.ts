import { afterEach, describe, expect, it, vi } from 'vitest';
import { WINDOW_STYLE_KEY, parseWindowStyle, readWindowStyle } from './windowStyle';

afterEach(() => vi.unstubAllGlobals());

describe('window style', () => {
  it.each([null, undefined, '', 'unexpected', 1, {}])(
    'uses the Windows buttons for an absent or invalid value: %s',
    (value) => {
      expect(parseWindowStyle(value)).toBe('windows');
    },
  );

  it('keeps the saved dot style', () => {
    const getItem = vi.fn().mockReturnValue('reference');
    vi.stubGlobal('window', { localStorage: { getItem } });
    expect(readWindowStyle()).toBe('reference');
    expect(getItem).toHaveBeenCalledWith(WINDOW_STYLE_KEY);
  });

  it('falls back to the Windows buttons when local settings cannot be read', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('Storage unavailable');
        },
      },
    });
    expect(readWindowStyle()).toBe('windows');
  });
});
