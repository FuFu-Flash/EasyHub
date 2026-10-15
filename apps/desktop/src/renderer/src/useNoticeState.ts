import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PageActivityContext } from './components/NavigationPages';
import type { SetStateAction } from 'react';
import { useLanguage } from './localization';
import type { Language } from './i18n';

/** A transient result must not reappear in the previous language after a switch. */
export function useNoticeState(explicitLanguage?: Language) {
  const language = useLanguage(explicitLanguage);
  const active = useContext(PageActivityContext);
  const activeRef = useRef(active);
  activeRef.current = active;
  const [state, setState] = useState({ language, text: '' });
  useEffect(() => {
    setState((current) => (current.language === language ? current : { language, text: '' }));
  }, [language]);
  useEffect(() => {
    if (!active) setState({ language, text: '' });
  }, [active, language]);
  const setNotice = useCallback(
    (value: SetStateAction<string>) => {
      if (!activeRef.current) return;
      setState((current) => ({
        language,
        text: typeof value === 'function' ? value(current.language === language ? current.text : '') : value,
      }));
    },
    [language],
  );
  return [active && state.language === language ? state.text : '', setNotice] as const;
}
