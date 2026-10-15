import { describe, expect, it } from 'vitest';
import { navigationShortcut } from './useNavigationShortcuts';

const key = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
  isComposing: false, defaultPrevented: false, ...modifiers,
});

describe('platform navigation shortcuts', () => {
  it.each(['win32', 'Linux'])('uses Alt arrows on %s', platform => {
    expect(navigationShortcut(key('ArrowLeft', { altKey: true }), platform, false)).toBe('back');
    expect(navigationShortcut(key('ArrowRight', { altKey: true }), platform, false)).toBe('forward');
    expect(navigationShortcut(key('[', { metaKey: true }), platform, false)).toBeNull();
  });
  it.each(['darwin', 'MacIntel'])('leaves Option word movement alone on %s', platform => {
    expect(navigationShortcut(key('ArrowLeft', { altKey: true }), platform, false)).toBeNull();
    expect(navigationShortcut(key('ArrowRight', { altKey: true }), platform, false)).toBeNull();
    expect(navigationShortcut(key('[', { metaKey: true }), platform, false)).toBe('back');
    expect(navigationShortcut(key(']', { metaKey: true }), platform, false)).toBe('forward');
  });
  it.each(['input', 'textarea', 'contenteditable'])('never navigates while editing %s', () => {
    expect(navigationShortcut(key('ArrowLeft', { altKey: true }), 'win32', true)).toBeNull();
    expect(navigationShortcut(key('[', { metaKey: true }), 'darwin', true)).toBeNull();
  });
  it.each([{ isComposing: true }, { defaultPrevented: true }, { shiftKey: true }, { ctrlKey: true }])('preserves other keyboard handling: %j', modifiers => {
    expect(navigationShortcut(key('ArrowLeft', { altKey: true, ...modifiers }), 'win32', false)).toBeNull();
  });
});
