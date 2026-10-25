import { useTranslation } from '../localization';
import { Check } from 'lucide-react';
import type { WindowControlStyle } from '../windowControlStyle';

export function WindowControlStyleOptions({
  value,
  onChange,
}: {
  value: WindowControlStyle;
  onChange: (value: WindowControlStyle) => void;
}) {
  const t = useTranslation();
  const isMac = window.easyHub?.platform === 'darwin';
  const options: WindowControlStyle[] = isMac ? ['reference', 'windows'] : ['windows', 'reference'];

  return (
    <div className="window-style-options" role="group" aria-label={t('settingsPage.windowControlStyle')}>
      {options.map((style) => (
        <button
          key={style}
          className={`window-style-option ${value === style ? 'selected' : ''}`}
          aria-pressed={value === style}
          onClick={() => onChange(style)}
        >
          <span
            className={`window-style-preview ${style === 'reference' ? 'reference' : 'windows'}-preview`}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>{t(style === 'reference' ? 'settingsPage.dotStyle' : 'settingsPage.windowsStyle')}</strong>
            <small>
              {t(
                style === 'reference'
                  ? isMac
                    ? 'mac.defaultDotStyle'
                    : 'settingsPage.referenceTopLeft'
                  : isMac
                    ? 'settingsPage.topRightButtons'
                    : 'mac.defaultWindowsStyle',
              )}
            </small>
          </span>
          {value === style && <Check size={18} className="window-style-check" />}
        </button>
      ))}
    </div>
  );
}
