import type { SyncDecision, SyncPreview } from '@easyhub/types';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';

/** Per-file choice between the local copy and GitHub when both changed. */
export function LocalSyncReview({
  language,
  preview,
  choices,
  showDifferences,
  busy,
  onToggleDifference,
  onChoose,
  onDecideLater,
  onConfirm,
}: {
  language: Language;
  preview: SyncPreview;
  choices: Record<string, SyncDecision['choice']>;
  showDifferences: Record<string, boolean>;
  busy: boolean;
  onToggleDifference: (path: string) => void;
  onChoose: (path: string, choice: SyncDecision['choice']) => void;
  onDecideLater: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslation(language);
  return (
    <div className="sync-review">
      <h3>{t('localWorkspace.contentNeedsYourChoice')}</h3>
      <p>{t('localWorkspace.theseFilesWereAlsoChangedOnAnotherComputerReview')}</p>
      {preview.files.map((file) => (
        <div className="sync-review-file" key={file.path}>
          <strong>{file.path}</strong>
          <div className="local-actions">
            <button className="button button-quiet" type="button" onClick={() => onToggleDifference(file.path)}>
              {showDifferences[file.path] ? t('localWorkspace.hideComparison') : t('localWorkspace.compareVersions')}
            </button>
            <button
              className={`button ${choices[file.path] === 'mine' ? 'button-primary' : 'button-quiet'}`}
              type="button"
              onClick={() => onChoose(file.path, 'mine')}
            >
              {t('localWorkspace.keepMine')}
            </button>
            <button
              className={`button ${choices[file.path] === 'github' ? 'button-primary' : 'button-quiet'}`}
              type="button"
              onClick={() => onChoose(file.path, 'github')}
            >
              {t('localWorkspace.useGithubVersion')}
            </button>
          </div>
          {showDifferences[file.path] && (
            <div className="sync-review-diff">
              <div>
                <span>{t('localWorkspace.yourVersion')}</span>
                <pre>{file.mine ?? t('localWorkspace.thisVersionHasNoFile')}</pre>
              </div>
              <div>
                <span>{t('localWorkspace.versionOnGithub')}</span>
                <pre>{file.github ?? t('localWorkspace.thisVersionHasNoFile')}</pre>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="local-actions">
        <button className="button button-quiet" type="button" onClick={onDecideLater}>
          {t('localWorkspace.decideLater')}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={busy || preview.files.some((file) => !choices[file.path])}
          onClick={onConfirm}
        >
          {t('localWorkspace.confirmAndGetLatest')}
        </button>
      </div>
    </div>
  );
}
