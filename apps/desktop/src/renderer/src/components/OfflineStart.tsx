import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Minus, Square, X } from 'lucide-react';
import { useTranslation, useLanguage } from '../localization';
import { useEasyHub } from '../bridge';
import appIcon from '../assets/easyhub-icon.svg';
import { HostsRepairPanel } from './HostsRepairPanel';
import { WindowTrafficLights } from './WindowTrafficLights';

/** No invented account or empty-project guidance when the first profile fetch is offline. */
export function OfflineStart({ onRetry, repairRequest = 0 }: { onRetry: () => void; repairRequest?: number }) {
  const t = useTranslation();
  const language = useLanguage();
  const api = useEasyHub();
  const [repair, setRepair] = useState(false);
  const repairPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (repairRequest > 0) setRepair(true);
  }, [repairRequest]);
  useEffect(() => {
    if (!repair) return;
    const frame = requestAnimationFrame(() => {
      repairPanel.current?.scrollIntoView({ block: 'start' });
      repairPanel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [repair, repairRequest]);
  return (
    <div className="welcome-page offline-start">
      <header className="welcome-controls" aria-label={t('liveWorkspace.windowControls')}>
        {api?.platform === 'darwin' ? (
          <WindowTrafficLights
            onAction={(action) => {
              void api?.[action]();
            }}
          />
        ) : (
          <>
            <button
              className="icon-button"
              aria-label={t('app.minimizeWindow')}
              onClick={() => void api?.minimizeWindow()}
            >
              <Minus size={18} />
            </button>
            <button
              className="icon-button"
              aria-label={t('app.maximizeOrRestoreWindow')}
              onClick={() => void api?.toggleMaximizeWindow()}
            >
              <Square size={16} />
            </button>
            <button className="icon-button" aria-label={t('app.closeWindow')} onClick={() => void api?.closeWindow()}>
              <X size={18} />
            </button>
          </>
        )}
      </header>
      <section>
        <img src={appIcon} alt="EasyHub" />
        <h1>{t('app.offlineWithoutProjectData')}</h1>
        <p>{t('app.offlineWithoutProjectDataHelp')}</p>
        <div className="modal-actions">
          <button className="button button-primary" onClick={onRetry}>
            {t('liveWorkspace.retry')}
          </button>
          <button className="button button-quiet" onClick={() => setRepair((value) => !value)} aria-expanded={repair}>
            {t('liveWorkspace.networkRepair')}
          </button>
        </div>
        {repair && (
          <div className="offline-network-settings" ref={repairPanel}>
            <button className="back-link" onClick={() => setRepair(false)}>
              <ArrowLeft size={16} />
              {t('app.backToConnection')}
            </button>
            <HostsRepairPanel language={language} />
          </div>
        )}
      </section>
    </div>
  );
}
