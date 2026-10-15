import { createContext } from 'react';
export type Language = 'zh' | 'en';
export const LanguageContext = createContext<Language | undefined>(undefined);

export function readLanguage(): Language {
  try {
    return window.localStorage.getItem('easyhub:language') === 'en' ? 'en' : 'zh';
  } catch {
    return 'zh';
  }
}

