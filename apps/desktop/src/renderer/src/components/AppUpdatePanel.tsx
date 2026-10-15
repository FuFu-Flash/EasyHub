import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { Language } from '../i18n';
import type { AppUpdateResult } from '../../../shared/appUpdate';

export function AppUpdatePanel({ language }: { language: Language }) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AppUpdateResult | null>(null);
  const [error, setError] = useState('');

  async function check(): Promise<void> {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      if (!easyHub) throw new Error('unavailable');
      setResult(await easyHub.github<AppUpdateResult>('appUpdate'));
    } catch {
      setError(t('appUpdatePanel.unableToCheckForUpdatesPleaseTryAgainLater'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-update-panel">
      <button type="button" className="button button-quiet" disabled={busy} onClick={() => void check()}>
        <RefreshCw size={15} />
        {busy ? t('appUpdatePanel.checking') : t('appUpdatePanel.checkForUpdates')}
      </button>
      {result && (
        <p role="status">
          {result.available
            ? t('appUpdatePanel.versionIsAvailable', { p0: result.latestVersion })
            : t('appUpdatePanel.youAreUpToDate')}
        </p>
      )}
      {result?.available && (
        <button
          type="button"
          className="text-link"
          onClick={() =>
            void easyHub
              ?.openExternalLink(result.releaseUrl)
              .catch(() => setError(t('appUpdatePanel.unableToOpenTheDownloadPage')))
          }
        >
          <Download size={15} />
          {t('appUpdatePanel.viewUpdateAndDownload')}
        </button>
      )}
      {error && (
        <p className="live-error" role="alert">
          <ErrorMessage error={error} />
        </p>
      )}
    </div>
  );
}
