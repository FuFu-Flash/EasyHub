import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GitHubComment, GitHubCommit, GitHubIssue, GitHubRepo } from '@easyhub/github';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Clock3, Globe2, MessageCircle, Plus, RotateCw, X } from 'lucide-react';
import { ReadmeMarkdown } from './ReadmeMarkdown';
import { ReleaseDownloads } from './ReleaseDownloads';
import { readmeReleaseLink } from './readmeReleaseLink';
import { TranslatableContent } from './TranslatableContent';
import type { DownloadRequest } from './useDownloadCenter';
import type { Language } from '../i18n';

type Tab = 'intro' | 'issues' | 'history' | 'downloads';

function errorText(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请稍后重试。'; }

function PublicIssueConversation({ repo, issue, comments, protectedNames, reply, onReplyChange, onReply, replySaving }: {
  repo: GitHubRepo; issue: GitHubIssue; comments: GitHubComment[]; protectedNames: string[];
  reply: string; onReplyChange: (value: string) => void; onReply: (event: FormEvent) => void; replySaving: boolean;
}) {
  const markdown = (value: string) => <div className="intro-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>;
  return <div className="issue-detail public-issue-detail">
    <div className="issue-title"><span className={`issue-state ${issue.state === 'closed' ? 'closed' : ''}`}>{issue.state === 'open' ? '待处理' : '已解决'}</span>
      <TranslatableContent text={issue.title} format="text" protectedNames={protectedNames} render={(value) => <h1>{value}</h1>} />
      <p>{repo.name} · {issue.user?.login || 'GitHub 用户'} 提出于 {new Date(issue.created_at).toLocaleString()}</p>
    </div>
    <div className="conversation">
      <div className="message"><div className="avatar author-avatar">{(issue.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box">
        <div><strong>{issue.user?.login || 'GitHub 用户'}</strong><small>{new Date(issue.created_at).toLocaleString()}</small></div>
        {issue.body ? <TranslatableContent text={issue.body} format="markdown" paragraphMode protectedNames={protectedNames} render={markdown} /> : markdown('没有详细描述。')}
      </div></div>
      {comments.map((item) => <div className="message" key={item.id}><div className="avatar">{(item.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box">
        <div><strong>{item.user?.login || 'GitHub 用户'}</strong><small>{new Date(item.created_at).toLocaleString()}</small></div>
        <TranslatableContent text={item.body} format="markdown" paragraphMode protectedNames={protectedNames} render={markdown} />
      </div></div>)}
    </div>
    <form className="reply-card" onSubmit={onReply}><label htmlFor="public-issue-reply">写一条回复</label><textarea id="public-issue-reply" rows={4} value={reply} onChange={(event) => onReplyChange(event.target.value)} placeholder="说说你的想法或建议…" /><div><span /><button className="button button-primary" disabled={replySaving || !reply.trim()} type="submit">发送回复 <ArrowRight size={16} /></button></div></form>
  </div>;
}

export function PublicProjectBrowser({ repo, language, onBack, onOpenLink, onDownload, downloadBusy, startInDownloads = false, initialFocusTag }: {
  repo: GitHubRepo;
  language: Language;
  onBack: () => void;
  onOpenLink: (url: string) => void;
  onDownload: (request: DownloadRequest) => void;
  downloadBusy: boolean;
  startInDownloads?: boolean;
  initialFocusTag?: string;
}) {
  const [tab, setTab] = useState<Tab>(startInDownloads ? 'downloads' : 'intro');
  const [focusTag, setFocusTag] = useState<string | undefined>(initialFocusTag);
  const [readme, setReadme] = useState('');
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [selectedIssue, setSelectedIssue] = useState<GitHubIssue | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<GitHubCommit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issueError, setIssueError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [issueSaving, setIssueSaving] = useState(false);
  const [reply, setReply] = useState('');
  const [replySaving, setReplySaving] = useState(false);
  const owner = repo.owner.login;
  const issueAuthorNames = [selectedIssue?.user?.login, ...comments.map((item) => item.user?.login)].filter((name): name is string => Boolean(name));

  useEffect(() => {
    let active = true;
    setTab(startInDownloads ? 'downloads' : 'intro'); setFocusTag(initialFocusTag); setSelectedIssue(null); setSelectedCommit(null); setReadme(''); setIssues([]); setCommits([]); setError(''); setIssueError(''); setHistoryError(''); setShowIssueForm(false); setReply(''); setBusy(true);
    const github = window.easyHub?.github;
    if (!github) { setError('应用连接不可用，请重新启动 EasyHub。'); setBusy(false); return; }
    void Promise.allSettled([
      github<string>('readme', owner, repo.name),
      github<GitHubIssue[]>('issues', owner, repo.name, 'all'),
      github<GitHubCommit[]>('commits', owner, repo.name),
    ]).then(([intro, openIssues, history]) => {
      if (!active) return;
      if (intro.status === 'fulfilled') setReadme(intro.value);
      if (openIssues.status === 'fulfilled') setIssues(openIssues.value);
      if (history.status === 'fulfilled') setCommits(history.value);
      if (intro.status === 'rejected') setError(errorText(intro.reason));
      if (openIssues.status === 'rejected') setIssueError(errorText(openIssues.reason));
      if (history.status === 'rejected') setHistoryError(errorText(history.reason));
    })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner, repo.name, repo.id, startInDownloads, initialFocusTag]);

  async function showIssue(issue: GitHubIssue): Promise<void> {
    setSelectedIssue(issue); setComments([]); setReply(''); setError(''); setBusy(true);
    try { setComments(await window.easyHub!.github<GitHubComment[]>('comments', owner, repo.name, issue.number)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function sendReply(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedIssue || !reply.trim() || !window.easyHub) return;
    setReplySaving(true); setError('');
    try {
      const comment = await window.easyHub.github<GitHubComment>('createComment', owner, repo.name, selectedIssue.number, reply.trim());
      setComments((items) => [...items, comment]); setReply('');
      setIssues((items) => items.map((item) => item.id === selectedIssue.id ? { ...item, comments: item.comments + 1 } : item));
    } catch (cause) { setError(errorText(cause)); }
    finally { setReplySaving(false); }
  }

  async function createIssue(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!issueTitle.trim() || !window.easyHub) return;
    setIssueSaving(true); setIssueError('');
    try {
      const created = await window.easyHub.github<GitHubIssue>('createIssue', owner, repo.name, issueTitle.trim(), issueBody.trim());
      setIssues((items) => [created, ...items]);
      setIssueTitle(''); setIssueBody(''); setShowIssueForm(false);
    } catch (cause) { setIssueError(errorText(cause)); }
    finally { setIssueSaving(false); }
  }

  async function showVersion(item: GitHubCommit): Promise<void> {
    setSelectedCommit(item); setError(''); setBusy(true);
    try { setSelectedCommit(await window.easyHub!.github<GitHubCommit>('commit', owner, repo.name, item.sha)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  function openReadmeLink(url: string): void {
    const release = readmeReleaseLink(url);
    if (release && release.owner.toLowerCase() === owner.toLowerCase() && release.repo.toLowerCase() === repo.name.toLowerCase()) {
      setFocusTag(release.tag); setTab('downloads');
    } else onOpenLink(url);
  }

  if (tab === 'downloads') return <div className="public-browser" data-testid="public-project-browser"><ReleaseDownloads repo={repo} focusTag={focusTag} offerAdd onDownload={onDownload} downloadBusy={downloadBusy} onBack={() => setTab('intro')} /></div>;
  if (tab === 'issues' && selectedIssue) return <div className="public-issue-page" data-testid="public-project-browser">
    <button className="back-link" onClick={() => setSelectedIssue(null)}><ArrowLeft size={16} />返回问题</button>
    {error && <div className="live-error" role="alert">{error}</div>}
    {busy && <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取问题内容…</p>}
    <PublicIssueConversation repo={repo} issue={selectedIssue} comments={comments} protectedNames={issueAuthorNames} reply={reply} onReplyChange={setReply} onReply={(event) => void sendReply(event)} replySaving={replySaving} />
  </div>;

  return <div className="public-browser" data-testid="public-project-browser">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回搜索结果</button>
    <section className="detail-hero public-browser-hero"><div className="detail-main"><span className="project-logo logo-sky" aria-hidden="true">{repo.name.slice(0, 1).toUpperCase()}</span><div><div className="detail-name-row"><h1>{repo.full_name}</h1><span className="visibility-label"><Globe2 size={13} />公开项目</span></div>{repo.description ? <TranslatableContent text={repo.description} format="text" render={(value) => <p>{value}</p>} /> : <p>还没有项目介绍</p>}<span className="public-readonly-label">项目内容只读 · 可以提出问题和下载</span></div></div><div className="detail-actions"><button className="button button-primary" onClick={() => { setFocusTag(undefined); setTab('downloads'); }}><ArrowDownToLine size={17} />下载项目</button></div></section>
    {error && <div className="live-error" role="alert">{error}</div>}
    <nav className="public-browser-tabs" aria-label="项目内容"><button className={tab === 'intro' ? 'selected' : ''} onClick={() => setTab('intro')}>项目介绍</button><button className={tab === 'issues' ? 'selected' : ''} onClick={() => setTab('issues')}>问题 <span>{issues.length}</span></button><button className={tab === 'history' ? 'selected' : ''} onClick={() => setTab('history')}>历史版本</button></nav>
    <section className="panel public-browser-content">
      {busy && <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取项目内容…</p>}
      {tab === 'intro' && <><div className="panel-heading"><h2>项目介绍</h2></div>{readme ? <TranslatableContent text={readme} format="markdown" paragraphMode render={(value) => <ReadmeMarkdown markdown={value} repository={{ owner, name: repo.name, branch: repo.default_branch }} onOpenLink={openReadmeLink} />} /> : !busy && <p className="muted">这个项目还没有介绍。</p>}</>}
      {tab === 'issues' && <><div className="panel-heading"><h2>问题</h2><button className="button button-primary" onClick={() => setShowIssueForm(true)}><Plus size={16} />提出问题</button></div>{issueError && <p className="live-error" role="alert">{issueError}</p>}{issues.map((item) => <button className="public-list-row" key={item.id} onClick={() => void showIssue(item)}><MessageCircle size={19} /><span><TranslatableContent text={item.title} format="text" protectedNames={item.user?.login ? [item.user.login] : []} render={(value) => <strong>{value}</strong>} /><small>{item.state === 'open' ? '待处理' : '已解决'} · {item.user?.login || 'GitHub 用户'}</small></span><ArrowRight size={17} /></button>)}{issues.length === 0 && !busy && !issueError && <p className="muted">这个项目还没有问题。</p>}</>}
      {tab === 'history' && <>{selectedCommit ? <><button className="back-link" onClick={() => setSelectedCommit(null)}><ArrowLeft size={16} />返回历史版本</button><h2>{selectedCommit.commit.message.split('\n')[0]}</h2><p className="muted">{selectedCommit.commit.author?.name || '未知作者'} · {selectedCommit.commit.author?.date ? new Date(selectedCommit.commit.author.date).toLocaleString() : ''}</p><p className="muted">修改文件：{selectedCommit.files?.length ?? '—'} · 新增 {selectedCommit.stats?.additions ?? '—'} 行 · 删除 {selectedCommit.stats?.deletions ?? '—'} 行</p>{selectedCommit.files?.map((file) => <div className="live-file" key={file.filename}>{file.filename}</div>)}</> : <><div className="panel-heading"><h2>历史版本</h2></div>{historyError && <p className="live-error" role="alert">{historyError}</p>}{commits.map((item) => <button className="public-list-row" key={item.sha} onClick={() => void showVersion(item)}><Clock3 size={19} /><span><strong>{item.commit.message.split('\n')[0]}</strong><small>{item.commit.author?.date ? new Date(item.commit.author.date).toLocaleString() : ''}</small></span><ArrowRight size={17} /></button>)}{commits.length === 0 && !busy && !historyError && <p className="muted">还没有历史版本。</p>}</>}</>}
    </section>
    {showIssueForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !issueSaving) setShowIssueForm(false); }}><form className="modal issue-modal" role="dialog" aria-modal="true" aria-labelledby="public-new-issue-title" onSubmit={(event) => void createIssue(event)}><button type="button" className="icon-button modal-close" aria-label="关闭" disabled={issueSaving} onClick={() => setShowIssueForm(false)}><X size={19} /></button><h2 id="public-new-issue-title">提出问题</h2><p>{language === 'en' ? `Describe your problem or suggestion to the author of ${repo.full_name}.` : `向 ${repo.full_name} 的作者描述你遇到的情况或建议。`}</p><label className="field"><span>问题标题</span><input value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} required maxLength={256} placeholder="一句话概括问题" /></label><label className="field"><span>详细描述</span><textarea rows={5} value={issueBody} onChange={(event) => setIssueBody(event.target.value)} maxLength={65536} placeholder="发生了什么？你希望怎样改进？" /></label>{issueError && <p className="live-error" role="alert">{issueError}</p>}<div className="modal-actions"><button type="button" className="button button-quiet" disabled={issueSaving} onClick={() => setShowIssueForm(false)}>取消</button><button type="submit" className="button button-primary" disabled={issueSaving || !issueTitle.trim()}>创建问题</button></div></form></div>}
  </div>;
}
