import { ArrowDownToLine, ArrowLeft, ArrowRight, Clock3 } from 'lucide-react';
import type { GitHubCommit, GitHubRepo } from '@easyhub/github';
import { formatDateTime } from '../format';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { ErrorMessage } from './ErrorMessage';
import { PagedContinuation } from './PagedContinuation';
import type { DownloadRequest } from './useDownloadCenter';

/** Change history tab of a public project: the commit list or one commit with its download. */
export function PublicHistoryTab({
  repo,
  language,
  commits,
  selectedCommit,
  busy,
  historyError,
  downloadBusy,
  onBackToList,
  onOpenCommit,
  onMoreCommits,
  onDownload,
}: {
  repo: GitHubRepo;
  language: Language;
  commits: GitHubCommit[];
  selectedCommit: GitHubCommit | null;
  busy: boolean;
  historyError: string;
  downloadBusy: boolean;
  onBackToList: () => void;
  onOpenCommit: (commit: GitHubCommit) => void;
  onMoreCommits: (items: GitHubCommit[]) => void;
  onDownload: (request: DownloadRequest) => void;
}) {
  const t = useTranslation(language);
  if (selectedCommit)
    return (
      <>
        <button className="back-link" onClick={onBackToList}>
          <ArrowLeft size={16} />
          {t('publicProjectBrowser.backToChangeHistory')}
        </button>
        <h2>{selectedCommit.commit.message.split('\n')[0]}</h2>
        <p className="muted">
          {selectedCommit.commit.author?.name || t('publicProjectBrowser.unknownAuthor')} ·{' '}
          {selectedCommit.commit.author?.date ? formatDateTime(selectedCommit.commit.author.date, language) : ''}
        </p>
        <p className="muted">
          {t('publicProjectBrowser.filesChanged')}
          {selectedCommit.files?.length ?? '—'} {t('publicProjectBrowser.added')}{' '}
          {selectedCommit.stats?.additions ?? '—'} {t('publicProjectBrowser.linesRemoved')}{' '}
          {selectedCommit.stats?.deletions ?? '—'} {t('publicProjectBrowser.lines')}
        </p>
        {selectedCommit.files?.map((file) => (
          <div className="live-file" key={file.filename}>
            {file.filename}
          </div>
        ))}
        <button
          className="button button-primary version-download"
          disabled={downloadBusy}
          onClick={() =>
            onDownload({
              kind: 'archive',
              repo,
              ref: selectedCommit.sha,
              fileName: `${repo.name}-${selectedCommit.sha.slice(0, 8)}.zip`,
              offerAdd: true,
            })
          }
        >
          <ArrowDownToLine size={18} />
          {t('publicProjectBrowser.downloadFilesAtThisPoint')}
        </button>
      </>
    );
  return (
    <>
      <h2 className="visually-hidden">{t('publicProjectBrowser.changeHistory')}</h2>
      {historyError && (
        <p className="live-error" role="alert">
          <ErrorMessage error={historyError} language={language} />
        </p>
      )}
      {commits.map((item) => (
        <button className="public-list-row" key={item.sha} onClick={() => onOpenCommit(item)}>
          <Clock3 size={19} />
          <span>
            <strong>{item.commit.message.split('\n')[0]}</strong>
            <small>{item.commit.author?.date ? formatDateTime(item.commit.author.date, language) : ''}</small>
          </span>
          <ArrowRight size={17} />
        </button>
      ))}
      {commits.length === 0 && !busy && !historyError && (
        <p className="muted">{t('publicProjectBrowser.noChangeHistoryYet')}</p>
      )}
      {!busy && !historyError && (
        <PagedContinuation<GitHubCommit>
          key={repo.id}
          action="commitsPage"
          args={[repo.owner.login, repo.name]}
          firstCount={commits.length}
          language={language}
          onItems={onMoreCommits}
        />
      )}
    </>
  );
}
