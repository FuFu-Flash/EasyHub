export type WindowControlStyle = 'windows' | 'reference';

export const windowControlStyleKey = 'easyhub:window-control-style';

export function defaultWindowControlStyle(): WindowControlStyle {
  return window.easyHub?.platform === 'darwin' ? 'reference' : 'windows';
}

export function readWindowControlStyle(): WindowControlStyle {
  try {
    const saved = window.localStorage.getItem(windowControlStyleKey);
    if (saved === 'reference' || saved === 'windows') return saved;
  } catch {
    // Use the platform default when local preferences are unavailable.
  }
  return defaultWindowControlStyle();
}

export async function synchronizeWindowControlStyle(style: WindowControlStyle): Promise<void> {
  if (window.easyHub?.platform === 'darwin') {
    await window.easyHub.setWindowControlStyle?.(style);
  }
}
