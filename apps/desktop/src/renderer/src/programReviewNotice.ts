import { useCallback, useEffect, useState } from 'react';

export const PROGRAM_REVIEW_NOTICE_KEY = 'easyhub:program-review-install-prompts:v1';
export const PROGRAM_REVIEW_NOTICE_CHANGED_EVENT = 'easyhub:program-review-notice-changed';
export const PROGRAM_REVIEW_COMPONENT_STATUS_CHANGED_EVENT = 'easyhub:program-review-components-changed';
export const PROGRAM_REVIEW_SETTINGS_REQUEST_EVENT = 'easyhub:program-review-settings-requested';

let sessionPreference = true;
let sessionOnly = false;
let settingsRequestPending = false;

export function requestProgramReviewSettings(): void {
  settingsRequestPending = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROGRAM_REVIEW_SETTINGS_REQUEST_EVENT));
}

export function consumeProgramReviewSettingsRequest(): boolean {
  const requested = settingsRequestPending;
  settingsRequestPending = false;
  return requested;
}

function browserStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { return undefined; }
}

export function parseProgramReviewNoticesEnabled(value: unknown): boolean {
  return value !== 'false';
}

export function readProgramReviewNoticesEnabled(storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): boolean {
  if (sessionOnly || !storage) return sessionPreference;
  try {
    sessionPreference = parseProgramReviewNoticesEnabled(storage.getItem(PROGRAM_REVIEW_NOTICE_KEY));
    return sessionPreference;
  } catch { return sessionPreference; }
}

export function writeProgramReviewNoticesEnabled(enabled: boolean, storage: Pick<Storage, 'setItem'> | undefined = browserStorage()): void {
  sessionPreference = enabled;
  sessionOnly = true;
  try {
    if (storage) {
      storage.setItem(PROGRAM_REVIEW_NOTICE_KEY, String(enabled));
      sessionOnly = false;
    }
  } catch { /* Keep the choice for this session when local settings are unavailable. */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PROGRAM_REVIEW_NOTICE_CHANGED_EVENT, { detail: { enabled } }));
  }
}

export function useProgramReviewNotice(): {
  noticesEnabled: boolean;
  setNoticesEnabled: (enabled: boolean) => void;
} {
  const [noticesEnabled, updateNoticesEnabled] = useState(readProgramReviewNoticesEnabled);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onChanged = (event: Event): void => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== 'object' || !('enabled' in detail) || typeof detail.enabled !== 'boolean') return;
      updateNoticesEnabled(detail.enabled);
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== PROGRAM_REVIEW_NOTICE_KEY && event.key !== null) return;
      if (event.storageArea && event.storageArea !== browserStorage()) return;
      sessionOnly = false;
      sessionPreference = event.key === null ? readProgramReviewNoticesEnabled() : parseProgramReviewNoticesEnabled(event.newValue);
      updateNoticesEnabled(sessionPreference);
    };
    window.addEventListener(PROGRAM_REVIEW_NOTICE_CHANGED_EVENT, onChanged);
    window.addEventListener('storage', onStorage);
    updateNoticesEnabled(readProgramReviewNoticesEnabled());
    return () => {
      window.removeEventListener(PROGRAM_REVIEW_NOTICE_CHANGED_EVENT, onChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setNoticesEnabled = useCallback((enabled: boolean): void => {
    updateNoticesEnabled(enabled);
    writeProgramReviewNoticesEnabled(enabled);
  }, []);

  return { noticesEnabled, setNoticesEnabled };
}
