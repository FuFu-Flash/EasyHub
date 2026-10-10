import { useLayoutEffect, useRef } from 'react';
import { canRunMenuCommand, type MenuCommand, type MenuState } from '../../shared/applicationMenu';

function hasBlockingDialog(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], .modal-backdrop')]
    .some((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

/** Keep native commands attached to the current workspace without reloading its drafts. */
export function useApplicationMenu(state: Omit<MenuState, 'modalOpen'>, onCommand: (command: MenuCommand) => void, ready = true): void {
  const current = useRef({ state, onCommand });
  current.current = { state, onCommand };

  useLayoutEffect(() => {
    const bridge = window.easyHub;
    if (!ready || bridge?.platform !== 'darwin' || !bridge.onMenuCommand) return;
    return bridge.onMenuCommand((command) => {
      const next = { ...current.current.state, modalOpen: hasBlockingDialog() };
      if (canRunMenuCommand(command, next)) current.current.onCommand(command);
    });
  }, [ready]);

  useLayoutEffect(() => {
    const bridge = window.easyHub;
    if (!ready || bridge?.platform !== 'darwin' || !bridge.setMenuState) return;
    let lastState = '';
    const publish = (): void => {
      const next: MenuState = { ...current.current.state, modalOpen: hasBlockingDialog() };
      const serialized = JSON.stringify(next);
      if (serialized === lastState) return;
      lastState = serialized;
      void bridge.setMenuState(next).catch(() => { lastState = ''; });
    };
    // Native menu clicks must not navigate behind an OAuth, download or confirmation dialog.
    const observer = new MutationObserver(publish);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });
    publish();
    return () => observer.disconnect();
  }, [ready, state.language, state.signedIn, state.busy, state.demoOnly]);
}
