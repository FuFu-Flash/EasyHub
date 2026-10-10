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
  const headingId = useId();
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const choices: { value: LayoutPreference; label: string; description: string }[] = [
    { value: 'auto', label: t('自动适配', 'Automatic'), description: t('随窗口大小调整界面', 'Adapt the interface to the window') },
    { value: 'comfortable', label: t('舒适', 'Comfortable'), description: t('留白宽松，内容更舒展', 'More room between content') },
    { value: 'compact', label: t('紧凑', 'Compact'), description: t('缩小控件与标题，查看更多内容', 'Smaller controls and headings, more content') },
  ];

  return <section className="panel settings-panel layout-settings-panel" aria-labelledby={headingId}>
    <div className="settings-icon blue"><LayoutDashboard size={22} /></div>
    <div className="settings-panel-content layout-settings-content">
      <h2 id={headingId}>{t('界面布局', 'Interface layout')}</h2>
      <p>{t('调整界面大小与间距。更改立即生效，并保存在这台电脑上。', 'Adjust interface size and spacing. Changes apply immediately and are saved on this computer.')}</p>
      <div className="layout-options" role="group" aria-label={t('界面布局', 'Interface layout')}>
        {choices.map((choice) => <button key={choice.value} type="button" className={`layout-option${preference === choice.value ? ' selected' : ''}`} aria-label={choice.label} aria-pressed={preference === choice.value} onClick={() => onChange(choice.value)}>
          <span className={`layout-option-preview layout-preview-${choice.value}`} aria-hidden="true"><i /><span><i /><i /><i /></span></span>
          <span className="layout-option-description"><strong>{choice.label}</strong><small>{choice.description}</small></span>
          {preference === choice.value && <Check size={17} className="layout-option-check" aria-hidden="true" />}
        </button>)}
      </div>
      <p className="layout-current" role="status">{density === 'compact' ? t('当前使用紧凑布局。', 'Currently using the compact layout.') : t('当前使用舒适布局。', 'Currently using the comfortable layout.')}</p>
    </div>
  </section>;
}
