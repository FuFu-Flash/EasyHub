import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { useNestedNavigation } from '../nestedNavigation';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { SegmentedControl } from './SegmentedControl';
import { createDraftKey } from '../draftStore';
import { useLocalDraft } from '../useLocalDraft';
import { usePageHistory } from '../usePageHistory';
import { usePageScroll } from '../usePageScroll';
import { NavigationPages } from './NavigationPages';
import { PagedContinuation } from './PagedContinuation';
import { useDiscussionSearchState } from './DiscussionSearch';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode, RefObject } from 'react';
import type {
  GitHubActivityCount,
  GitHubComment,
  GitHubCommit,
  GitHubIssue,
  GitHubIssuePage,
  GitHubRepo,
} from '@easyhub/github';
import { ArrowLeft, RotateCw } from 'lucide-react';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { ReleaseDownloads } from './ReleaseDownloads';
import { PullRequestsPanel } from './PullRequestsPanel';
import { readmeReleaseLink } from './readmeReleaseLink';
import { TranslatableContent } from './TranslatableContent';
import { SourceHistory } from './SourceHistory';
import type { DownloadRequest } from './useDownloadCenter';
import type { Language } from '../i18n';
import { PublicIssueConversation } from './PublicIssueConversation';
import { PublicProjectHero } from './PublicProjectHero';
import { PublicIssuesTab, type PublicIssueFilter } from './PublicIssuesTab';
import { PublicHistoryTab } from './PublicHistoryTab';
import { PublicProposalDialog, type ProposalType } from './PublicProposalDialog';

type Tab = 'intro' | 'issues' | 'pulls' | 'history' | 'source-history' | 'downloads';

export function PublicProjectBrowser({
  repo,
  language,
  currentUser,
  onBack,
  backToSearchResults = false,
  onOpenLink,
  onDownload,
  onForkReady,
  onOpenAiSettings,
  downloadBusy,
  startInDownloads = false,
  initialFocusTag,
  scrollArea: parentScrollArea,
  outerBackBoundary,
  onPageChange,
}: {
  repo: GitHubRepo;
  language: Language;
  currentUser: string;
  onBack: () => void;
  /** The page behind this one lists search results. */
  backToSearchResults?: boolean;
  onOpenLink: (url: string) => void;
  onDownload: (request: DownloadRequest) => void;
  onForkReady: (fork: GitHubRepo) => void;
  onOpenAiSettings?: () => void;
  downloadBusy: boolean;
  startInDownloads?: boolean;
  initialFocusTag?: string;
  scrollArea?: RefObject<HTMLDivElement | null>;
  outerBackBoundary?: string | null;
  onPageChange?: (key: string) => void;
}) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [tab, setTab] = useState<Tab>(startInDownloads ? 'downloads' : 'intro');
  const [focusTag, setFocusTag] = useState<string | undefined>(initialFocusTag);
  const [readme, setReadme] = useState('');
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [activityCounts, setActivityCounts] = useState<GitHubActivityCount | null>(null);
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  const [issueFilter, setIssueFilter] = useState<PublicIssueFilter>('open');
  const [nextIssuePage, setNextIssuePage] = useState<number | null>(null);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<GitHubCommit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issueError, setIssueError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalType, setProposalType] = useState<ProposalType>('issue');
  const [proposalError, setProposalError] = useState('');
  const [proposalNotice, setProposalNotice] = useState('');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [issueSaving, setIssueSaving] = useState(false);
  const replyKey = createDraftKey(currentUser, repo.full_name, 'reply', selectedIssue?.number ?? 'none');
  const [reply, setReply, clearReply] = useLocalDraft(replyKey);
  const [issueSearch, changeIssueSearch] = useDiscussionSearchState(
    currentUser,
    `public:${repo.id}:${repo.full_name}:issue`,
  );
  const [replySaving, setReplySaving] = useState(false);
  const detailRequest = useRef(0);
  const issueListRequest = useRef(0);
  const owner = repo.owner.login;
  const issueAuthorNames = [selectedIssue?.user?.login, ...comments.map((item) => item.user?.login)].filter(
    (name): name is string => Boolean(name),
  );
  const browserRef = useRef<HTMLDivElement>(null);
  const pullBack = useRef<(() => void) | null>(null);
  const [pullPage, setPullPage] = useState('list');
  const [pullBackBlocked, setPullBackBlocked] = useState(false);
  const onPullBackChange = useCallback((back: (() => void) | null, key: string, blocked: boolean) => {
    pullBack.current = back;
    setPullPage(key);
    setPullBackBlocked(blocked);
  }, []);
  const scrollArea = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollArea.current = browserRef.current?.closest<HTMLDivElement>('.main-column') ?? null;
  }, []);
  const pageKey = JSON.stringify([repo.id, tab, focusTag, selectedIssue?.number, selectedCommit?.sha]);
  const effectivePageKey = tab === 'pulls' ? JSON.stringify([pageKey, pullPage]) : pageKey;
  useLayoutEffect(() => {
    onPageChange?.(effectivePageKey);
  }, [effectivePageKey, onPageChange]);
  const rememberPage = usePageScroll(
    `${pageKey}:${issueFilter}:${issueSearch.query}`,
    parentScrollArea ?? scrollArea,
    () => browserRef.current?.isConnected === true,
  );
  const history = usePageHistory(pageKey, () => {
    leaveDetail();
    setTab(tab);
    setFocusTag(focusTag);
    setSelectedIssue(selectedIssue);
    setSelectedCommit(selectedCommit);
    setComments(comments);
    setError(error);
    setIssueError(issueError);
    setHistoryError(historyError);
    setIssueFilter(issueFilter);
    changeIssueSearch(issueSearch);
    setProposalNotice(proposalNotice);
    setShowProposalForm(false);
    // A request invalidated when leaving a detail must be started again on return.
    if (busy && selectedIssue) void showIssue(selectedIssue);
    else if (busy && selectedCommit) void showVersion(selectedCommit);
  });

  function goBack(fallback: () => void): void {
    rememberPage();
    if (tab === 'pulls' && pullBackBlocked) return;
    if (outerBackBoundary === effectivePageKey) {
      onBack();
      return;
    }
    if (tab === 'pulls' && pullBack.current) {
      pullBack.current();
      return;
    }
    history.back(fallback);
  }

  useNestedNavigation(
    browserRef,
    () => goBack(onBack),
    history.hasForward
      ? () => {
          rememberPage();
          history.forward();
        }
      : null,
    pullBackBlocked,
  );

  function renderPage(children: ReactNode): ReactNode {
    const cacheKey = tab === 'downloads' ? JSON.stringify([tab, focusTag ?? null]) : tab;
    return (
      <div ref={browserRef} style={{ display: 'contents' }}>
        <NavigationPages active={cacheKey}>{children}</NavigationPages>
      </div>
    );
  }

  function leaveDetail(): void {
    detailRequest.current += 1;
    setBusy(false);
  }

  function changeTab(next: Tab): void {
    rememberPage();
    if (tab !== next) {
      leaveDetail();
      setSelectedIssue(null);
      setSelectedCommit(null);
    }
    setTab(next);
  }

  async function refreshActivityCounts(): Promise<void> {
    try {
      const result = await easyHub!.github<Record<number, GitHubActivityCount>>('activityCounts', [
        { id: repo.id, owner, name: repo.name },
      ]);
      setActivityCounts(result[repo.id] ?? null);
      setActivityUnavailable(!result[repo.id]);
    } catch {
      setActivityUnavailable(true);
    }
  }

  useEffect(() => {
    let active = true;
    setActivityCounts(null);
    setActivityUnavailable(false);
    void easyHub!
      .github<Record<number, GitHubActivityCount>>('activityCounts', [{ id: repo.id, owner, name: repo.name }])
      .then((result) => {
        if (active) {
          setActivityCounts(result[repo.id] ?? null);
          setActivityUnavailable(!result[repo.id]);
        }
      })
      .catch(() => {
        if (active) setActivityUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [repo.id, owner, repo.name]);

  useEffect(() => {
    let active = true;
    const request = ++detailRequest.current;
    setTab(startInDownloads ? 'downloads' : 'intro');
    setFocusTag(initialFocusTag);
    setSelectedIssue(null);
    setSelectedCommit(null);
    setReadme('');
    setCommits([]);
    setError('');
    setHistoryError('');
    setShowProposalForm(false);
    setProposalNotice('');
    setBusy(true);
    const github = easyHub?.github;
    if (!github) {
      setError(t('publicProjectBrowser.theAppConnectionIsUnavailablePleaseRestartEasyhub'));
      setBusy(false);
      return;
    }
    void Promise.allSettled([
      github<string>('readme', owner, repo.name),
      github<GitHubCommit[]>('commits', owner, repo.name),
    ])
      .then(([intro, history]) => {
        if (!active) return;
        if (intro.status === 'fulfilled') setReadme(intro.value);
        if (history.status === 'fulfilled') setCommits(history.value);
        if (intro.status === 'rejected') setError(errorText(intro.reason));
        if (history.status === 'rejected') setHistoryError(errorText(history.reason));
      })
      .finally(() => {
        if (active && request === detailRequest.current) setBusy(false);
      });
    return () => {
      active = false;
      detailRequest.current += 1;
    };
  }, [owner, repo.name, repo.id, repo.default_branch, currentUser, startInDownloads, initialFocusTag]);

  useEffect(() => {
    let active = true;
    issueListRequest.current += 1;
    setIssues([]);
    setNextIssuePage(null);
    setIssueError('');
    setLoadingIssues(true);
    void easyHub!
      .github<GitHubIssuePage>('issuesPage', owner, repo.name, issueFilter, 1)
      .then((result) => {
        if (!active) return;
        setIssues(result.items);
        setNextIssuePage(result.nextPage);
      })
      .catch((cause) => {
        if (active) setIssueError(errorText(cause));
      })
      .finally(() => {
        if (active) setLoadingIssues(false);
      });
    return () => {
      active = false;
      issueListRequest.current += 1;
    };
  }, [owner, repo.name, issueFilter]);

  async function loadMoreIssues(): Promise<void> {
    if (loadingIssues || (!nextIssuePage && !(issueError && issues.length === 0))) return;
    const request = issueListRequest.current;
    setLoadingIssues(true);
    setIssueError('');
    try {
      const result = await easyHub!.github<GitHubIssuePage>(
        'issuesPage',
        owner,
        repo.name,
        issueFilter,
        nextIssuePage ?? 1,
      );
      if (request !== issueListRequest.current) return;
      setIssues((current) => [
        ...current,
        ...result.items.filter((item) => !current.some((known) => known.id === item.id)),
      ]);
      setNextIssuePage(result.nextPage);
    } catch (cause) {
      if (request === issueListRequest.current) setIssueError(errorText(cause));
    } finally {
      if (request === issueListRequest.current) setLoadingIssues(false);
    }
  }

  async function showIssue(issue: GitHubIssue): Promise<void> {
    rememberPage();
    const request = ++detailRequest.current;
    setSelectedIssue(issue);
    setComments([]);
    setError('');
    setBusy(true);
    try {
      const result = await easyHub!.github<GitHubComment[]>('comments', owner, repo.name, issue.number);
      if (request === detailRequest.current) setComments(result);
    } catch (cause) {
      if (request === detailRequest.current) setError(errorText(cause));
    } finally {
      if (request === detailRequest.current) setBusy(false);
    }
  }

  async function sendReply(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedIssue || !reply.trim() || !easyHub) return;
    const request = detailRequest.current;
    const sentDraft = reply;
    setReplySaving(true);
    setError('');
    try {
      const comment = await easyHub.github<GitHubComment>(
        'createComment',
        owner,
        repo.name,
        selectedIssue.number,
        reply.trim(),
      );
      clearReply(sentDraft);
      if (request !== detailRequest.current) return;
      setComments((items) => [...items, comment]);
      setIssues((items) =>
        items.map((item) => (item.id === selectedIssue.id ? { ...item, comments: item.comments + 1 } : item)),
      );
    } catch (cause) {
      if (request === detailRequest.current) setError(errorText(cause));
    } finally {
      setReplySaving(false);
    }
  }

  async function submitProposal(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (proposalType !== 'issue' || !issueTitle.trim() || !easyHub) return;
    setIssueSaving(true);
    setProposalError('');
    setProposalNotice('');
    try {
      const created = await easyHub.github<GitHubIssue>(
        'createIssue',
        owner,
        repo.name,
        issueTitle.trim(),
        issueBody.trim(),
      );
      if (issueFilter === 'open') setIssues((items) => [created, ...items]);
      else setIssueFilter('open');
      void refreshActivityCounts();
      setTab('issues');
      setProposalNotice(t('publicProjectBrowser.issueCreated'));
      setIssueTitle('');
      setIssueBody('');
      setShowProposalForm(false);
    } catch (cause) {
      setProposalError(errorText(cause));
    } finally {
      setIssueSaving(false);
    }
  }

  async function showVersion(item: GitHubCommit): Promise<void> {
    rememberPage();
    const request = ++detailRequest.current;
    setSelectedCommit(item);
    setError('');
    setBusy(true);
    try {
      const result = await easyHub!.github<GitHubCommit>('commit', owner, repo.name, item.sha);
      if (request === detailRequest.current) setSelectedCommit(result);
    } catch (cause) {
      if (request === detailRequest.current) setError(errorText(cause));
    } finally {
      if (request === detailRequest.current) setBusy(false);
    }
  }

  function openReadmeLink(url: string): void {
    const release = readmeReleaseLink(url);
    if (
      release &&
      release.owner.toLowerCase() === owner.toLowerCase() &&
      release.repo.toLowerCase() === repo.name.toLowerCase()
    ) {
      setFocusTag(release.tag);
      changeTab('downloads');
    } else onOpenLink(url);
  }

  if (tab === 'source-history')
    return renderPage(
      <div className="public-browser" data-testid="public-project-browser">
        <SourceHistory
          key={repo.id}
          repo={repo}
          language={language}
          scrollArea={parentScrollArea ?? scrollArea}
          onBack={() => goBack(() => changeTab('intro'))}
        />
      </div>,
    );
  if (tab === 'downloads')
    return renderPage(
      <div className="public-browser" data-testid="public-project-browser">
        <ReleaseDownloads
          repo={repo}
          language={language}
          focusTag={focusTag}
          offerAdd
          onDownload={onDownload}
          downloadBusy={downloadBusy}
          onOpenLink={openReadmeLink}
          onBack={() => goBack(startInDownloads ? onBack : () => changeTab('intro'))}
        />
      </div>,
    );
  if (tab === 'issues' && selectedIssue)
    return renderPage(
      <div className="public-issue-page" data-testid="public-project-browser">
        <button
          className="back-link"
          onClick={() =>
            goBack(() => {
              leaveDetail();
              setSelectedIssue(null);
            })
          }
        >
          <ArrowLeft size={16} />
          {t('publicProjectBrowser.backToIssues')}
        </button>
        {error && (
          <div className="live-error" role="alert">
            <ErrorMessage error={error} language={language} />
            <button className="text-link" disabled={busy} onClick={() => void showIssue(selectedIssue)}>
              {t('publicProjectBrowser.retry')}
            </button>
          </div>
        )}
        {busy && (
          <p className="live-loading">
            <RotateCw size={16} className="live-spin" />
            {t('publicProjectBrowser.loadingIssue')}
          </p>
        )}
        <PublicIssueConversation
          repo={repo}
          language={language}
          issue={selectedIssue}
          comments={comments}
          protectedNames={issueAuthorNames}
          reply={reply}
          onReplyChange={setReply}
          onReply={(event) => void sendReply(event)}
          replySaving={replySaving}
          onOpenLink={openReadmeLink}
          pagination={
            !busy && (
              <PagedContinuation<GitHubComment>
                key={`${replyKey}:${detailRequest.current}`}
                action="commentsPage"
                args={[owner, repo.name, selectedIssue.number]}
                firstCount={comments.length}
                language={language}
                label={t('publicProjectBrowser.loadMoreReplies')}
                onItems={(items) =>
                  setComments((old) =>
                    [...old, ...items.filter((item) => !old.some((known) => known.id === item.id))].sort(
                      (a, b) => a.id - b.id,
                    ),
                  )
                }
              />
            )
          }
        />
      </div>,
    );

  return renderPage(
    <div className="public-browser" data-testid="public-project-browser">
      <button className="back-link" onClick={() => goBack(onBack)}>
        <ArrowLeft size={17} />
        {backToSearchResults && !history.hasBack && outerBackBoundary !== effectivePageKey
          ? t('publicProjectBrowser.backToSearchResults')
          : t('publicProjectBrowser.back')}
      </button>
      <PublicProjectHero
        repo={repo}
        language={language}
        onOpenSourceHistory={() => changeTab('source-history')}
        onPropose={() => {
          setProposalError('');
          setShowProposalForm(true);
        }}
        onOpenDownloads={() => {
          setFocusTag(undefined);
          changeTab('downloads');
        }}
      />
      {error && (
        <div className="live-error" role="alert">
          <ErrorMessage error={error} language={language} />
        </div>
      )}
      {proposalNotice && (
        <div className="public-proposal-notice" role="status">
          {proposalNotice}
        </div>
      )}
      <SegmentedControl
        className="public-browser-tabs"
        motionKey={`public-project-tabs:${repo.id}`}
        aria-label={t('publicProjectBrowser.projectContent')}
      >
        <button className={tab === 'intro' ? 'selected' : ''} onClick={() => changeTab('intro')}>
          {t('publicProjectBrowser.projectIntroduction')}
        </button>
        <button className={tab === 'issues' ? 'selected' : ''} onClick={() => changeTab('issues')}>
          {t('publicProjectBrowser.issues')}{' '}
          <span>{activityCounts?.issues ?? `${issues.length}${nextIssuePage ? '+' : ''}`}</span>
        </button>
        <button className={tab === 'pulls' ? 'selected' : ''} onClick={() => changeTab('pulls')}>
          {t('publicProjectBrowser.pullRequestReviews')}{' '}
          <span>{activityCounts?.pullRequests ?? (activityUnavailable ? '—' : '…')}</span>
        </button>
        <button className={tab === 'history' ? 'selected' : ''} onClick={() => changeTab('history')}>
          {t('publicProjectBrowser.changeHistory')}
        </button>
      </SegmentedControl>
      {tab === 'pulls' && (
        <PullRequestsPanel
          repo={repo}
          currentUser={currentUser}
          language={language}
          showCreateButton={false}
          scrollArea={parentScrollArea ?? scrollArea}
          onBackChange={onPullBackChange}
          downloadBusy={downloadBusy}
          onActivityChanged={() => void refreshActivityCounts()}
          onOpenAiSettings={onOpenAiSettings}
          onDownloadFile={async (number, path, headSha) => {
            onDownload({ kind: 'pull-file', repo, number, path, headSha, fileName: path.split('/').pop() || path });
          }}
        />
      )}
      {tab !== 'pulls' && (
        <section className="panel public-browser-content">
          {busy && (
            <p className="live-loading">
              <RotateCw size={16} className="live-spin" />
              {t('publicProjectBrowser.loadingProjectContent')}
            </p>
          )}
          {tab === 'intro' && (
            <>
              <div className="panel-heading">
                <h2>{t('publicProjectBrowser.projectIntroduction')}</h2>
              </div>
              {readme ? (
                <TranslatableContent
                  text={readme}
                  format="markdown"
                  paragraphMode
                  render={(value) => (
                    <ReadmeMarkdown
                      markdown={value}
                      repository={{ owner, name: repo.name, branch: repo.default_branch }}
                      onOpenLink={openReadmeLink}
                    />
                  )}
                />
              ) : (
                !busy && <p className="muted">{t('publicProjectBrowser.thisProjectHasNoIntroductionYet')}</p>
              )}
            </>
          )}
          {tab === 'issues' && (
            <PublicIssuesTab
              repo={repo}
              language={language}
              issues={issues}
              issueFilter={issueFilter}
              onIssueFilterChange={setIssueFilter}
              search={issueSearch}
              onSearchChange={changeIssueSearch}
              loadingIssues={loadingIssues}
              issueError={issueError}
              nextIssuePage={nextIssuePage}
              onOpenIssue={(item) => void showIssue(item)}
              onLoadMore={() => void loadMoreIssues()}
            />
          )}
          {tab === 'history' && (
            <PublicHistoryTab
              repo={repo}
              language={language}
              commits={commits}
              selectedCommit={selectedCommit}
              busy={busy}
              historyError={historyError}
              downloadBusy={downloadBusy}
              onBackToList={() =>
                goBack(() => {
                  leaveDetail();
                  setSelectedCommit(null);
                })
              }
              onOpenCommit={(item) => void showVersion(item)}
              onMoreCommits={(items) =>
                setCommits((old) => [...old, ...items.filter((item) => !old.some((known) => known.sha === item.sha))])
              }
              onDownload={onDownload}
            />
          )}
        </section>
      )}
      {showProposalForm && (
        <PublicProposalDialog
          repo={repo}
          language={language}
          currentUser={currentUser}
          proposalType={proposalType}
          onProposalTypeChange={setProposalType}
          issueTitle={issueTitle}
          onIssueTitleChange={setIssueTitle}
          issueBody={issueBody}
          onIssueBodyChange={setIssueBody}
          saving={issueSaving}
          error={proposalError}
          onForkReady={onForkReady}
          onClose={() => setShowProposalForm(false)}
          onSubmit={(event) => void submitProposal(event)}
        />
      )}
    </div>,
  );
}
