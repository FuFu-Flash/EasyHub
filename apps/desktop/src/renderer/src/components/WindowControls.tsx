import { Minus, Square, X } from 'lucide-react';
import { useEasyHub } from '../bridge';
import { useTranslation } from '../localization';
import type { WindowStyle } from '../windowStyle';

/**
 * The minimize / maximize / close buttons. The workspace top bar, the welcome page and the offline screen
 * all render these, so the buttons look and behave the same wherever the window is first seen.
 */
export function WindowControls({ style }: { style: WindowStyle }) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  if (style === 'reference') {
    // macOS draws the traffic lights itself; only their space is kept free.
    if (easyHub?.platform === 'darwin') return <span className="native-window-controls" aria-hidden="true" />;
    return (
      <div className="window-controls" aria-label={t('liveWorkspace.windowControls')}>
        <button
          className="window-dot window-close"
          aria-label={t('liveWorkspace.closeWindow')}
          onClick={() => void easyHub?.closeWindow()}
        />
        <button
          className="window-dot window-minimize"
          aria-label={t('liveWorkspace.minimizeWindow')}
          onClick={() => void easyHub?.minimizeWindow()}
        />
        <button
          className="window-dot window-maximize"
          aria-label={t('liveWorkspace.maximizeOrRestoreWindow')}
          onClick={() => void easyHub?.toggleMaximizeWindow()}
        />
      </div>
    );
  }
  return (
    <div className="windows-window-controls" aria-label={t('liveWorkspace.windowControls')}>
      <button
        className="windows-control-button"
        aria-label={t('liveWorkspace.minimizeWindow')}
        title={t('liveWorkspace.minimize')}
        onClick={() => void easyHub?.minimizeWindow()}
      >
        <Minus size={17} strokeWidth={1.6} />
      </button>
      <button
        className="windows-control-button"
        aria-label={t('liveWorkspace.maximizeOrRestoreWindow')}
        title={t('liveWorkspace.maximizeOrRestore')}
        onClick={() => void easyHub?.toggleMaximizeWindow()}
      >
        <Square size={13} strokeWidth={1.7} />
      </button>
      <button
        className="windows-control-button windows-control-close"
        aria-label={t('liveWorkspace.closeWindow')}
        title={t('liveWorkspace.close')}
        onClick={() => void easyHub?.closeWindow()}
      >
        <X size={17} strokeWidth={1.6} />
      </button>
    </div>
  );
}
