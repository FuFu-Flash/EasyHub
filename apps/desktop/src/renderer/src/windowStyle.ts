export type WindowStyle = 'windows' | 'reference';

/** The Settings choice for where the window buttons sit; every screen with window buttons reads the same value. */
export const WINDOW_STYLE_KEY = 'easyhub:window-control-style';

/** macOS starts with the traffic-light dots, every other system with the Windows buttons. */
function platformDefault(): WindowStyle {
  return typeof window !== 'undefined' && window.easyHub?.platform === 'darwin' ? 'reference' : 'windows';
}

export function parseWindowStyle(value: unknown): WindowStyle {
  return value === 'reference' || value === 'windows' ? value : platformDefault();
}

export function readWindowStyle(): WindowStyle {
  try {
    return parseWindowStyle(window.localStorage.getItem(WINDOW_STYLE_KEY));
  } catch {
    return platformDefault();
  }
}

/** On macOS the main process shows or hides its own traffic lights to match the style the page shows. */
export async function synchronizeWindowControlStyle(
  style: WindowStyle,
  density?: 'comfortable' | 'compact',
): Promise<void> {
  if (window.easyHub?.platform === 'darwin') await window.easyHub.setWindowControlStyle?.(style, density);
}
