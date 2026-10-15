import { useTranslation } from '../localization';
import { useId } from 'react';
import { Check, LayoutDashboard } from 'lucide-react';
import type { Language } from '../i18n';
import type { LayoutDensity, LayoutPreference } from '../layoutPreferences';

export function LayoutSettingsPanel({ language, preference, density, onChange }: {
  language: Language;
  preference: LayoutPreference;
  density: LayoutDensity;
  onChange: (preference: LayoutPreference) => void;
}) {
  const t = useTranslation(language);
  const headingId = useId();
  
  const choices: { value: LayoutPreference; label: string; description: string }[] = [
    { value: 'auto', label: t("layoutSettingsPanel.automatic"), description: t("layoutSettingsPanel.adaptTheInterfaceToTheWindow") },
    { value: 'comfortable', label: t("layoutSettingsPanel.comfortable"), description: t("layoutSettingsPanel.moreRoomBetweenContent") },
    { value: 'compact', label: t("layoutSettingsPanel.compact"), description: t("layoutSettingsPanel.smallerControlsAndHeadingsMoreContent") },
  ];

  return <section className="panel settings-panel layout-settings-panel" aria-labelledby={headingId}>
    <div className="settings-icon blue"><LayoutDashboard size={22} /></div>
    <div className="settings-panel-content layout-settings-content">
      <h2 id={headingId}>{t("layoutSettingsPanel.interfaceLayout")}</h2>
      <p>{t("layoutSettingsPanel.adjustInterfaceSizeAndSpacingChangesApplyImmediatelyAnd")}</p>
      <div className="layout-options" role="group" aria-label={t("layoutSettingsPanel.interfaceLayout")}>
        {choices.map((choice) => <button key={choice.value} type="button" className={`layout-option${preference === choice.value ? ' selected' : ''}`} aria-label={choice.label} aria-pressed={preference === choice.value} onClick={() => onChange(choice.value)}>
          <span className={`layout-option-preview layout-preview-${choice.value}`} aria-hidden="true"><i /><span><i /><i /><i /></span></span>
          <span className="layout-option-description"><strong>{choice.label}</strong><small>{choice.description}</small></span>
          {preference === choice.value && <Check size={17} className="layout-option-check" aria-hidden="true" />}
        </button>)}
      </div>
      <p className="layout-current" role="status">{density === 'compact' ? t("layoutSettingsPanel.currentlyUsingTheCompactLayout") : t("layoutSettingsPanel.currentlyUsingTheComfortableLayout")}</p>
    </div>
  </section>;
}
