import { useTranslation } from '../localization';
type WindowAction = 'closeWindow' | 'minimizeWindow' | 'toggleMaximizeWindow';

export function WindowTrafficLights({ onAction }: { onAction: (action: WindowAction) => void }) {
  const t = useTranslation();
  if (window.easyHub?.platform === 'darwin') {
    // AppKit owns the controls and their accessibility; reserve only their space.
    return <span className="native-window-controls" aria-hidden="true" />;
  }
  return (
    <div className="window-controls" aria-label={t('liveWorkspace.windowControls')}>
      <button
        className="window-dot window-close"
        aria-label={t('liveWorkspace.closeWindow')}
        title={t('liveWorkspace.close')}
        onClick={() => onAction('closeWindow')}
      />
      <button
        className="window-dot window-minimize"
        aria-label={t('liveWorkspace.minimizeWindow')}
        title={t('liveWorkspace.minimize')}
        onClick={() => onAction('minimizeWindow')}
      />
      <button
        className="window-dot window-maximize"
        aria-label={t('liveWorkspace.maximizeOrRestoreWindow')}
        title={t('liveWorkspace.maximizeOrRestore')}
        onClick={() => onAction('toggleMaximizeWindow')}
      />
    </div>
  );
}
