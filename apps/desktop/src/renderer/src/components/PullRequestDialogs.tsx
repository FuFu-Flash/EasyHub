import { Check, RotateCw, Sparkles, X } from 'lucide-react';
import { useRef } from 'react';
import type { FormEvent } from 'react';
import { useDialogFocus } from './useDialogFocus';
import type { GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import type { AiSettingsStatus } from '@easyhub/types';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { ErrorMessage } from './ErrorMessage';

export type PullDecision = 'accept' | 'reject';

export interface PullRequestDraft {
  title: string;
  body: string;
  sourceOwner: string;
  sourceBranch: string;
  base: string;
}

/** Approve or reject entry shown to people who can manage the project. */
export function PullReviewActions({
  language,
  selected,
  disabled,
  hasDecisionRevision,
  onDecide,
}: {
  language: Language;
  selected: GitHubPullRequest;
  disabled: boolean;
  hasDecisionRevision: boolean;
  onDecide: (decision: PullDecision) => void;
}) {
  const t = useTranslation(language);
  return (
    <div className="pull-review-actions">
      <div>
        <strong>{t('pullRequestsPanel.reviewTheseChanges')}</strong>
        <p>
          {selected.draft
            ? t('pullRequestsPanel.theAuthorIsStillPreparingTheseChangesTheyCan')
            : t('pullRequestsPanel.approvalMergesTheChangesIntoYourProjectRejectionCloses')}
        </p>
      </div>
      <div className="pull-review-buttons">
        <button
          className="button button-quiet pull-reject-button"
          disabled={disabled || !hasDecisionRevision}
          onClick={() => onDecide('reject')}
        >
          {t('pullRequestsPanel.reject')}
        </button>
        <button
          className="button button-primary"
          disabled={disabled || !hasDecisionRevision || selected.draft}
          onClick={() => onDecide('accept')}
        >
          <Check size={16} />
          {t('pullRequestsPanel.approveAndMerge')}
        </button>
      </div>
    </div>
  );
}

export function CreatePullRequestDialog({
  repo,
  language,
  draft,
  onDraftChange,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  repo: GitHubRepo;
  language: Language;
  draft: PullRequestDraft;
  onDraftChange: (patch: Partial<PullRequestDraft>) => void;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const t = useTranslation(language);
  const dialog = useRef<HTMLFormElement>(null);
  useDialogFocus(true, dialog, () => {
    if (!saving) onClose();
  });
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className="modal issue-modal"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-pull-title"
        onSubmit={onSubmit}
      >
        <button
          type="button"
          className="icon-button modal-close"
          aria-label={t('pullRequestsPanel.close')}
          disabled={saving}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <h2 id="new-pull-title">{t('pullRequestsPanel.createPullRequest')}</h2>
        <p>{t('pullRequestsPanel.saveYourChangesToGithubFirstThenChooseThe')}</p>
        <label className="field">
          <span>{t('pullRequestsPanel.title')}</span>
          <input
            value={draft.title}
            onChange={(event) => onDraftChange({ title: event.target.value })}
            maxLength={256}
            required
            placeholder={t('pullRequestsPanel.summarizeTheProposedChange')}
          />
        </label>
        <label className="field">
          <span>{t('pullRequestsPanel.details')}</span>
          <textarea
            rows={4}
            value={draft.body}
            onChange={(event) => onDraftChange({ body: event.target.value })}
            maxLength={65536}
            placeholder={t('pullRequestsPanel.describeWhyAndHowItHelps')}
          />
        </label>
        <div className="pull-source-fields">
          <label className="field">
            <span>{t('pullRequestsPanel.sourceAccount')}</span>
            <input
              value={draft.sourceOwner}
              onChange={(event) => onDraftChange({ sourceOwner: event.target.value })}
              required
              placeholder={t('pullRequestsPanel.githubUsername')}
            />
          </label>
          <label className="field">
            <span>{t('pullRequestsPanel.sourceVersion')}</span>
            <input
              value={draft.sourceBranch}
              onChange={(event) => onDraftChange({ sourceBranch: event.target.value })}
              required
              placeholder={t('pullRequestsPanel.forExampleFixSearch')}
            />
          </label>
        </div>
        <label className="field">
          <span>{t('pullRequestsPanel.mergeInto')}</span>
          <input
            value={draft.base}
            onChange={(event) => onDraftChange({ base: event.target.value })}
            required
            placeholder={repo.default_branch}
          />
        </label>
        <p className="muted">{t('pullRequestsPanel.theSourceMustAlreadyExistOnGithubForSomeone')}</p>
        {error && (
          <p className="live-error" role="alert">
            <ErrorMessage error={error} language={language} />
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button button-quiet" disabled={saving} onClick={onClose}>
            {t('pullRequestsPanel.cancel')}
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={saving || !draft.title.trim() || !draft.sourceBranch.trim()}
          >
            {t('pullRequestsPanel.createPullRequest2')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PullDecisionDialog({
  repo,
  language,
  selected,
  decision,
  reason,
  onReasonChange,
  busy,
  onClose,
  onConfirm,
}: {
  repo: GitHubRepo;
  language: Language;
  selected: GitHubPullRequest;
  decision: PullDecision;
  reason: string;
  onReasonChange: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslation(language);
  const dialog = useRef<HTMLFormElement>(null);
  useDialogFocus(true, dialog, () => {
    if (!busy) onClose();
  });
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal pull-decision-modal"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-decision-title"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <button
          type="button"
          className="icon-button modal-close"
          aria-label={t('pullRequestsPanel.close')}
          disabled={busy}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <h2 id="pull-decision-title">
          {decision === 'accept'
            ? t('pullRequestsPanel.approveAndMergeTheseChanges')
            : t('pullRequestsPanel.rejectAndCloseThisRequest')}
        </h2>
        <p className="pull-confirm-title" data-content-original>
          {selected.title}
        </p>
        <dl className="ai-consent-service">
          <div>
            <dt>{t('pullRequestsPanel.targetVersion')}</dt>
            <dd data-content-original>
              {repo.full_name} / {selected.base.ref}
            </dd>
          </div>
        </dl>
        <p>
          {decision === 'accept'
            ? t('pullRequestsPanel.theseChangesWillBeSavedToYourProjectOn')
            : t('pullRequestsPanel.thisPullRequestWillBeClosedAnyReasonYou')}
        </p>
        {decision === 'reject' && (
          <label className="field">
            <span>{t('pullRequestsPanel.reasonForRejectionOptional')}</span>
            <textarea
              rows={4}
              maxLength={65536}
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              disabled={busy}
              placeholder={t('pullRequestsPanel.explainWhyYouAreNotAcceptingTheseChanges')}
            />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="button button-quiet" disabled={busy} onClick={onClose}>
            {t('pullRequestsPanel.cancel')}
          </button>
          <button
            type="submit"
            className={`button ${decision === 'accept' ? 'button-primary' : 'danger-confirm'}`}
            disabled={busy}
          >
            {busy && <RotateCw size={16} className="live-spin" />}
            {decision === 'accept'
              ? t('pullRequestsPanel.confirmApprovalAndMerge')
              : t('pullRequestsPanel.confirmRejectionAndClose')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PullAiConsentDialog({
  repo,
  language,
  aiSettings,
  hasProgramFiles,
  programComponentsMissing,
  onClose,
  onStart,
}: {
  repo: GitHubRepo;
  language: Language;
  aiSettings: AiSettingsStatus;
  hasProgramFiles: boolean;
  programComponentsMissing: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  const t = useTranslation(language);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(true, dialog, onClose);
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal ai-consent-modal"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-consent-title"
      >
        <button
          type="button"
          className="icon-button modal-close"
          aria-label={t('pullRequestsPanel.close')}
          onClick={onClose}
        >
          <X size={19} />
        </button>
        <div className="modal-symbol">
          <Sparkles size={25} />
        </div>
        <h2 id="ai-consent-title">{t('pullRequestsPanel.useAiToReviewTheseChanges')}</h2>
        <p>{t('pullRequestsPanel.theTitleDescriptionFileNamesAndChangesWillBe')}</p>
        {hasProgramFiles && (
          <p>
            {programComponentsMissing
              ? t('pullRequestsPanel.programFilesCannotBeReviewedYetAvailableSourceChanges')
              : t('pullRequestsPanel.programContentIsExtractedLocallyAndIncludedInThis')}
          </p>
        )}
        <dl className="ai-consent-service">
          <div>
            <dt>{t('pullRequestsPanel.serviceAddress')}</dt>
            <dd data-content-original>{aiSettings.baseUrl}</dd>
          </div>
          <div>
            <dt>{t('pullRequestsPanel.modelName')}</dt>
            <dd data-content-original>{aiSettings.model}</dd>
          </div>
          <div>
            <dt>{t('pullRequestsPanel.project')}</dt>
            <dd data-content-original>{repo.full_name}</dd>
          </div>
        </dl>
        {repo.private && (
          <p className="ai-private-notice">{t('pullRequestsPanel.thisProjectIsPrivateConfirmThatYouWantTo')}</p>
        )}
        <p>{t('pullRequestsPanel.yourProviderMayChargeForThisRequestTheReview')}</p>
        <div className="modal-actions">
          <button className="button button-quiet" onClick={onClose}>
            {t('pullRequestsPanel.cancel')}
          </button>
          <button className="button button-primary" onClick={onStart}>
            <Sparkles size={16} />
            {t('pullRequestsPanel.agreeAndStartReview')}
          </button>
        </div>
      </div>
    </div>
  );
}
