import { useTranslation } from '../localization';
import { useId } from 'react';
import { Check, LayoutDashboard } from 'lucide-react';
import type { Language } from '../i18n';
import type { LayoutPreference } from '../layoutPreferences';

export function LayoutSettingsPanel({
  language,
  preference,
  onChange,
}: {
  language: Language;
  preference: LayoutPreference;
  onChange: (preference: LayoutPreference) => void;
}) {
  const t = useTranslation(language);
  const headingId = useId();

  const choices: { value: LayoutPreference; label: string }[] = [
    {
      value: 'auto',
      label: t('layoutSettingsPanel.automatic'),
    },
    {
      value: 'comfortable',
      label: t('layoutSettingsPanel.comfortable'),
    },
    {
      value: 'compact',
      label: t('layoutSettingsPanel.compact'),
    },
  ];

  return (
    <section className="panel settings-panel layout-settings-panel" aria-labelledby={headingId}>
      <div className="settings-icon blue">
        <LayoutDashboard size={22} />
      </div>
      <div className="settings-panel-content layout-settings-content">
        <h2 id={headingId}>{t('layoutSettingsPanel.interfaceLayout')}</h2>
        <div className="layout-options" role="group" aria-label={t('layoutSettingsPanel.interfaceLayout')}>
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={`layout-option${preference === choice.value ? ' selected' : ''}`}
              aria-label={choice.label}
              aria-pressed={preference === choice.value}
              onClick={() => onChange(choice.value)}
            >
              <span className={`layout-option-preview layout-preview-${choice.value}`} aria-hidden="true">
                <i />
                <span>
                  <i />
                  <i />
                  <i />
                </span>
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
