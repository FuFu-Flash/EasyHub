import type { RefObject } from 'react';
import type { ChangedFile, LocalProjectLink } from '@easyhub/types';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { sensitiveReasonText } from '../sensitiveReasonText';

/** Confirms removing a project from this computer's list; files stay on disk. */
export function LocalRemoveDialog({
  language,
  target,
  busy,
  dialogRef,
  onCancel,
  onConfirm,
}: {
  language: Language;
  target: LocalProjectLink;
  busy: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslation(language);
  return (
    <div className="modal-backdrop">
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="remove-local-title">
        <h2 id="remove-local-title">{t('localWorkspace.removeLocalProjectLink')}</h2>
        <p data-content-original>{target.name}</p>
        <p>{t('localWorkspace.thisOnlyRemovesTheLinkFromThisComputerS')}</p>
        <div className="modal-actions">
          <button className="button button-quiet" disabled={busy} onClick={onCancel}>
            {t('localWorkspace.cancel')}
          </button>
          <button className="button danger-confirm" disabled={busy} onClick={onConfirm}>
            {t('localWorkspace.confirmRemoval')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Lists selected files that may contain secrets before they are published. */
export function LocalSensitiveConfirmDialog({
  language,
  files,
  dialogRef,
  onBack,
  onConfirm,
}: {
  language: Language;
  files: ChangedFile[] | undefined;
  dialogRef: RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslation(language);
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="sensitive-confirm-title" ref={dialogRef}>
        <h2 id="sensitive-confirm-title">{t('localWorkspace.theseFilesMayContainPasswordsOrKeys')}</h2>
        <p className="local-sensitive-warning">{t('localWorkspace.checkTheseFilesAnyoneWithAccessToThisRepository')}</p>
        <ul>
          {files?.map((file) => (
            <li key={file.path}>
              <strong>{file.path}</strong>
              <ul>
                {file.sensitiveReasons?.map((reason) => (
                  <li key={reason}>{sensitiveReasonText(reason, language)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="button button-quiet" onClick={onBack}>
            {t('localWorkspace.backToReview')}
          </button>
          <button className="button danger-confirm" onClick={onConfirm}>
            {t('localWorkspace.confirmPublicationOfTheseFiles')}
          </button>
        </div>
      </div>
    </div>
  );
}
