import { X } from 'lucide-react';
import type { FormEvent } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { ErrorMessage } from './ErrorMessage';
import { ForkSetup } from './ForkSetup';

export type ProposalType = 'issue' | 'pull';

/** Report an issue, or prepare a copy for suggesting changes, on someone else's project. */
export function PublicProposalDialog({
  repo,
  language,
  currentUser,
  proposalType,
  onProposalTypeChange,
  issueTitle,
  onIssueTitleChange,
  issueBody,
  onIssueBodyChange,
  saving,
  error,
  onForkReady,
  onClose,
  onSubmit,
}: {
  repo: GitHubRepo;
  language: Language;
  currentUser: string;
  proposalType: ProposalType;
  onProposalTypeChange: (type: ProposalType) => void;
  issueTitle: string;
  onIssueTitleChange: (value: string) => void;
  issueBody: string;
  onIssueBodyChange: (value: string) => void;
  saving: boolean;
  error: string;
  onForkReady: (fork: GitHubRepo) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const t = useTranslation(language);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className="modal issue-modal proposal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-new-proposal-title"
        onSubmit={onSubmit}
      >
        <button
          type="button"
          className="icon-button modal-close"
          aria-label={t('publicProjectBrowser.close')}
          disabled={saving}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <h2 id="public-new-proposal-title">{t('publicProjectBrowser.reportAnIssueSuggestAChange')}</h2>
        <p>{t('publicProjectBrowser.reportAnIssueToTheAuthorOfOrPropose', { p0: repo.full_name })}</p>
        <div className="proposal-options" role="radiogroup" aria-label={t('publicProjectBrowser.feedbackType')}>
          <label className={proposalType === 'issue' ? 'selected' : ''}>
            <input
              type="radio"
              name="proposal-type"
              value="issue"
              checked={proposalType === 'issue'}
              disabled={saving}
              onChange={() => onProposalTypeChange('issue')}
            />
            <span>
              <strong>{t('publicProjectBrowser.reportAnIssue')}</strong>
              <small>{t('publicProjectBrowser.describeAProblemOrShareAnIdea')}</small>
            </span>
          </label>
          <label className={proposalType === 'pull' ? 'selected' : ''}>
            <input
              type="radio"
              name="proposal-type"
              value="pull"
              checked={proposalType === 'pull'}
              disabled={saving}
              onChange={() => onProposalTypeChange('pull')}
            />
            <span>
              <strong>{t('publicProjectBrowser.createPullRequest')}</strong>
              <small>{t('publicProjectBrowser.shareChangesAlreadySavedToGithubWithTheProject')}</small>
            </span>
          </label>
        </div>
        {proposalType === 'issue' ? (
          <>
            <label className="field">
              <span>{t('publicProjectBrowser.issueTitle')}</span>
              <input
                value={issueTitle}
                onChange={(event) => onIssueTitleChange(event.target.value)}
                required
                maxLength={256}
                placeholder={t('publicProjectBrowser.summarizeTheIssueInOneSentence')}
              />
            </label>
            <label className="field">
              <span>{t('publicProjectBrowser.details')}</span>
              <textarea
                rows={5}
                value={issueBody}
                onChange={(event) => onIssueBodyChange(event.target.value)}
                maxLength={65536}
                placeholder={t('publicProjectBrowser.whatHappenedWhatWouldYouLikeToImprove')}
              />
            </label>
          </>
        ) : (
          <ForkSetup source={repo} currentUser={currentUser} onReady={onForkReady} />
        )}
        {error && (
          <p className="live-error" role="alert">
            <ErrorMessage error={error} language={language} />
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button button-quiet" disabled={saving} onClick={onClose}>
            {t('publicProjectBrowser.cancel')}
          </button>
          {proposalType === 'issue' && (
            <button type="submit" className="button button-primary" disabled={saving || !issueTitle.trim()}>
              {t('publicProjectBrowser.createIssue')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
