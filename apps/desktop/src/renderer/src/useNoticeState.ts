import { useCallback, useEffect, useState } from 'react';
import type { SetStateAction } from 'react';
import { useLanguage } from './localization';
import type { Language } from './i18n';

/** A transient result must not reappear in the previous language after a switch. */
export function useNoticeState(explicitLanguage?: Language) {
  const language = useLanguage(explicitLanguage);
  const [state, setState] = useState({ language, text: '' });
  useEffect(() => { setState(current => current.language === language ? current : { language, text: '' }); }, [language]);
  const setNotice = useCallback((value: SetStateAction<string>) => {
    setState(current => ({ language, text: typeof value === 'function' ? value(current.language === language ? current.text : '') : value }));
  }, [language]);
  return [state.language === language ? state.text : '', setNotice] as const;
}
