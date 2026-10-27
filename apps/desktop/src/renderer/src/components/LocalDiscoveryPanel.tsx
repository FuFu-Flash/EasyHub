import { progressLabel } from '../progressLabel';
import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import type { LocalDiscoveryResult, LocalOperationProgress } from '@easyhub/types';
import { FolderSearch, Plus, RotateCw, X } from 'lucide-react';

interface Props {
  onAdded: () => Promise<void>;
}
let lastAutomaticScan = 0;

export function LocalDiscoveryPanel({ onAdded }: Props) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [roots, setRoots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LocalOperationProgress | null>(null);
  const [result, setResult] = useState<LocalDiscoveryResult | null>(null);
  const [error, setError] = useState('');
  const api = easyHub;

  async function scan(): Promise<void> {
    if (!api) return;
    setBusy(true);
    setError('');
    setProgress(null);
    setResult(null);
    try {
      const found = await api.localDiscoveryScan();
      setResult(found);
      await onAdded();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  useEffect(() => {
    if (!api) return;
    let active = true;
    const stop = api.onLocalProgress((value) => {
      if (active) setProgress(value);
    });
    void api
      .localDiscoveryRoots()
      .then((items) => {
        if (!active) return;
        setRoots(items);
        if (items.length > 0 && Date.now() - lastAutomaticScan > 10 * 60_000) {
          lastAutomaticScan = Date.now();
          void scan();
        }
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      stop();
    };
  }, []);

  async function chooseRoot(): Promise<void> {
    if (!api || busy) return;
    try {
      const path = await api.chooseFolder();
      if (!path) return;
      setRoots(await api.localDiscoveryAddRoot(path));
      lastAutomaticScan = Date.now();
      await scan();
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function removeRoot(path: string): Promise<void> {
    if (!api || busy) return;
    try {
      setRoots(await api.localDiscoveryRemoveRoot(path));
      setResult(null);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <section className="panel local-discovery-panel">
      <div className="local-discovery-heading">
        <span className="local-discovery-icon">
          <FolderSearch size={21} />
        </span>
        <div>
          <h2>{t('localDiscoveryPanel.findExistingProjects')}</h2>
          <p>{t('localDiscoveryPanel.chooseAFolderContainingYourProjectsEasyhubWillFind')}</p>
        </div>
        <button className="button button-quiet" disabled={busy} onClick={() => void chooseRoot()}>
          <Plus size={16} />
          {t('localDiscoveryPanel.addSearchLocation')}
        </button>
      </div>
      {roots.length > 0 && (
        <div className="local-discovery-roots">
          {roots.map((root) => (
            <span className="local-discovery-root" key={root} title={root}>
              <span>{root}</span>
              <button
                aria-label={t('localDiscoveryPanel.remove', { p0: root })}
                title={t('localDiscoveryPanel.removeSearchLocation')}
                disabled={busy}
                onClick={() => void removeRoot(root)}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="local-discovery-footer">
        {busy ? (
          <span className="muted">
            <RotateCw size={15} className="live-spin" />
            {progressLabel(progress, t)}
          </span>
        ) : result ? (
          <span className="muted">
            {t('localDiscoveryPanel.added')} {result.added} {t('localDiscoveryPanel.projects')}
            {result.alreadyAdded} {t('localDiscoveryPanel.wereAlreadyAdded')}
            {result.skipped > 0
              ? t('localDiscoveryPanel.anotherCouldNotBeVerifiedAndWereNotAdded', { p0: result.skipped })
              : ''}
            {result.limited ? t('localDiscoveryPanel.theSearchReachedItsLimitTryASmallerLocation') : ''}
          </span>
        ) : null}
        {busy ? (
          <button className="text-link" onClick={() => void api?.localCancel()}>
            {t('localDiscoveryPanel.cancel')}
          </button>
        ) : roots.length > 0 ? (
          <button className="text-link" onClick={() => void scan()}>
            {t('localDiscoveryPanel.searchAgain')}
          </button>
        ) : null}
      </div>
      {error && (
        <p className="live-error" role="alert">
          <ErrorMessage error={error} />
        </p>
      )}
    </section>
  );
}
