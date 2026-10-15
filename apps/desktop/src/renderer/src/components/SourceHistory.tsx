import { useTranslation } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { GitHubBranch, GitHubCommit, GitHubCommitChangesPage, GitHubPage, GitHubPullFile, GitHubRepo } from '@easyhub/github';
import { isEmptyAddedPullFile } from '@easyhub/github';
import { ArrowLeft, ChevronDown, ChevronRight, ExternalLink, GitBranch, History, RotateCw, X } from 'lucide-react';
import type { Language } from '../i18n';
import { usePageHistory } from '../usePageHistory';
import { usePageScroll } from '../usePageScroll';
import { NavigationPages } from './NavigationPages';
import { StyledDropdown } from './StyledDropdown';
import { CommitExplanation } from './CommitExplanation';
import { parsePullPatch } from './pullReviewPresentation';

const date = (value: string | undefined, language: Language): string => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN') : '';
const appendCommits = (old: GitHubCommit[], items: GitHubCommit[]): GitHubCommit[] => [...old, ...items.filter(item => !old.some(known => known.sha === item.sha))];

export function SourceHistoryButton({ language, onClick }: { language: Language; onClick: () => void }) {
  const t = useTranslation(language);
  const label = t("sourceHistory.sourceHistory");
  return <button type="button" className="icon-button source-history-entry" aria-label={label} title={label} onClick={onClick}><History size={19} aria-hidden="true" /></button>;
}

function CommitFile({ file, language, onHistory }: { file: GitHubPullFile; language: Language; onHistory: (path: string) => void }) {
  const t = useTranslation(language);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(200);
  const parsed = useMemo(() => open && file.patch ? parsePullPatch(file) : null, [open, file]);
  
  const status = file.status === 'added' ? t("sourceHistory.added") : file.status === 'removed' ? t("sourceHistory.deleted") : file.status === 'renamed' ? t("sourceHistory.renamed") : t("sourceHistory.modified");
  return <article className="pull-file-change source-history-file">
    <div className="live-file pull-download-row">
      <button type="button" className="pull-file-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}><ChevronDown size={16} className={open ? 'expanded' : ''} /><span className="pull-file-name" data-content-original>{file.filename}</span><span className="pull-file-status">{status}</span></button>
      <small className="source-history-line-count"><span>+{file.additions}</span> / <span>−{file.deletions}</span></small>
      <button type="button" className="text-link" aria-label={t("sourceHistory.fileActionLabel", { p0: t("sourceHistory.fileHistory"), p1: file.filename })} onClick={() => onHistory(file.filename)}><History size={15} />{t("sourceHistory.fileHistory")}</button>
    </div>
    {open && <div className="pull-file-preview">
      {file.previous_filename && <p className="pull-file-rename" data-content-original>{file.previous_filename} → {file.filename}</p>}
      {parsed ? <>
        {parsed.incomplete && <p className="pull-review-note" role="status">{t("sourceHistory.someChangesAreOmittedViewTheCompleteDiffOn")}</p>}
        <div className="pull-diff-scroll source-history-diff" tabIndex={0} aria-label={t("sourceHistory.fileActionLabel", { p0: t("sourceHistory.fileChanges"), p1: file.filename })}>
          <table className="pull-diff-table" data-content-original><tbody>{parsed.lines.slice(0, visible).map((line, index) => <tr key={index} className={`pull-diff-${line.kind}`}><td className="pull-line-number">{line.before}</td><td className="pull-line-number">{line.after}</td><td className="pull-line-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</td><td className="pull-line-code"><code>{line.text}</code></td></tr>)}</tbody></table>
        </div>
        {visible < parsed.lines.length && <button className="text-link pull-diff-more" onClick={() => setVisible(count => count + 200)}>{t("sourceHistory.showMoreChangedLines")}</button>}
      </> : <p className="pull-review-note">{isEmptyAddedPullFile(file) ? t("sourceHistory.thisIsANewEmptyFile") : t("sourceHistory.githubDidNotProvideATextDiffTheFile")}</p>}
    </div>}
  </article>;
}

function CommitChanges({ repo, item, language, onFileHistory }: { repo: GitHubRepo; item: GitHubCommit; language: Language; onFileHistory: (path: string) => void }) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [detail, setDetail] = useState<GitHubCommit | null>(null);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [limited, setLimited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const active = useRef(true);
  const inFlight = useRef(false);
  
  async function load(page: number): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true); setError('');
    try {
      const result = await easyHub!.github<GitHubCommitChangesPage>('commitChangesPage', repo.owner.login, repo.name, item.sha, page);
      if (!active.current) return;
      setDetail(old => ({ ...result.commit, files: page === 1 ? result.commit.files : [...(old?.files ?? []), ...(result.commit.files ?? []).filter(file => !old?.files?.some(known => known.filename === file.filename))] }));
      setNextPage(result.nextPage); setLimited(result.limited);
    } catch (cause) { if (active.current) setError(errorText(cause)); }
    finally { inFlight.current = false; if (active.current) setLoading(false); }
  }
  useEffect(() => { active.current = true; void load(1); return () => { active.current = false; }; }, []); // Keyed by repository and immutable commit SHA.
  const commit = detail ?? item;
  const author = commit.author?.login ?? commit.commit.author?.name ?? t("sourceHistory.unknownAuthor");
  const url = `https://github.com/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/commit/${item.sha}`;
  return <section className="panel source-history-detail" aria-busy={loading}>
    <div className="source-history-commit-heading"><h2 data-content-original>{commit.commit.message.split('\n')[0]}</h2><button className="text-link" onClick={() => void easyHub?.openExternalLink(url)}><ExternalLink size={15} />GitHub</button></div>
    <p className="source-history-meta" data-content-original>{author} · {date(commit.commit.author?.date, language)} · <code>{item.sha.slice(0, 8)}</code></p>
    {commit.commit.message.includes('\n') && <p className="source-history-message" data-content-original>{commit.commit.message.slice(commit.commit.message.indexOf('\n') + 1).trim()}</p>}
    {detail && <p className="source-history-statistics">{t("sourceHistory.changedFiles")} {detail.files?.length ?? 0}{nextPage ? '+' : ''} · <span>+{detail.stats?.additions ?? 0}</span> / <span>−{detail.stats?.deletions ?? 0}</span></p>}
    <div className="source-history-explanation"><CommitExplanation owner={repo.owner.login} repo={repo.name} sha={item.sha} language={language} disabled={!detail || !detail.files?.length} /></div>
    {error && <div className="live-error" role="alert"><ErrorMessage error={error} language={language} /><button className="text-link" disabled={loading} onClick={() => void load(detail ? nextPage ?? 1 : 1)}>{t("sourceHistory.retry")}</button></div>}
    {detail?.files?.map(file => <CommitFile key={file.filename} file={file} language={language} onHistory={onFileHistory} />)}
    {loading && <p className="muted" role="status"><RotateCw size={16} className="live-spin" /> {t("sourceHistory.loadingCodeChanges")}</p>}
    {!loading && detail && !detail.files?.length && !error && <p className="muted">{t("sourceHistory.thisCommitHasNoFileChanges")}</p>}
    {nextPage && <button className="button button-quiet" disabled={loading} onClick={() => void load(nextPage)}>{t("sourceHistory.loadMoreFiles")}</button>}
    {limited && <p className="pull-review-note">{t("sourceHistory.theFileCountReachedTheGithubApiLimitView")}</p>}
  </section>;
}

export function SourceHistory({ repo, language, onBack, scrollArea }: { repo: GitHubRepo; language: Language; onBack: () => void; scrollArea: RefObject<HTMLDivElement | null> }) {
  const t = useTranslation(language);
  const easyHub = useEasyHub();
  const [branch, setBranch] = useState(repo.default_branch || 'main');
  const [path, setPath] = useState('');
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [branchNext, setBranchNext] = useState<number | null>(1);
  const [branchError, setBranchError] = useState('');
  const [branchBusy, setBranchBusy] = useState(false);
  const [items, setItems] = useState<GitHubCommit[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [selected, setSelected] = useState<GitHubCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const cache = useRef(new Map<string, GitHubPage<GitHubCommit>>());
  const request = useRef(0);
  const branchRequest = useRef(false);
  const active = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  
  const queryKey = JSON.stringify([branch, path]);
  const pageKey = JSON.stringify(['source-history', repo.id, branch, path, selected?.sha]);
  const rememberScroll = usePageScroll(pageKey, scrollArea, () => root.current?.isConnected === true);
  const history = usePageHistory(pageKey, () => { setBranch(branch); setPath(path); setSelected(selected); });
  async function loadBranches(page: number): Promise<void> {
    if (branchRequest.current) return;
    branchRequest.current = true; setBranchBusy(true); setBranchError('');
    try {
      const result = await easyHub!.github<GitHubPage<GitHubBranch>>('branchesPage', repo.owner.login, repo.name, page);
      if (active.current) { setBranches(old => [...old, ...result.items.filter(item => !old.some(known => known.name === item.name))]); setBranchNext(result.nextPage); }
    } catch (cause) { if (active.current) setBranchError(errorText(cause)); }
    finally { branchRequest.current = false; if (active.current) setBranchBusy(false); }
  }
  async function load(page: number, key = queryKey): Promise<void> {
    const generation = ++request.current;
    setLoading(true); setError('');
    try {
      const [selectedBranch, selectedPath] = JSON.parse(key) as [string, string];
      const result = await easyHub!.github<GitHubPage<GitHubCommit>>('sourceHistory', repo.owner.login, repo.name, { branch: selectedBranch, ...(selectedPath ? { path: selectedPath } : {}), page });
      if (!active.current || request.current !== generation) return;
      const merged = page === 1 ? result.items : appendCommits(cache.current.get(key)?.items ?? [], result.items);
      cache.current.set(key, { items: merged, nextPage: result.nextPage }); setItems(merged); setNextPage(result.nextPage);
    } catch (cause) { if (active.current && request.current === generation) setError(errorText(cause)); }
    finally { if (active.current && request.current === generation) setLoading(false); }
  }
  useEffect(() => { active.current = true; void loadBranches(1); return () => { active.current = false; request.current++; }; }, []);
  useEffect(() => {
    request.current++; setError('');
    const saved = cache.current.get(queryKey);
    if (saved) { setItems(saved.items); setNextPage(saved.nextPage); setLoading(false); }
    else { setItems([]); setNextPage(null); void load(1, queryKey); }
    return () => { request.current++; };
  }, [queryKey]);
  function changeFilter(nextBranch: string, nextPath: string): void { rememberScroll(); request.current++; setSelected(null); setBranch(nextBranch); setPath(nextPath); }
  return <div className="source-history-page" ref={root} data-testid="source-history">
    <button className="back-link" onClick={() => { rememberScroll(); history.back(onBack); }}><ArrowLeft size={17} />{selected ? t("sourceHistory.backToSourceHistory") : history.hasBack ? t("sourceHistory.back") : t("sourceHistory.backToProject")}</button>
    <div className="page-header"><div><div className="eyebrow" data-content-original>{repo.full_name}</div><h1>{t("sourceHistory.sourceHistory")}</h1><p>{t("sourceHistory.browseUpdatesAndCodeChangesCommittedToGithub")}</p></div></div>
    <NavigationPages active={selected ? `commit:${selected.sha}` : 'list'}>{selected ? <CommitChanges key={`${repo.id}:${selected.sha}`} repo={repo} item={selected} language={language} onFileHistory={file => changeFilter(branch, file)} /> : <>
      <div className="source-history-toolbar"><GitBranch size={18} /><StyledDropdown label={t("sourceHistory.selectBranch")} value={branch} options={[branch, ...branches.map(item => item.name)].filter((value, index, all) => all.indexOf(value) === index).map(value => ({ value, label: value }))} onChange={value => changeFilter(value, path)} disabled={branchBusy} />
        {branchNext && (branches.length > 0 || branchError) && <button className="text-link" disabled={branchBusy} onClick={() => void loadBranches(branchNext)}>{branchError ? t("sourceHistory.retryBranches") : t("sourceHistory.loadMoreBranches")}</button>}
        {path && <span className="source-history-path"><span data-content-original>{path}</span><button className="icon-button" aria-label={t("sourceHistory.showHistoryForAllFiles")} onClick={() => changeFilter(branch, '')}><X size={15} /></button></span>}
      </div>
      {branchError && <p className="muted" role="status"><ErrorMessage error={branchError} language={language} /></p>}
      <section className="panel source-history-list" aria-busy={loading}>
        {items.map(item => <button type="button" className="source-history-row" key={item.sha} onClick={() => { rememberScroll(); setSelected(item); }}>
          <span className="source-history-avatar" aria-hidden="true">{item.author?.avatar_url ? <img src={item.author.avatar_url} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} /> : <History size={18} />}</span>
          <span className="source-history-row-main"><strong data-content-original>{item.commit.message.split('\n')[0]}</strong><small><span data-content-original>{item.author?.login || item.commit.author?.name || t("sourceHistory.unknownAuthor")}</span> · {date(item.commit.author?.date, language)}</small></span>
          <code data-content-original>{item.sha.slice(0, 8)}</code><ChevronRight size={17} />
        </button>)}
        {loading && <p className="muted" role="status"><RotateCw size={16} className="live-spin" /> {t("sourceHistory.loadingCommits")}</p>}
        {error && <div className="live-error" role="alert"><ErrorMessage error={error} language={language} /><button className="text-link" disabled={loading} onClick={() => void load(items.length ? nextPage ?? 1 : 1)}>{t("sourceHistory.retry")}</button></div>}
        {!loading && !error && !items.length && <p className="muted">{path ? t("sourceHistory.thisFileHasNoCommitsOnThisBranch") : t("sourceHistory.thisBranchHasNoCommitsYet")}</p>}
        {nextPage && <button className="button button-quiet" disabled={loading} onClick={() => void load(nextPage)}>{t("sourceHistory.loadMoreCommits")}</button>}
      </section>
    </>}</NavigationPages>
  </div>;
}
