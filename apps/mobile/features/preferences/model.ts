import { parseThemePreference, type ThemePreference } from "../theme/theme.ts";

export type AppLanguage = "zh" | "en";
export interface AppPreferences {
  language: AppLanguage;
  theme: ThemePreference;
  translationEnabled: boolean;
  translationNames: string[];
}

export const defaultPreferences: AppPreferences = {
  language: "zh",
  theme: "system",
  translationEnabled: false,
  translationNames: [],
};

export function normalizeTranslationNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim())
        .filter((name) => name.length >= 2 && name.length <= 80),
    ),
  ].slice(0, 100);
}

export function parsePreferences(raw: string): AppPreferences {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return defaultPreferences;
    const value = data as Record<string, unknown>;
    return {
      language: value.language === "en" ? "en" : "zh",
      theme: parseThemePreference(value.theme),
      translationEnabled: value.translationEnabled === true,
      translationNames: normalizeTranslationNames(value.translationNames),
    };
  } catch {
    return defaultPreferences;
  }
}
