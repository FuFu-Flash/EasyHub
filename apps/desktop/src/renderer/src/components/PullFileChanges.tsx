import { useTranslation } from '../localization';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { isEmptyAddedPullFile } from '@easyhub/github';
import type { GitHubPullFile } from '@easyhub/github';
import { parsePullPatch } from './pullReviewPresentation';
import { CodeExplanation } from './CodeExplanation';
import type { Language } from '../i18n';

export function PullFileChanges({
  file,
  owner,
  repo,
  number,
  headSha,
  language,
  downloadControl,
  onOpenLink,
}: {
  file: GitHubPullFile;
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  language: Language;
  downloadControl: ReactNode;
  onOpenLink: (url: string) => void;
}) {
  const t = useTranslation(language);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(200);
  const parsed = useMemo(() => (open && file.patch ? parsePullPatch(file) : null), [open, file]);

  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pull/${number}/files`;
  const status =
    file.status === 'added'
      ? t('pullFileChanges.added')
      : file.status === 'removed'
        ? t('pullFileChanges.deleted')
        : file.status === 'renamed'
          ? t('pullFileChanges.renamed')
          : t('pullFileChanges.modified');
  return (
    <article className="pull-file-change">
      <div className="live-file pull-download-row">
        <button
          type="button"
          className="pull-file-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={16} className={open ? 'expanded' : ''} />
          <span className="pull-file-name" data-content-original>
            {file.filename}
          </span>
          <span className="pull-file-status">{status}</span>
        </button>
        <small>
          {isEmptyAddedPullFile(file) ? t('pullFileChanges.newEmptyFile') : `+${file.additions} / −${file.deletions}`}
        </small>
        {downloadControl}
      </div>
      {open && (
        <div className="pull-file-preview">
          {file.previous_filename && (
            <p className="pull-file-rename" data-content-original>
              {file.previous_filename} → {file.filename}
            </p>
          )}
          {parsed ? (
            <>
              <div className="pull-diff-key">
                <span>{t('pullFileChanges.redLinesWereRemovedGreenLinesWereAddedLine')}</span>
              </div>
              {parsed.incomplete && (
                <p className="pull-review-note" role="status">
                  {parsed.limited
                    ? t('pullFileChanges.thisLongChangeIsPartiallyDisplayedOpenGithubTo')
                    : t('pullFileChanges.githubReturnedAnIncompleteTextChangeOpenGithubTo')}
                </p>
              )}
              <CodeExplanation
                source={{ kind: 'pull', owner, repo, number, headSha, path: file.filename }}
                language={language}
              >
                <div
                  className="pull-diff-scroll"
                  data-code-selection-region
                  tabIndex={0}
                  aria-label={t('pullFileChanges.lineByLineChanges')}
                >
                  <table className="pull-diff-table" data-content-original>
                    <tbody>
                      {parsed.lines.slice(0, visible).map((line, index) => (
                        <tr key={index} className={`pull-diff-${line.kind}`}>
                          <td className="pull-line-number">{line.before}</td>
                          <td className="pull-line-number">{line.after}</td>
                          <td className="pull-line-sign">
                            {line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}
                          </td>
                          <td className="pull-line-code">
                            <code
                              data-explain-code={
                                line.kind === 'add' || line.kind === 'remove' || line.kind === 'context'
                                  ? true
                                  : undefined
                              }
                            >
                              {line.text}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CodeExplanation>
              {visible < parsed.lines.length && (
                <button className="text-link pull-diff-more" onClick={() => setVisible((count) => count + 200)}>
                  {t('pullFileChanges.showMoreChangedLines')}
                </button>
              )}
            </>
          ) : (
            <p className="pull-review-note">
              {isEmptyAddedPullFile(file)
                ? t('pullFileChanges.thisIsANewEmptyFileWithNoText')
                : file.status === 'renamed' && file.additions === 0 && file.deletions === 0
                  ? t('pullFileChanges.theFileWasRenamedGithubDidNotProvideA')
                  : t('pullFileChanges.githubDidNotProvideATextChangeForThis')}
            </p>
          )}
          <button className="text-link pull-diff-more" onClick={() => onOpenLink(url)}>
            <ExternalLink size={14} />
            {t('pullFileChanges.viewFullChangesOnGithub')}
          </button>
        </div>
      )}
    </article>
  );
}
