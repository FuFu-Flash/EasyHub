import { ArrowRight } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import type { GitHubComment, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { formatDateTime } from '../format';
import { useTranslation } from '../localization';
import type { Language } from '../i18n';
import { PagedContinuation } from './PagedContinuation';
import { TranslatableContent } from './TranslatableContent';

/** Description, replies and the reply box of one pull request. */
export function PullRequestConversation({
  repo,
  language,
  selected,
  comments,
  busy,
  pagingKey,
  renderMarkdown,
  onMoreComments,
  reply,
  onReplyChange,
  replySaving,
  onSendReply,
}: {
  repo: GitHubRepo;
  language: Language;
  selected: GitHubPullRequest;
  comments: GitHubComment[];
  busy: boolean;
  pagingKey: string;
  renderMarkdown: (value: string) => ReactNode;
  onMoreComments: (items: GitHubComment[]) => void;
  reply: string;
  onReplyChange: (value: string) => void;
  replySaving: boolean;
  onSendReply: (event: FormEvent) => void;
}) {
  const t = useTranslation(language);
  return (
    <>
      <div className="conversation">
        <div className="message">
          <div className="avatar author-avatar">{(selected.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
          <div className="message-box">
            <div>
              <strong>{selected.user?.login || t('pullRequestsPanel.githubUser')}</strong>
              <small>{formatDateTime(selected.created_at, language)}</small>
            </div>
            {selected.body ? (
              repo.private ? (
                renderMarkdown(selected.body)
              ) : (
                <TranslatableContent text={selected.body} format="markdown" paragraphMode render={renderMarkdown} />
              )
            ) : (
              <p className="muted">{t('pullRequestsPanel.noDetailsProvided')}</p>
            )}
          </div>
        </div>
        {comments.map((comment) => (
          <div className="message" key={comment.id}>
            <div className="avatar">{(comment.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
            <div className="message-box">
              <div>
                <strong>{comment.user?.login || t('pullRequestsPanel.githubUser')}</strong>
                <small>{formatDateTime(comment.created_at, language)}</small>
              </div>
              {repo.private ? (
                renderMarkdown(comment.body)
              ) : (
                <TranslatableContent text={comment.body} format="markdown" paragraphMode render={renderMarkdown} />
              )}
            </div>
          </div>
        ))}
      </div>
      {!busy && (
        <PagedContinuation<GitHubComment>
          key={pagingKey}
          action="commentsPage"
          args={[repo.owner.login, repo.name, selected.number]}
          firstCount={comments.length}
          language={language}
          label={t('pullRequestsPanel.loadMoreReplies')}
          onItems={onMoreComments}
        />
      )}
      <form className="reply-card" onSubmit={onSendReply}>
        <label htmlFor="pull-reply">{t('pullRequestsPanel.writeAReply')}</label>
        <textarea
          id="pull-reply"
          rows={4}
          maxLength={65536}
          value={reply}
          onChange={(event) => onReplyChange(event.target.value)}
          placeholder={t('pullRequestsPanel.shareYourThoughtsOrSuggestions')}
        />
        <div>
          <span />
          <button className="button button-primary" disabled={replySaving || busy || !reply.trim()} type="submit">
            {t('pullRequestsPanel.sendReply')}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </>
  );
}
