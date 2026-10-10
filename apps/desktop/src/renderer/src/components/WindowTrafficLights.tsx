type WindowAction = 'closeWindow' | 'minimizeWindow' | 'toggleMaximizeWindow';

export function WindowTrafficLights({ onAction }: { onAction: (action: WindowAction) => void }) {
  if (window.easyHub?.platform === 'darwin') {
    // AppKit owns the controls and their accessibility; reserve only their space.
    return <span className="native-window-controls" aria-hidden="true" />;
  }
  return <div className="window-controls" aria-label="窗口控制">
    <button className="window-dot window-close" aria-label="关闭窗口" title="关闭" onClick={() => onAction('closeWindow')} />
    <button className="window-dot window-minimize" aria-label="最小化窗口" title="最小化" onClick={() => onAction('minimizeWindow')} />
    <button className="window-dot window-maximize" aria-label="最大化或还原窗口" title="最大化或还原" onClick={() => onAction('toggleMaximizeWindow')} />
  </div>;
}
