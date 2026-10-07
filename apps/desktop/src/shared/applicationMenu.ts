export const MENU_COMMANDS = [
  'home', 'projects', 'discover', 'issues', 'reviews', 'starred', 'profile', 'settings',
  'new-project', 'add-folder', 'download-project', 'search', 'refresh', 'proxy-settings',
] as const;

export type MenuCommand = typeof MENU_COMMANDS[number];

export interface MenuState {
  language: 'zh' | 'en';
  signedIn: boolean;
  busy: boolean;
  modalOpen: boolean;
  demoOnly: boolean;
}

export function isMenuCommand(value: unknown): value is MenuCommand {
  return typeof value === 'string' && MENU_COMMANDS.some((command) => command === value);
}

export function isMenuState(value: unknown): value is MenuState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const fields = ['language', 'signedIn', 'busy', 'modalOpen', 'demoOnly'];
  if (keys.length !== fields.length || !fields.every((field) => Object.hasOwn(value, field))) return false;
  const state = value as Record<string, unknown>;
  return (state.language === 'zh' || state.language === 'en') &&
    ['signedIn', 'busy', 'modalOpen', 'demoOnly'].every((field) => typeof state[field] === 'boolean');
}

/** The renderer rechecks this policy when a queued native command arrives. */
export function canRunMenuCommand(command: MenuCommand, state: MenuState): boolean {
  if (state.modalOpen) return false;
  if (state.busy && ['new-project', 'add-folder', 'download-project', 'refresh'].includes(command)) return false;
  if (['discover', 'reviews', 'starred', 'refresh'].includes(command)) return state.signedIn && !state.demoOnly;
  return true;
}
