import { ArrowRight } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import type { GitHubComment, GitHubIssue, GitHubRepo } from '@easyhub/github';
import { formatDateTime } from '../format';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { TranslatableContent } from './TranslatableContent';

/** Issue description, replies and the reply box on a public project page. */
export function PublicIssueConversation({
  repo,
  language,
  issue,
  comments,
  protectedNames,
  reply,
  onReplyChange,
  onReply,
  replySaving,
  onOpenLink,
  pagination,
}: {
  repo: GitHubRepo;
  language: Language;
  issue: GitHubIssue;
  comments: GitHubComment[];
  protectedNames: string[];
  reply: string;
  onReplyChange: (value: string) => void;
  onReply: (event: FormEvent) => void;
  replySaving: boolean;
  onOpenLink: (url: string) => void;
  pagination: ReactNode;
}) {
  const t = useTranslation(language);
  const markdown = (value: string) => (
    <ReadmeMarkdown
      markdown={value}
      repository={{ owner: repo.owner.login, name: repo.name, branch: repo.default_branch }}
      onOpenLink={onOpenLink}
    />
  );
  return (
    <div className="issue-detail public-issue-detail">
      <div className="issue-title">
        <span className={`issue-state ${issue.state === 'closed' ? 'closed' : ''}`}>
          {issue.state === 'open' ? t('publicProjectBrowser.open') : t('publicProjectBrowser.resolved')}
        </span>
        <TranslatableContent
          text={issue.title}
          format="text"
          protectedNames={protectedNames}
          render={(value) => <h1>{value}</h1>}
        />
        <p>
          {repo.name} · {issue.user?.login || t('publicProjectBrowser.githubUser')} {t('publicProjectBrowser.openedOn')}{' '}
          {formatDateTime(issue.created_at, language)}
        </p>
      </div>
      <div className="conversation">
        <div className="message">
          <div className="avatar author-avatar">{(issue.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
          <div className="message-box">
            <div>
              <strong>{issue.user?.login || t('publicProjectBrowser.githubUser')}</strong>
              <small>{formatDateTime(issue.created_at, language)}</small>
            </div>
            {issue.body ? (
              <TranslatableContent
                text={issue.body}
                format="markdown"
                paragraphMode
                protectedNames={protectedNames}
                render={markdown}
              />
            ) : (
              markdown(t('publicProjectBrowser.noDetailsProvided'))
            )}
          </div>
        </div>
        {comments.map((item) => (
          <div className="message" key={item.id}>
            <div className="avatar">{(item.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
            <div className="message-box">
              <div>
                <strong>{item.user?.login || t('publicProjectBrowser.githubUser')}</strong>
                <small>{formatDateTime(item.created_at, language)}</small>
              </div>
              <TranslatableContent
                text={item.body}
                format="markdown"
                paragraphMode
                protectedNames={protectedNames}
                render={markdown}
              />
            </div>
          </div>
        ))}
      </div>
      {pagination}
      <form className="reply-card" onSubmit={onReply}>
        <label htmlFor="public-issue-reply">{t('publicProjectBrowser.writeAReply')}</label>
        <textarea
          id="public-issue-reply"
          rows={4}
          value={reply}
          onChange={(event) => onReplyChange(event.target.value)}
          placeholder={t('publicProjectBrowser.shareYourThoughtsOrSuggestions')}
        />
        <div>
          <span />
          <button className="button button-primary" disabled={replySaving || !reply.trim()} type="submit">
            {t('publicProjectBrowser.sendReply')} <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
