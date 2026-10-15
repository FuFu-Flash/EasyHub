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
import { DiscussionSearch, useDiscussionSearchState } from './DiscussionSearch';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode, RefObject } from 'react';
import type { GitHubActivityCount, GitHubComment, GitHubCommit, GitHubIssue, GitHubIssuePage, GitHubRepo } from '@easyhub/github';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Clock3, Globe2, MessageCircle, Plus, RotateCw, X } from 'lucide-react';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { ReleaseDownloads } from './ReleaseDownloads';
import { PullRequestsPanel } from './PullRequestsPanel';
import { ForkSetup } from './ForkSetup';
import { readmeReleaseLink } from './readmeReleaseLink';
import { TranslatableContent } from './TranslatableContent';
import { StarProjectButton } from './StarProjectButton';
import { SourceHistory, SourceHistoryButton } from './SourceHistory';
import type { DownloadRequest } from './useDownloadCenter';
import type { Language } from '../i18n';

type Tab = 'intro' | 'issues' | 'pulls' | 'history' | 'source-history' | 'downloads';


function PublicIssueConversation({ repo, issue, comments, protectedNames, reply, onReplyChange, onReply, replySaving, onOpenLink, pagination }: {
  repo: GitHubRepo; issue: GitHubIssue; comments: GitHubComment[]; protectedNames: string[];
  reply: string; onReplyChange: (value: string) => void; onReply: (event: FormEvent) => void; replySaving: boolean;
  onOpenLink: (url: string) => void; pagination: React.ReactNode;
}) {
  const t = useTranslation();
  const markdown = (value: string) => <ReadmeMarkdown markdown={value} repository={{ owner: repo.owner.login, name: repo.name, branch: repo.default_branch }} onOpenLink={onOpenLink} />;
  return <div className="issue-detail public-issue-detail">
    <div className="issue-title"><span className={`issue-state ${issue.state === 'closed' ? 'closed' : ''}`}>{issue.state === 'open' ? t("publicProjectBrowser.open") : t("publicProjectBrowser.resolved")}</span>
      <TranslatableContent text={issue.title} format="text" protectedNames={protectedNames} render={(value) => <h1>{value}</h1>} />
      <p>{repo.name} · {issue.user?.login || t("publicProjectBrowser.githubUser")}  {t("publicProjectBrowser.openedOn")} {new Date(issue.created_at).toLocaleString()}</p>
    </div>
    <div className="conversation">
      <div className="message"><div className="avatar author-avatar">{(issue.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box">
        <div><strong>{issue.user?.login || t("publicProjectBrowser.githubUser")}</strong><small>{new Date(issue.created_at).toLocaleString()}</small></div>
        {issue.body ? <TranslatableContent text={issue.body} format="markdown" paragraphMode protectedNames={protectedNames} render={markdown} /> : markdown(t("publicProjectBrowser.noDetailsProvided"))}
      </div></div>
      {comments.map((item) => <div className="message" key={item.id}><div className="avatar">{(item.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box">
        <div><strong>{item.user?.login || t("publicProjectBrowser.githubUser")}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div>
        <TranslatableContent text={item.body} format="markdown" paragraphMode protectedNames={protectedNames} render={markdown} />
      </div></div>)}
    </div>
    {pagination}
    <form className="reply-card" onSubmit={onReply}><label htmlFor="public-issue-reply">{t("publicProjectBrowser.writeAReply")}</label><textarea id="public-issue-reply" rows={4} value={reply} onChange={(event) => onReplyChange(event.target.value)} placeholder={t("publicProjectBrowser.shareYourThoughtsOrSuggestions")} /><div><span /><button className="button button-primary" disabled={replySaving || !reply.trim()} type="submit">{t("publicProjectBrowser.sendReply")} <ArrowRight size={16} /></button></div></form>
  </div>;
}

export function PublicProjectBrowser({ repo, language, currentUser, onBack, onOpenLink, onDownload, onForkReady, onOpenAiSettings, downloadBusy, startInDownloads = false, initialFocusTag, scrollArea: parentScrollArea, outerBackBoundary, onPageChange }: {
  repo: GitHubRepo;
  language: Language;
  currentUser: string;
  onBack: () => void;
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
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
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
  const [proposalType, setProposalType] = useState<'issue' | 'pull'>('issue');
  const [proposalError, setProposalError] = useState('');
  const [proposalNotice, setProposalNotice] = useState('');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [issueSaving, setIssueSaving] = useState(false);
  const replyKey = createDraftKey(currentUser, repo.full_name, 'reply', selectedIssue?.number ?? 'none');
  const [reply, setReply, clearReply] = useLocalDraft(replyKey);
  const [issueSearch, changeIssueSearch] = useDiscussionSearchState(currentUser, `public:${repo.id}:${repo.full_name}:issue`);
  const issueSearchActive = Boolean(issueSearch.query);
  const [replySaving, setReplySaving] = useState(false);
  const detailRequest = useRef(0);
  const issueListRequest = useRef(0);
  const owner = repo.owner.login;
  const issueAuthorNames = [selectedIssue?.user?.login, ...comments.map((item) => item.user?.login)].filter((name): name is string => Boolean(name));
  const browserRef = useRef<HTMLDivElement>(null);
  const pullBack = useRef<(() => void) | null>(null);
  const [pullPage, setPullPage] = useState('list');
  const [pullBackBlocked, setPullBackBlocked] = useState(false);
  const onPullBackChange = useCallback((back: (() => void) | null, key: string, blocked: boolean) => {
    pullBack.current = back; setPullPage(key); setPullBackBlocked(blocked);
  }, []);
  const scrollArea = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scrollArea.current = browserRef.current?.closest<HTMLDivElement>('.main-column') ?? null;
  }, []);
  const pageKey = JSON.stringify([repo.id, tab, focusTag, selectedIssue?.number, selectedCommit?.sha]);
  const effectivePageKey = tab === 'pulls' ? JSON.stringify([pageKey, pullPage]) : pageKey;
  useLayoutEffect(() => { onPageChange?.(effectivePageKey); }, [effectivePageKey, onPageChange]);
  const rememberPage = usePageScroll(`${pageKey}:${issueFilter}:${issueSearch.query}`, parentScrollArea ?? scrollArea, () => browserRef.current?.isConnected === true);
  const history = usePageHistory(pageKey, () => {
    leaveDetail();
    setTab(tab); setFocusTag(focusTag); setSelectedIssue(selectedIssue); setSelectedCommit(selectedCommit);
    setComments(comments); setError(error); setIssueError(issueError); setHistoryError(historyError);
    setIssueFilter(issueFilter); changeIssueSearch(issueSearch);
    setProposalNotice(proposalNotice); setShowProposalForm(false);
    // A request invalidated when leaving a detail must be started again on return.
    if (busy && selectedIssue) void showIssue(selectedIssue);
    else if (busy && selectedCommit) void showVersion(selectedCommit);
  });

  function goBack(fallback: () => void): void {
    rememberPage();
    if (tab === 'pulls' && pullBackBlocked) return;
    if (outerBackBoundary === effectivePageKey) { onBack(); return; }
    if (tab === 'pulls' && pullBack.current) { pullBack.current(); return; }
    history.back(fallback);
  }

  useNestedNavigation(browserRef, () => goBack(onBack), history.hasForward ? () => { rememberPage(); history.forward(); } : null, pullBackBlocked);

  function renderPage(children: ReactNode): ReactNode {
    const cacheKey = tab === 'downloads' ? JSON.stringify([tab, focusTag ?? null]) : tab;
    return <div ref={browserRef} style={{ display: 'contents' }}><NavigationPages active={cacheKey}>{children}</NavigationPages></div>;
  }

  function leaveDetail(): void {
    detailRequest.current += 1;
    setBusy(false);
  }

  function changeTab(next: Tab): void {
    rememberPage();
    if (tab !== next) { leaveDetail(); setSelectedIssue(null); setSelectedCommit(null); }
    setTab(next);
  }

  async function refreshActivityCounts(): Promise<void> {
    try {
      const result = await easyHub!.github<Record<number, GitHubActivityCount>>('activityCounts', [{ id: repo.id, owner, name: repo.name }]);
      setActivityCounts(result[repo.id] ?? null);
      setActivityUnavailable(!result[repo.id]);
    } catch { setActivityUnavailable(true); }
  }

  useEffect(() => {
    let active = true;
    setActivityCounts(null);
    setActivityUnavailable(false);
    void easyHub!.github<Record<number, GitHubActivityCount>>('activityCounts', [{ id: repo.id, owner, name: repo.name }])
      .then((result) => { if (active) { setActivityCounts(result[repo.id] ?? null); setActivityUnavailable(!result[repo.id]); } })
      .catch(() => { if (active) setActivityUnavailable(true); });
    return () => { active = false; };
  }, [repo.id, owner, repo.name]);

  useEffect(() => {
    let active = true;
    const request = ++detailRequest.current;
    setTab(startInDownloads ? 'downloads' : 'intro'); setFocusTag(initialFocusTag); setSelectedIssue(null); setSelectedCommit(null); setReadme(''); setCommits([]); setError(''); setHistoryError(''); setShowProposalForm(false); setProposalNotice(''); setBusy(true);
    const github = easyHub?.github;
    if (!github) { setError(t("publicProjectBrowser.theAppConnectionIsUnavailablePleaseRestartEasyhub")); setBusy(false); return; }
    void Promise.allSettled([
      github<string>('readme', owner, repo.name),
      github<GitHubCommit[]>('commits', owner, repo.name),
    ]).then(([intro, history]) => {
      if (!active) return;
      if (intro.status === 'fulfilled') setReadme(intro.value);
      if (history.status === 'fulfilled') setCommits(history.value);
      if (intro.status === 'rejected') setError(errorText(intro.reason));
      if (history.status === 'rejected') setHistoryError(errorText(history.reason));
    })
      .finally(() => { if (active && request === detailRequest.current) setBusy(false); });
    return () => { active = false; detailRequest.current += 1; };
  }, [owner, repo.name, repo.id, repo.default_branch, currentUser, startInDownloads, initialFocusTag]);

  useEffect(() => {
    let active = true;
    issueListRequest.current += 1;
    setIssues([]); setNextIssuePage(null); setIssueError(''); setLoadingIssues(true);
    void easyHub!.github<GitHubIssuePage>('issuesPage', owner, repo.name, issueFilter, 1).then((result) => {
      if (!active) return;
      setIssues(result.items); setNextIssuePage(result.nextPage);
    }).catch((cause) => { if (active) setIssueError(errorText(cause)); }).finally(() => { if (active) setLoadingIssues(false); });
    return () => { active = false; issueListRequest.current += 1; };
  }, [owner, repo.name, issueFilter]);

  async function loadMoreIssues(): Promise<void> {
    if (loadingIssues || (!nextIssuePage && !(issueError && issues.length === 0))) return;
    const request = issueListRequest.current;
    setLoadingIssues(true); setIssueError('');
    try {
      const result = await easyHub!.github<GitHubIssuePage>('issuesPage', owner, repo.name, issueFilter, nextIssuePage ?? 1);
      if (request !== issueListRequest.current) return;
      setIssues((current) => [...current, ...result.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setNextIssuePage(result.nextPage);
    } catch (cause) { if (request === issueListRequest.current) setIssueError(errorText(cause)); }
    finally { if (request === issueListRequest.current) setLoadingIssues(false); }
  }

  async function showIssue(issue: GitHubIssue): Promise<void> {
    rememberPage();
    const request = ++detailRequest.current;
    setSelectedIssue(issue); setComments([]); setError(''); setBusy(true);
    try {
      const result = await easyHub!.github<GitHubComment[]>('comments', owner, repo.name, issue.number);
      if (request === detailRequest.current) setComments(result);
    } catch (cause) { if (request === detailRequest.current) setError(errorText(cause)); }
    finally { if (request === detailRequest.current) setBusy(false); }
  }

  async function sendReply(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedIssue || !reply.trim() || !easyHub) return;
    const request = detailRequest.current;
    const sentDraft = reply;
    setReplySaving(true); setError('');
    try {
      const comment = await easyHub.github<GitHubComment>('createComment', owner, repo.name, selectedIssue.number, reply.trim());
      clearReply(sentDraft);
      if (request !== detailRequest.current) return;
      setComments((items) => [...items, comment]);
      setIssues((items) => items.map((item) => item.id === selectedIssue.id ? { ...item, comments: item.comments + 1 } : item));
    } catch (cause) { if (request === detailRequest.current) setError(errorText(cause)); }
    finally { setReplySaving(false); }
  }

  async function submitProposal(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (proposalType !== 'issue' || !issueTitle.trim() || !easyHub) return;
    setIssueSaving(true); setProposalError(''); setProposalNotice('');
    try {
      const created = await easyHub.github<GitHubIssue>('createIssue', owner, repo.name, issueTitle.trim(), issueBody.trim());
      if (issueFilter === 'open') setIssues((items) => [created, ...items]);
      else setIssueFilter('open');
      void refreshActivityCounts();
      setTab('issues'); setProposalNotice(t("publicProjectBrowser.issueCreated"));
      setIssueTitle(''); setIssueBody(''); setShowProposalForm(false);
    } catch (cause) { setProposalError(errorText(cause)); }
    finally { setIssueSaving(false); }
  }

  async function showVersion(item: GitHubCommit): Promise<void> {
    rememberPage();
    const request = ++detailRequest.current;
    setSelectedCommit(item); setError(''); setBusy(true);
    try {
      const result = await easyHub!.github<GitHubCommit>('commit', owner, repo.name, item.sha);
      if (request === detailRequest.current) setSelectedCommit(result);
    } catch (cause) { if (request === detailRequest.current) setError(errorText(cause)); }
    finally { if (request === detailRequest.current) setBusy(false); }
  }

  function openReadmeLink(url: string): void {
    const release = readmeReleaseLink(url);
    if (release && release.owner.toLowerCase() === owner.toLowerCase() && release.repo.toLowerCase() === repo.name.toLowerCase()) {
      setFocusTag(release.tag); changeTab('downloads');
    } else onOpenLink(url);
  }

  if (tab === 'source-history') return renderPage(<div className="public-browser" data-testid="public-project-browser"><SourceHistory key={repo.id} repo={repo} language={language} scrollArea={parentScrollArea ?? scrollArea} onBack={() => goBack(() => changeTab('intro'))} /></div>);
  if (tab === 'downloads') return renderPage(<div className="public-browser" data-testid="public-project-browser"><ReleaseDownloads repo={repo} language={language} focusTag={focusTag} offerAdd onDownload={onDownload} downloadBusy={downloadBusy} onOpenLink={openReadmeLink} onBack={() => goBack(startInDownloads ? onBack : () => changeTab('intro'))} /></div>);
  if (tab === 'issues' && selectedIssue) return renderPage(<div className="public-issue-page" data-testid="public-project-browser">
    <button className="back-link" onClick={() => goBack(() => { leaveDetail(); setSelectedIssue(null); })}><ArrowLeft size={16} />{t("publicProjectBrowser.backToIssues")}</button>
    {error && <div className="live-error" role="alert"><ErrorMessage error={error} language={language} /><button className="text-link" disabled={busy} onClick={() => void showIssue(selectedIssue)}>{t("publicProjectBrowser.retry")}</button></div>}
    {busy && <p className="live-loading"><RotateCw size={16} className="live-spin" />{t("publicProjectBrowser.loadingIssue")}</p>}
    <PublicIssueConversation repo={repo} issue={selectedIssue} comments={comments} protectedNames={issueAuthorNames} reply={reply} onReplyChange={setReply} onReply={(event) => void sendReply(event)} replySaving={replySaving} onOpenLink={openReadmeLink} pagination={!busy && <PagedContinuation<GitHubComment> key={`${replyKey}:${detailRequest.current}`} action="commentsPage" args={[owner, repo.name, selectedIssue.number]} firstCount={comments.length} language={language} label={t("publicProjectBrowser.loadMoreReplies")} onItems={(items) => setComments((old) => [...old, ...items.filter((item) => !old.some((known) => known.id === item.id))].sort((a, b) => a.id - b.id))} />} />
  </div>);

  return renderPage(<div className="public-browser" data-testid="public-project-browser">
    <button className="back-link" onClick={() => goBack(onBack)}><ArrowLeft size={17} />{history.hasBack || outerBackBoundary === effectivePageKey ? t("publicProjectBrowser.back") : t("publicProjectBrowser.backToSearchResults")}</button>
    <section className="detail-hero public-browser-hero has-source-history"><SourceHistoryButton language={language} onClick={() => changeTab('source-history')} /><div className="detail-main"><span className="project-logo logo-sky public-owner-avatar" aria-hidden="true">{repo.owner.avatar_url ? <img src={repo.owner.avatar_url} alt="" /> : repo.owner.login.slice(0, 1).toUpperCase()}</span><div><div className="detail-name-row"><h1>{repo.full_name}</h1><span className="visibility-label"><Globe2 size={13} />{repo.private ? t("publicProjectBrowser.authorizedProject") : t("publicProjectBrowser.publicProjects")}</span></div>{repo.description ? <TranslatableContent text={repo.description} format="text" render={(value) => <p>{value}</p>} /> : <p>{t("publicProjectBrowser.noProjectDescriptionYet")}</p>}</div></div><div className="detail-actions"><StarProjectButton repo={repo} /><button className="button button-quiet" onClick={() => { setProposalError(''); setShowProposalForm(true); }}><Plus size={17} />{t("publicProjectBrowser.reportAnIssueSuggestAChange")}</button><button className="button button-primary" onClick={() => { setFocusTag(undefined); changeTab('downloads'); }}><ArrowDownToLine size={17} />{t("publicProjectBrowser.downloadReleasesOrSource")}</button></div></section>
    {error && <div className="live-error" role="alert"><ErrorMessage error={error} language={language} /></div>}
    {proposalNotice && <div className="public-proposal-notice" role="status">{proposalNotice}</div>}
    <nav className="public-browser-tabs" aria-label={t("publicProjectBrowser.projectContent")}><button className={tab === 'intro' ? 'selected' : ''} onClick={() => changeTab('intro')}>{t("publicProjectBrowser.projectIntroduction")}</button><button className={tab === 'issues' ? 'selected' : ''} onClick={() => changeTab('issues')}>{t("publicProjectBrowser.issues")} <span>{activityCounts?.issues ?? `${issues.length}${nextIssuePage ? '+' : ''}`}</span></button><button className={tab === 'pulls' ? 'selected' : ''} onClick={() => changeTab('pulls')}>{t("publicProjectBrowser.pullRequestReviews")} <span>{activityCounts?.pullRequests ?? (activityUnavailable ? '—' : '…')}</span></button><button className={tab === 'history' ? 'selected' : ''} onClick={() => changeTab('history')}>{t("publicProjectBrowser.changeHistory")}</button></nav>
    {tab === 'pulls' && <PullRequestsPanel repo={repo} currentUser={currentUser} language={language} showCreateButton={false} scrollArea={parentScrollArea ?? scrollArea} onBackChange={onPullBackChange} downloadBusy={downloadBusy} onActivityChanged={() => void refreshActivityCounts()} onOpenAiSettings={onOpenAiSettings} onDownloadFile={async (number, path, headSha) => { onDownload({ kind: 'pull-file', repo, number, path, headSha, fileName: path.split('/').pop() || path }); }} />}
    {tab !== 'pulls' && <section className="panel public-browser-content">
      {busy && <p className="live-loading"><RotateCw size={16} className="live-spin" />{t("publicProjectBrowser.loadingProjectContent")}</p>}
      {tab === 'intro' && <><div className="panel-heading"><h2>{t("publicProjectBrowser.projectIntroduction")}</h2></div>{readme ? <TranslatableContent text={readme} format="markdown" paragraphMode render={(value) => <ReadmeMarkdown markdown={value} repository={{ owner, name: repo.name, branch: repo.default_branch }} onOpenLink={openReadmeLink} />} /> : !busy && <p className="muted">{t("publicProjectBrowser.thisProjectHasNoIntroductionYet")}</p>}</>}
      {tab === 'issues' && <>
        <div className="panel-heading"><h2>{t("publicProjectBrowser.issues")}</h2></div>
        <DiscussionSearch filters={<SegmentedControl className="public-issue-filter"><button className={issueFilter === 'open' ? 'selected' : ''} disabled={loadingIssues} onClick={() => setIssueFilter('open')}>{t("publicProjectBrowser.open")}</button><button className={issueFilter === 'closed' ? 'selected' : ''} disabled={loadingIssues} onClick={() => setIssueFilter('closed')}>{t("publicProjectBrowser.resolved")}</button></SegmentedControl>} repositories={[repo]} kind="issue" state={issueFilter} language={language} search={issueSearch} onSearchChange={changeIssueSearch} onOpen={(item) => void showIssue(item)} />
        <div hidden={issueSearchActive}>
        {issueError && <p className="live-error" role="alert"><ErrorMessage error={issueError} language={language} /></p>}
        {issues.map((item) => <button className="public-list-row" key={item.id} onClick={() => void showIssue(item)}><MessageCircle size={19} /><span><TranslatableContent text={item.title} format="text" protectedNames={item.user?.login ? [item.user.login] : []} render={(value) => <strong>{value}</strong>} /><small>{item.state === 'open' ? t("publicProjectBrowser.open") : t("publicProjectBrowser.resolved")} · {item.user?.login || t("publicProjectBrowser.githubUser")}</small></span><ArrowRight size={17} /></button>)}
        {loadingIssues && issues.length === 0 && <p className="live-loading"><RotateCw size={16} className="live-spin" />{t("publicProjectBrowser.loadingIssues")}</p>}
        {issues.length === 0 && !loadingIssues && !issueError && <p className="muted">{t("publicProjectBrowser.thisProjectHasNoIssues")}</p>}
        {(nextIssuePage || issueError) && <button className="button button-quiet pull-more" disabled={loadingIssues} onClick={() => void loadMoreIssues()}>{loadingIssues ? t("publicProjectBrowser.loading") : issueError ? t("publicProjectBrowser.retry") : t("publicProjectBrowser.loadMoreIssues")}</button>}
        </div>
      </>}
      {tab === 'history' && <>{selectedCommit ? <><button className="back-link" onClick={() => goBack(() => { leaveDetail(); setSelectedCommit(null); })}><ArrowLeft size={16} />{t("publicProjectBrowser.backToChangeHistory")}</button><h2>{selectedCommit.commit.message.split('\n')[0]}</h2><p className="muted">{selectedCommit.commit.author?.name || t("publicProjectBrowser.unknownAuthor")} · {selectedCommit.commit.author?.date ? new Date(selectedCommit.commit.author.date).toLocaleString() : ''}</p><p className="muted">{t("publicProjectBrowser.filesChanged")}{selectedCommit.files?.length ?? '—'}  {t("publicProjectBrowser.added")} {selectedCommit.stats?.additions ?? '—'}  {t("publicProjectBrowser.linesRemoved")} {selectedCommit.stats?.deletions ?? '—'}  {t("publicProjectBrowser.lines")}</p>{selectedCommit.files?.map((file) => <div className="live-file" key={file.filename}>{file.filename}</div>)}<button className="button button-primary version-download" disabled={downloadBusy} onClick={() => onDownload({ kind: 'archive', repo, ref: selectedCommit.sha, fileName: `${repo.name}-${selectedCommit.sha.slice(0, 8)}.zip`, offerAdd: true })}><ArrowDownToLine size={18} />{t("publicProjectBrowser.downloadFilesAtThisPoint")}</button></> : <><div className="panel-heading"><h2>{t("publicProjectBrowser.changeHistory")}</h2></div>{historyError && <p className="live-error" role="alert"><ErrorMessage error={historyError} language={language} /></p>}{commits.map((item) => <button className="public-list-row" key={item.sha} onClick={() => void showVersion(item)}><Clock3 size={19} /><span><strong>{item.commit.message.split('\n')[0]}</strong><small>{item.commit.author?.date ? new Date(item.commit.author.date).toLocaleString() : ''}</small></span><ArrowRight size={17} /></button>)}{commits.length === 0 && !busy && !historyError && <p className="muted">{t("publicProjectBrowser.noChangeHistoryYet")}</p>}{!busy && !historyError && <PagedContinuation<GitHubCommit> key={repo.id} action="commitsPage" args={[owner, repo.name]} firstCount={commits.length} language={language} onItems={(items) => setCommits((old) => [...old, ...items.filter((item) => !old.some((known) => known.sha === item.sha))])} />}</>}</>}
    </section>}
    {showProposalForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !issueSaving) setShowProposalForm(false); }}>
      <form className="modal issue-modal proposal-modal" role="dialog" aria-modal="true" aria-labelledby="public-new-proposal-title" onSubmit={(event) => void submitProposal(event)}>
        <button type="button" className="icon-button modal-close" aria-label={t("publicProjectBrowser.close")} disabled={issueSaving} onClick={() => setShowProposalForm(false)}><X size={19} /></button>
        <h2 id="public-new-proposal-title">{t("publicProjectBrowser.reportAnIssueSuggestAChange")}</h2>
        <p>{t("publicProjectBrowser.reportAnIssueToTheAuthorOfOrPropose", { p0: repo.full_name })}</p>
        <div className="proposal-options" role="radiogroup" aria-label={t("publicProjectBrowser.feedbackType")}>
          <label className={proposalType === 'issue' ? 'selected' : ''}><input type="radio" name="proposal-type" value="issue" checked={proposalType === 'issue'} disabled={issueSaving} onChange={() => setProposalType('issue')} /><span><strong>{t("publicProjectBrowser.reportAnIssue")}</strong><small>{t("publicProjectBrowser.describeAProblemOrShareAnIdea")}</small></span></label>
          <label className={proposalType === 'pull' ? 'selected' : ''}><input type="radio" name="proposal-type" value="pull" checked={proposalType === 'pull'} disabled={issueSaving} onChange={() => setProposalType('pull')} /><span><strong>{t("publicProjectBrowser.createPullRequest")}</strong><small>{t("publicProjectBrowser.shareChangesAlreadySavedToGithubWithTheProject")}</small></span></label>
        </div>
        {proposalType === 'issue' ? <><label className="field"><span>{t("publicProjectBrowser.issueTitle")}</span><input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} required maxLength={256} placeholder={t("publicProjectBrowser.summarizeTheIssueInOneSentence")} /></label><label className="field"><span>{t("publicProjectBrowser.details")}</span><textarea rows={5} value={issueBody} onChange={(event) => setIssueBody(event.target.value)} maxLength={65536} placeholder={t("publicProjectBrowser.whatHappenedWhatWouldYouLikeToImprove")} /></label></> : <ForkSetup source={repo} currentUser={currentUser} onReady={onForkReady} />}
        {proposalError && <p className="live-error" role="alert"><ErrorMessage error={proposalError} language={language} /></p>}
        <div className="modal-actions"><button type="button" className="button button-quiet" disabled={issueSaving} onClick={() => setShowProposalForm(false)}>{t("publicProjectBrowser.cancel")}</button>{proposalType === 'issue' && <button type="submit" className="button button-primary" disabled={issueSaving || !issueTitle.trim()}>{t("publicProjectBrowser.createIssue")}</button>}</div>
      </form>
    </div>}
  </div>);
}
