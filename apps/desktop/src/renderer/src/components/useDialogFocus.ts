import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const focusableSelector = 'button,input,textarea,select,a[href],summary,[tabindex],[contenteditable="true"]';

function visible(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0 && !element.closest('[inert],[aria-hidden="true"]') && getComputedStyle(element).visibility !== 'hidden';
}

function targets(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && visible(element))
    .sort((left, right) => {
      const leftOrder = left.tabIndex > 0 ? left.tabIndex : Infinity;
      const rightOrder = right.tabIndex > 0 ? right.tabIndex : Infinity;
      return leftOrder - rightOrder;
    });
}

/** Hidden retained pages and dialogs beneath another modal do not own the keyboard. */
function activeDialog(dialog: HTMLElement): boolean {
  if (!visible(dialog)) return false;
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')].filter(visible);
  return dialogs.at(-1) === dialog;
}

interface DialogFocusOptions {
  /** Used when completing an action has removed the original opening button. */
  fallbackFocus?: () => HTMLElement | null;
}

/** Initial focus, native Tab cycling, Escape dismissal and opening-button restoration. */
export function useDialogFocus(open: boolean, dialogRef: RefObject<HTMLElement | null>, close: () => void, options: DialogFocusOptions = {}): void {
  const latest = useRef({ close, options });
  latest.current = { close, options };
  useLayoutEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog || !visible(dialog)) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFirst = (): void => (targets(dialog)[0] ?? dialog).focus({ preventScroll: true });
    if (activeDialog(dialog)) focusFirst();
    const key = (event: KeyboardEvent): void => {
      if (!activeDialog(dialog)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); latest.current.close();
      } else if (event.key === 'Tab') {
        const elements = targets(dialog); const first = elements[0]; const last = elements.at(-1);
        if (!first) { event.preventDefault(); dialog.focus({ preventScroll: true }); return; }
        const current = document.activeElement;
        if (!dialog.contains(current) || current === dialog || !elements.includes(current as HTMLElement)) {
          event.preventDefault(); (event.shiftKey ? last : first)?.focus({ preventScroll: true });
        } else if (event.shiftKey && current === first) {
          event.preventDefault(); last?.focus({ preventScroll: true });
        } else if (!event.shiftKey && current === last) {
          event.preventDefault(); first.focus({ preventScroll: true });
        }
      }
    };
    const focus = (event: FocusEvent): void => {
      if (activeDialog(dialog) && !dialog.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focus);
      // Wait for the close/navigation render so stale buttons from the old page are excluded.
      requestAnimationFrame(() => {
        const destination = opener && visible(opener) && !opener.matches(':disabled') ? opener : latest.current.options.fallbackFocus?.();
        const remaining = [...document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]')].filter((other) => other !== dialog && visible(other)).at(-1);
        if (remaining && (!destination || !remaining.contains(destination))) return;
        if (destination && visible(destination) && !destination.matches(':disabled')) destination.focus({ preventScroll: true });
      });
    };
  }, [open, dialogRef]);
}
