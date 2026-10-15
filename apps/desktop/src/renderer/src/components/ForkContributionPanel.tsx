import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { GitHubForkComparison, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { ArrowRight, ExternalLink, GitFork, RotateCw } from 'lucide-react';

export function ForkContributionPanel({
  repo,
  localLinkId,
  suggestedTitle,
  onOpenLocal,
  onBrowseOriginal,
  onOpenExternal,
}: {
  repo: GitHubRepo;
  localLinkId?: string;
  suggestedTitle: string;
  onOpenLocal: () => void;
  onBrowseOriginal: (owner: string, name: string) => void;
  onOpenExternal: (url: string) => void;
}) {
  const t = useTranslation();
  const easyHub = useEasyHub();
  const [detail, setDetail] = useState<GitHubRepo | null>(repo.parent ? repo : null);
  const [comparison, setComparison] = useState<GitHubForkComparison | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [created, setCreated] = useState<GitHubPullRequest | null>(null);
  const [pendingLocalFiles, setPendingLocalFiles] = useState(0);

  async function refresh(): Promise<void> {
    setChecking(true);
    setError('');
    try {
      const fork = await easyHub!.github<GitHubRepo>('repository', repo.owner.login, repo.name);
      if (!fork.fork || !fork.parent)
        throw new Error(t('forkContributionPanel.cannotFindTheOriginalProjectForThisCopy'));
      setDetail(fork);
      const [difference, local] = await Promise.all([
        easyHub!.github<GitHubForkComparison>('forkComparison', repo.owner.login, repo.name),
        localLinkId ? easyHub!.localStatus(localLinkId) : Promise.resolve(null),
      ]);
      setComparison(difference);
      setPendingLocalFiles(local?.files.length ?? 0);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [repo.id, repo.owner.login, repo.name, localLinkId]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !comparison?.ahead_by || saving) return;
    setSaving(true);
    setError('');
    try {
      if (localLinkId) {
        const local = await easyHub!.localStatus(localLinkId);
        if (local.files.length > 0) {
          setPendingLocalFiles(local.files.length);
          throw new Error(t('forkContributionPanel.thereAreUnpublishedLocalChangesPublishTheSourceFirst'));
        }
      }
      const result = await easyHub!.github<GitHubPullRequest>(
        'submitForkContribution',
        repo.owner.login,
        repo.name,
        title.trim(),
        body.trim(),
      );
      setCreated(result);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  const parent = detail?.parent;
  const activeRequest = created ?? comparison?.openRequest;
  return (
    <section className="panel fork-contribution" data-testid="fork-contribution">
      <div className="panel-heading">
        <div>
          <h2>
            <GitFork size={19} />
            {t('forkContributionPanel.repositoryCopies')}
          </h2>
          <p className="muted">{t('forkContributionPanel.prepareChangesHereThenSendThemToTheOriginal')}</p>
        </div>
      </div>
      {parent && (
        <>
          <div className="fork-relationship">
            <span>
              <small>{t('forkContributionPanel.originalProject')}</small>
              <button className="plain-heading" onClick={() => onBrowseOriginal(parent.owner.login, parent.name)}>
                {parent.full_name}
              </button>
              <button
                className="fork-link"
                onClick={() => onOpenExternal(parent.html_url)}
                aria-label={t('forkContributionPanel.openOriginalProjectOnGithub')}
              >
                <ExternalLink size={14} />
              </button>
            </span>
            <ArrowRight size={18} />
            <span>
              <small>{t('forkContributionPanel.yourCopy')}</small>
              <strong>{detail.full_name}</strong>
              <button
                className="fork-link"
                onClick={() => onOpenExternal(detail.html_url || `https://github.com/${detail.full_name}`)}
                aria-label={t('forkContributionPanel.openRepositoryCopyOnGithub')}
              >
                <ExternalLink size={14} />
              </button>
            </span>
          </div>
          <p className="fork-branch-line">
            {t('forkContributionPanel.branchRelationshipOriginalProject')} {parent.default_branch}{' '}
            {t('forkContributionPanel.repositoryCopy')} {detail.default_branch}
          </p>
        </>
      )}
      {checking ? (
        <p className="live-loading">
          <RotateCw size={16} className="live-spin" />
          {t('forkContributionPanel.comparingTheTwoProjects')}
        </p>
      ) : comparison ? (
        <>
          <div className="fork-change-summary">
            <strong>{t('fork.updates', { count: comparison.ahead_by })}</strong>
            <span>{t('fork.files', { count: comparison.files?.length ?? 0 })}</span>
            <button className="text-link" disabled={saving} onClick={() => void refresh()}>
              {t('forkContributionPanel.refresh')}
            </button>
          </div>
          {comparison.files?.slice(0, 8).map((file) => (
            <div className="live-file" key={file.filename}>
              {file.filename}
              <small>
                +{file.additions} / −{file.deletions}
              </small>
            </div>
          ))}
          {pendingLocalFiles > 0 ? (
            <p className="live-error">{t('fork.pending', { count: pendingLocalFiles })}</p>
          ) : comparison.ahead_by === 0 ? (
            <p className="muted">{t('forkContributionPanel.thereAreNoChangesToProposeYetDownloadYour')}</p>
          ) : activeRequest ? (
            <div className="public-proposal-notice">
              {created
                ? t('forkContributionPanel.pullRequestSubmitted')
                : t('forkContributionPanel.aPullRequestFromThisCopyIsAwaitingReview')}
              <button className="text-link" onClick={() => onOpenExternal(activeRequest.html_url)}>
                {t('forkContributionPanel.viewOnGithub')} <ExternalLink size={15} />
              </button>
            </div>
          ) : (
            <form className="fork-submit-form" onSubmit={(event) => void submit(event)}>
              <label className="field">
                <span>{t('forkContributionPanel.changeTitle')}</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={256}
                  required
                  placeholder={suggestedTitle || t('forkContributionPanel.brieflyDescribeYourChanges')}
                />
              </label>
              <label className="field">
                <span>{t('forkContributionPanel.details')}</span>
                <textarea
                  rows={4}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={65536}
                  placeholder={t('forkContributionPanel.describeWhyAndHowTheChangeHelps')}
                />
              </label>
              <button type="submit" className="button button-primary" disabled={saving || !title.trim()}>
                {saving
                  ? t('forkContributionPanel.submitting')
                  : t('forkContributionPanel.submitPullRequestToOriginal')}{' '}
                <ArrowRight size={16} />
              </button>
            </form>
          )}
        </>
      ) : null}
      <button className="button button-quiet" onClick={onOpenLocal}>
        {t('forkContributionPanel.downloadOrOpenLocalCopy')} <ArrowRight size={16} />
      </button>
      {error && (
        <p className="live-error" role="alert">
          <ErrorMessage error={error} />
        </p>
      )}
    </section>
  );
}
