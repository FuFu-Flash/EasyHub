export type AppLanguage = 'zh' | 'en';
export interface AppPreferences { language: AppLanguage; translationEnabled: boolean }

export const defaultPreferences: AppPreferences = { language: 'zh', translationEnabled: false };

export function parsePreferences(raw: string): AppPreferences {
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaultPreferences;
    const value = data as Record<string, unknown>;
    return {
      language: value.language === 'en' ? 'en' : 'zh',
      translationEnabled: value.translationEnabled === true,
    };
  } catch { return defaultPreferences; }
}
