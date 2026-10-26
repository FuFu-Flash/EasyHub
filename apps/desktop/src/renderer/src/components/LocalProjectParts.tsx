import { CheckCircle2, Download } from 'lucide-react';
import type { FormEvent, RefObject } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import type { LocalProjectLink, LocalProjectStatus } from '@easyhub/types';
import { readAppError } from '../errors';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { ErrorMessage } from './ErrorMessage';
import { ReadmeMarkdown } from './ReadmeMarkdown';

/** Shown in place of the project tools when its local folder cannot be read. */
export function LocalFolderError({
  language,
  statusError,
  missing,
  busy,
  onRelocate,
  onRetry,
  onRemove,
}: {
  language: Language;
  statusError: string;
  missing: boolean;
  busy: boolean;
  onRelocate: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const t = useTranslation(language);
  return (
    <div className="local-folder-error" role="alert">
      <h3>{missing ? t('localWorkspace.cannotFindThisFolder') : t('localWorkspace.cannotReadThisFolderRightNow')}</h3>
      <p>{t('localWorkspace.ifYouMovedTheFolderSelectItsNewLocation')}</p>
      {missing ? (
        <details>
          <summary>{t('localWorkspace.viewDetails')}</summary>
          <pre data-content-original>{readAppError(statusError).detail}</pre>
        </details>
      ) : (
        <ErrorMessage error={statusError} />
      )}
      <div className="local-actions">
        <button className="button button-primary" disabled={busy} onClick={onRelocate}>
          {t('localWorkspace.chooseNewLocation')}
        </button>
        <button className="button button-quiet" disabled={busy} onClick={onRetry}>
          {t('localWorkspace.retry')}
        </button>
        <button className="button button-quiet" disabled={busy} onClick={onRemove}>
          {t('localWorkspace.remove')}
        </button>
      </div>
    </div>
  );
}

/** Publish step: the target's visibility, a short description of the change and the submit button. */
export function LocalPublishForm({
  language,
  status,
  targetPrivate,
  message,
  onMessageChange,
  inputRef,
  submitDisabled,
  onCancel,
  onSubmit,
}: {
  language: Language;
  status: LocalProjectStatus;
  targetPrivate: boolean | undefined;
  message: string;
  onMessageChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  submitDisabled: boolean;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const t = useTranslation(language);
  return (
    <form className="local-publish" onSubmit={onSubmit}>
      <h3>{t('localWorkspace.publishSourceCode')}</h3>
      <p className={targetPrivate ? '' : 'local-sensitive-warning'}>
        {targetPrivate
          ? t('localWorkspace.targetRepositoryPrivateVisibleToAuthorizedPeopleOnly')
          : t('localWorkspace.targetRepositoryPublicAnyoneCanReadPublishedFilesDo')}
      </p>
      <div className="local-publish-row">
        <label className="field">
          <span>
            {t('localWorkspace.whatChanged')}
            <small>{t('localWorkspace.whatChangedRequired')}</small>
          </span>
          <input
            ref={inputRef}
            aria-label={t('localWorkspace.whatChanged')}
            required
            maxLength={200}
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            placeholder={t('localWorkspace.forExampleFixWindowResizing')}
          />
        </label>
        <div className="local-actions">
          <button className="button button-quiet" type="button" onClick={onCancel}>
            {t('localWorkspace.cancel')}
          </button>
          <button className="button button-primary" disabled={submitDisabled} type="submit">
            {status.pendingPublish ? t('localWorkspace.retryPublishing') : t('localWorkspace.publishSelectedFiles')}
          </button>
        </div>
      </div>
    </form>
  );
}

/** Collapsible README of a local project, read from its folder. */
export function LocalIntroduction({
  language,
  item,
  branch,
  introduction,
  onRefresh,
  onOpenLink,
}: {
  language: Language;
  item: LocalProjectLink;
  branch: string;
  introduction: { content: string; error: string } | undefined;
  onRefresh: () => void;
  onOpenLink: (url: string) => void;
}) {
  const t = useTranslation(language);
  return (
    <details
      className="local-readme"
      onToggle={(event) => {
        if (event.currentTarget.open) onRefresh();
      }}
    >
      <summary>{t('localWorkspace.projectIntroduction')}</summary>
      <section aria-label={t('localWorkspace.projectIntroduction')}>
        <div className="panel-heading">
          <h3>{t('localWorkspace.projectIntroduction')}</h3>
        </div>
        {!introduction ? (
          <p className="muted" role="status">
            {t('localWorkspace.loadingProjectIntroduction')}
          </p>
        ) : introduction.error ? (
          <div>
            <p className="live-error" role="alert">
              <ErrorMessage error={introduction.error} />
            </p>
            <button className="text-link" onClick={onRefresh}>
              {t('localWorkspace.readAgain')}
            </button>
          </div>
        ) : introduction.content ? (
          <ReadmeMarkdown
            markdown={introduction.content}
            repository={{ owner: item.owner, name: item.name, branch }}
            onOpenLink={onOpenLink}
          />
        ) : (
          <p className="muted">{t('localWorkspace.thisProjectHasNoIntroductionYet')}</p>
        )}
      </section>
    </details>
  );
}

/** Cloud projects that are not on this computer yet, each with a download button. */
export function LocalCloudProjects({
  language,
  repos,
  links,
  disabled,
  onDownload,
}: {
  language: Language;
  repos: GitHubRepo[];
  links: LocalProjectLink[];
  disabled: boolean;
  onDownload: (repo: GitHubRepo) => void;
}) {
  const t = useTranslation(language);
  return (
    <section className="panel live-section">
      <div className="panel-heading">
        <h2>{t('localWorkspace.cloudProjects')}</h2>
      </div>
      {repos
        .filter((repo) => !links.some((item) => item.repositoryId === repo.id))
        .map((repo) => (
          <div className="live-repo-row local-cloud-row" key={repo.id}>
            <span>
              <strong>{repo.name}</strong>
              <small>{repo.description || t('localWorkspace.noDescriptionYet')}</small>
            </span>
            <button className="button button-quiet" disabled={disabled} onClick={() => onDownload(repo)}>
              <Download size={16} />
              {t('localWorkspace.download')}
            </button>
          </div>
        ))}
      {repos.every((repo) => links.some((item) => item.repositoryId === repo.id)) && (
        <p className="muted">
          <CheckCircle2 size={16} />
          {t('localWorkspace.allCloudProjectsAreOnThisComputer')}
        </p>
      )}
    </section>
  );
}
