import { Check } from 'lucide-react';
import type { WindowControlStyle } from '../windowControlStyle';

export function WindowControlStyleOptions({ value, onChange }: {
  value: WindowControlStyle;
  onChange: (value: WindowControlStyle) => void;
}) {
  const isMac = window.easyHub?.platform === 'darwin';
  const options: WindowControlStyle[] = isMac ? ['reference', 'windows'] : ['windows', 'reference'];

  return <div className="window-style-options" role="group" aria-label="窗口控件样式">
    {options.map((style) => <button
      key={style}
      className={`window-style-option ${value === style ? 'selected' : ''}`}
      aria-pressed={value === style}
      onClick={() => onChange(style)}
    >
      <span className={`window-style-preview ${style === 'reference' ? 'reference' : 'windows'}-preview`} aria-hidden="true"><span /><span /><span /></span>
      <span>
        <strong>{style === 'reference' ? '圆点风格' : 'Windows 风格'}</strong>
        <small>{style === 'reference'
          ? isMac ? '默认 · 左上角圆点' : '参考图 · 左上角圆点'
          : isMac ? '右上角按钮' : '默认 · 右上角按钮'}</small>
      </span>
      {value === style && <Check size={18} className="window-style-check" />}
    </button>)}
  </div>;
}
