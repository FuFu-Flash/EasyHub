export type WindowStyle = 'windows' | 'reference';

/** The Settings choice for where the window buttons sit; every screen with window buttons reads the same value. */
export const WINDOW_STYLE_KEY = 'easyhub:window-control-style';

export function parseWindowStyle(value: unknown): WindowStyle {
  return value === 'reference' ? 'reference' : 'windows';
}

export function readWindowStyle(): WindowStyle {
  try {
    return parseWindowStyle(window.localStorage.getItem(WINDOW_STYLE_KEY));
  } catch {
    return 'windows';
  }
}
