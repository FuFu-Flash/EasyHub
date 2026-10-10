import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { File, Paths } from 'expo-file-system';
import { defaultPreferences, normalizeTranslationNames, parsePreferences, type AppLanguage, type AppPreferences } from './model';

interface PreferencesContextValue extends AppPreferences {
  ready: boolean;
  setLanguage(language: AppLanguage): void;
  setTranslationEnabled(enabled: boolean): void;
  setTranslationNames(names: string[]): void;
  t(chinese: string, english: string): string;
}

const Context = createContext<PreferencesContextValue | null>(null);
const preferencesFile = () => new File(Paths.document, 'easyhub-mobile-preferences.json');

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(defaultPreferences);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    const file = preferencesFile();
    if (file.exists) void file.text().then((raw) => { if (active) setPreferences(parsePreferences(raw)); })
      .catch(() => undefined).finally(() => { if (active) setReady(true); });
    else queueMicrotask(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      const file = preferencesFile();
      if (!file.exists) file.create();
      file.write(JSON.stringify(preferences));
    } catch { /* The current session can still use its selected preferences. */ }
  }, [preferences, ready]);
  const setLanguage = useCallback((language: AppLanguage) => setPreferences((current) => ({ ...current, language })), []);
  const setTranslationEnabled = useCallback((translationEnabled: boolean) => setPreferences((current) => ({ ...current, translationEnabled })), []);
  const setTranslationNames = useCallback((names: string[]) => setPreferences((current) => ({ ...current, translationNames: normalizeTranslationNames(names) })), []);
  const t = useCallback((chinese: string, english: string) => preferences.language === 'en' ? english : chinese, [preferences.language]);
  return <Context.Provider value={{ ...preferences, ready, setLanguage, setTranslationEnabled, setTranslationNames, t }}>{children}</Context.Provider>;
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('PreferencesProvider is missing');
  return value;
}
