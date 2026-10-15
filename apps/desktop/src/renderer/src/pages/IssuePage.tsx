import { useTranslation } from '../localization';
import type { GitHubComment, GitHubIssue, GitHubIssuePage } from '@easyhub/github';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import { PagedContinuation } from '../components/PagedContinuation';
import { ReadmeMarkdown } from '../components/ReadmeMarkdown';
import { TranslatableContent, TranslationPreferencesContext } from '../components/TranslatableContent';
import { createDraftKey } from '../draftStore';
import { errorText as message } from '../errors';
import { formatDateTime, formatRelative } from '../format';
import { useLocalDraft } from '../useLocalDraft';
import { useReadingWindow } from '../workspace/pageData';
import { usePageFeedback } from '../workspace/pageFeedback';
import { readPageWindow } from '../workspace/pageWindow';

import { usePageRoute } from '../workspace/NavigationContext';
import { useWorkspace } from '../workspace/WorkspaceContext';
import { usePageActions } from '../workspace/pageActions';
import { usePageData, useRepository } from '../workspace/pageData';
import { ownerOf, PageStatus } from './shared';

export function IssuePage() {
  const t = useTranslation();

  const w = useWorkspace();
  const { setNotice, setError } = usePageFeedback();
  const {
    user,
    language,
    automaticTranslation,
    translationTarget,
    translationNames,
    api,
    refreshActivityCount,
    navigation,
  } = w;
  const { params } = usePageRoute();
  const { openReadmeLink } = usePageActions();
  const date = (value: string) => formatDateTime(value, language);
  const relativeDate = formatRelative;

  const selected = useRepository();
  const issueKey = 'issue:' + params.repo + ':' + params.number;
  const window = useReadingWindow();
  const initialIssue = (w.cache.get(issueKey) as GitHubIssue | undefined) ?? null;
  const result = usePageData<{ issue: GitHubIssue | null; comments: GitHubComment[]; nextPage?: number | null }>(
    'conversation:' + issueKey,
    async () => {
      if (!selected) return { issue: null, comments: [] };
      const [list, comments] = await Promise.all([
        api<GitHubIssuePage>('issuesPage', ownerOf(selected), selected.name, 'all', 1),
        readPageWindow(
          async () => {
            const items = await api<GitHubComment[]>('comments', ownerOf(selected), selected.name, params.number);
            return { items, nextPage: items.length >= 100 ? 2 : null };
          },
          (page) =>
            api<{ items: GitHubComment[]; nextPage: number | null }>(
              'commentsPage',
              ownerOf(selected),
              selected.name,
              params.number,
              page,
            ),
          window.pages.current,
          (item) => item.id,
        ),
      ]);
      return {
        issue: list.items.find((item) => item.number === params.number) ?? initialIssue,
        comments: comments.items,
        nextPage: comments.nextPage,
      };
    },
    { issue: initialIssue, comments: [] },
  );
  const issue = result.data.issue,
    comments = result.data.comments,
    issueReadBusy = result.loading;
  const [busy, setBusy] = useState(false);
  const refreshing = result.loading;
  const submitting = useRef(false);
  const issueLoad = useRef(0);
  const replyKey = createDraftKey(user.login, params.repo ?? '', 'reply', params.number ?? 'none');
  const [reply, setReply, clearReply] = useLocalDraft(replyKey);
  const issueAuthorNames = [issue?.user?.login, ...comments.map((item) => item.user?.login)].filter(
    (name): name is string => Boolean(name),
  );
  const setComments = (next: React.SetStateAction<GitHubComment[]>) =>
    result.setData((old) => ({ ...old, comments: typeof next === 'function' ? next(old.comments) : next }));
  const renderIssueMarkdown = (content: string) =>
    selected ? (
      <ReadmeMarkdown
        markdown={content}
        repository={{ owner: ownerOf(selected), name: selected.name, branch: selected.default_branch }}
        onOpenLink={(url) => void openReadmeLink(url, selected)}
      />
    ) : null;
  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!selected || !issue || !reply.trim() || result.loading || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    const sent = reply;
    try {
      const comment = await api<GitHubComment>(
        'createComment',
        ownerOf(selected),
        selected.name,
        issue.number,
        sent.trim(),
      );
      clearReply(sent);
      setComments((old) => [...old, comment]);
      setNotice(t('issuePage.replySent'));
    } catch (cause) {
      setError(message(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function changeIssueState() {
    if (!selected || !issue || result.loading || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const next = await api<GitHubIssue>(
        'updateIssue',
        ownerOf(selected),
        selected.name,
        issue.number,
        issue.state === 'open' ? 'closed' : 'open',
      );
      result.setData((old) => ({ ...old, issue: next }));
      w.cache.set(issueKey, next);
      void refreshActivityCount(selected);
      setNotice(next.state === 'closed' ? t('issuePage.issueMarkedAsResolved') : t('issuePage.issueReopened'));
    } catch (cause) {
      setError(message(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (!selected || !issue)
    return <PageStatus loading={issueReadBusy} error={result.error} retry={result.reload} cancel={result.cancel} />;

  return (
    <>
      <PageStatus
        loading={issueReadBusy && !comments.length}
        error={result.error}
        retry={result.reload}
        cancel={result.cancel}
      />
      <TranslationPreferencesContext.Provider
        value={{
          automatic: automaticTranslation,
          target: translationTarget,
          repository: { name: selected.name, owner: selected.owner.login, fullName: selected.full_name },
          names: translationNames,
        }}
      >
        <button className="back-link" onClick={() => navigation.back()}>
          <ArrowLeft size={17} />
          {t('issuePage.backToIssues')}
        </button>
        <div className="issue-detail">
          <div className="issue-title">
            <span className={`issue-state ${issue.state === 'closed' ? 'closed' : ''}`}>
              {issue.state === 'open' ? t('issuePage.open') : t('issuePage.resolved')}
            </span>
            {selected.private ? (
              <h1>{issue.title}</h1>
            ) : (
              <TranslatableContent
                text={issue.title}
                format="text"
                protectedNames={issueAuthorNames}
                render={(value) => <h1>{value}</h1>}
              />
            )}
            <p>
              {selected.name} · {issue.user?.login || t('issuePage.githubUser')} {t('issuePage.openedOn')}{' '}
              {date(issue.created_at)}
            </p>
          </div>
          <div className="conversation">
            <div className="message">
              <div className="avatar author-avatar">{(issue.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
              <div className="message-box">
                <div>
                  <strong>{issue.user?.login || t('issuePage.githubUser')}</strong>
                  <small>{relativeDate(issue.created_at, language)}</small>
                </div>
                {!selected.private && issue.body ? (
                  <TranslatableContent
                    text={issue.body}
                    format="markdown"
                    paragraphMode
                    protectedNames={issueAuthorNames}
                    render={(value) => renderIssueMarkdown(value)}
                  />
                ) : (
                  renderIssueMarkdown(issue.body || t('issuePage.noDetailsProvided'))
                )}
              </div>
            </div>
            {comments.map((item) => (
              <div className="message" key={item.id}>
                <div className="avatar">{(item.user?.login || 'G').slice(0, 1).toUpperCase()}</div>
                <div className="message-box">
                  <div>
                    <strong>{item.user?.login || t('issuePage.githubUser')}</strong>
                    <small>{relativeDate(item.created_at, language)}</small>
                  </div>
                  {selected.private ? (
                    renderIssueMarkdown(item.body)
                  ) : (
                    <TranslatableContent
                      text={item.body}
                      format="markdown"
                      paragraphMode
                      protectedNames={issueAuthorNames}
                      render={(value) => renderIssueMarkdown(value)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
          {!issueReadBusy && (
            <PagedContinuation<GitHubComment>
              key={`${replyKey}:${issueLoad.current}`}
              action="commentsPage"
              args={[ownerOf(selected), selected.name, issue.number]}
              firstCount={comments.length}
              language={language}
              label={t('issuePage.loadMoreReplies')}
              initialNextPage={result.data.nextPage}
              onItems={(items, nextPage) => {
                window.pages.current++;
                result.setData((old) => ({
                  ...old,
                  nextPage,
                  comments: [
                    ...old.comments,
                    ...items.filter((item) => !old.comments.some((known) => known.id === item.id)),
                  ].sort((a, b) => a.id - b.id),
                }));
              }}
            />
          )}
          <form className="reply-card" onSubmit={(event) => void sendReply(event)}>
            <label htmlFor="live-reply">{t('issuePage.writeAReply')}</label>
            <textarea
              id="live-reply"
              rows={4}
              maxLength={65536}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder={t('issuePage.shareYourThoughtsOrAnUpdate')}
            />
            <div>
              <button
                type="button"
                className="button button-quiet"
                disabled={busy || refreshing}
                onClick={() => void changeIssueState()}
              >
                {issue.state === 'open' ? t('issuePage.markAsResolved') : t('issuePage.reopen')}
              </button>
              <button
                className="button button-primary"
                disabled={busy || issueReadBusy || refreshing || !reply.trim()}
                type="submit"
              >
                {t('issuePage.sendReply')} <ArrowRight size={16} />
              </button>
            </div>
          </form>
        </div>
      </TranslationPreferencesContext.Provider>
    </>
  );
}
