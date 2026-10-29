import { useTranslation } from '../localization';
import { useId } from 'react';
import { Check, SunMoon } from 'lucide-react';
import type { Language } from '../i18n';
import type { ThemePreference } from '../themePreferences';

export function ThemeSettingsPanel({
  language,
  preference,
  onChange,
}: {
  language: Language;
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}) {
  const t = useTranslation(language);
  const headingId = useId();

  const choices: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: t('themeSettingsPanel.system') },
    { value: 'light', label: t('themeSettingsPanel.light') },
    { value: 'dark', label: t('themeSettingsPanel.dark') },
  ];

  return (
    <section className="panel settings-panel theme-settings-panel" aria-labelledby={headingId}>
      <div className="settings-icon blue">
        <SunMoon size={22} />
      </div>
      <div className="settings-panel-content layout-settings-content">
        <h2 id={headingId}>{t('themeSettingsPanel.appearance')}</h2>
        <div className="layout-options" role="group" aria-label={t('themeSettingsPanel.appearance')}>
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={`layout-option${preference === choice.value ? ' selected' : ''}`}
              aria-label={choice.label}
              aria-pressed={preference === choice.value}
              onClick={() => onChange(choice.value)}
            >
              {/* Each preview carries its own theme so it looks the same in light and dark. */}
              <span className={`theme-option-preview theme-preview-${choice.value}`} aria-hidden="true">
                {choice.value === 'system' ? (
                  <>
                    <span data-theme="light" />
                    <span data-theme="dark" />
                  </>
                ) : (
                  <span data-theme={choice.value} />
                )}
              </span>
              <span className="layout-option-description">
                <strong>{choice.label}</strong>
              </span>
              {preference === choice.value && <Check size={17} className="layout-option-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
