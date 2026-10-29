import { createContext, useContext, useMemo } from "react";
import type { AppLanguage } from "../preferences/model";
import { getTranslator, type Translator } from "./index";

export const LanguageContext = createContext<AppLanguage>("zh");

export function useLanguage(language?: AppLanguage): AppLanguage {
  const inherited = useContext(LanguageContext);
  return language ?? inherited;
}

/** Reads the render's language directly, before preference persistence effects run. */
export function useTranslation(language?: AppLanguage): Translator {
  const current = useLanguage(language);
  return useMemo(() => getTranslator(current), [current]);
}
