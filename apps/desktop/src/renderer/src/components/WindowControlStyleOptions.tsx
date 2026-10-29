import { useTranslation } from '../localization';
import { Check } from 'lucide-react';
import type { WindowStyle } from '../windowStyle';

export function WindowControlStyleOptions({
  value,
  onChange,
}: {
  value: WindowStyle;
  onChange: (value: WindowStyle) => void;
}) {
  const t = useTranslation();
  const isMac = window.easyHub?.platform === 'darwin';
  const options: WindowStyle[] = isMac ? ['reference', 'windows'] : ['windows', 'reference'];

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
              {/* macOS marks its default dots; Windows keeps the wording it always had. */}
              {t(
                style === 'reference'
                  ? isMac
                    ? 'mac.defaultDotStyle'
                    : 'settingsPage.referenceTopLeft'
                  : 'settingsPage.topRightButtons',
              )}
            </small>
          </span>
          {value === style && <Check size={18} className="window-style-check" />}
        </button>
      ))}
    </div>
  );
}
