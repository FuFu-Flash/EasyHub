import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GitHubComment, GitHubPullFile, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { ArrowLeft, ArrowRight, GitPullRequest, Plus, RotateCw, X } from 'lucide-react';
import { TranslatableContent } from './TranslatableContent';

function errorText(error: unknown): string { return error instanceof Error ? error.message : '暂时无法完成操作，请稍后重试。'; }

export function PullRequestsPanel({ repo, currentUser, showCreateButton = true, refreshKey = 0 }: { repo: GitHubRepo; currentUser: string; showCreateButton?: boolean; refreshKey?: number }) {
  const [items, setItems] = useState<GitHubPullRequest[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<GitHubPullRequest | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [files, setFiles] = useState<GitHubPullFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceOwner, setSourceOwner] = useState(currentUser);
  const [sourceBranch, setSourceBranch] = useState('');
  const [base, setBase] = useState(repo.default_branch);
  const [saving, setSaving] = useState(false);
  const owner = repo.owner.login;
  const markdown = (value: string) => <div className="intro-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>;

  useEffect(() => {
    let active = true;
    setItems([]); setSelected(null); setComments([]); setFiles([]); setPage(1); setHasMore(false); setError(''); setSourceOwner(currentUser); setBase(repo.default_branch); setBusy(true);
    void window.easyHub!.github<GitHubPullRequest[]>('pullRequests', owner, repo.name, 1).then((result) => {
      if (!active) return;
      setItems(result); setHasMore(result.length === 100);
    }).catch((cause) => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [owner, repo.name, repo.default_branch, currentUser, refreshKey]);

  async function loadMore(): Promise<void> {
    if (!hasMore || busy) return;
    setBusy(true); setError('');
    try {
      const next = page + 1;
      const result = await window.easyHub!.github<GitHubPullRequest[]>('pullRequests', owner, repo.name, next);
      setItems((current) => [...current, ...result.filter((item) => !current.some((known) => known.id === item.id))]);
      setPage(next); setHasMore(result.length === 100);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function open(item: GitHubPullRequest): Promise<void> {
    setSelected(item); setComments([]); setFiles([]); setBusy(true); setError('');
    try {
      const [detail, discussion, changes] = await Promise.all([
        window.easyHub!.github<GitHubPullRequest>('pullRequest', owner, repo.name, item.number),
        window.easyHub!.github<GitHubComment[]>('comments', owner, repo.name, item.number),
        window.easyHub!.github<GitHubPullFile[]>('pullFiles', owner, repo.name, item.number),
      ]);
      setSelected(detail); setComments(discussion); setFiles(changes);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !sourceOwner.trim() || !sourceBranch.trim() || !base.trim() || saving) return;
    setSaving(true); setError('');
    try {
      const created = await window.easyHub!.github<GitHubPullRequest>('createPullRequest', owner, repo.name, {
        title: title.trim(), body: body.trim(), head: `${sourceOwner.trim()}:${sourceBranch.trim()}`, base: base.trim(),
      });
      setItems((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setShowForm(false); setTitle(''); setBody(''); setSourceBranch('');
      await open(created);
    } catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  }

  return <section className="panel public-browser-content pull-requests-panel">
    {selected ? <>
      <button className="back-link" onClick={() => { setSelected(null); setError(''); }}><ArrowLeft size={16} />返回改进请求</button>
      <div className="issue-detail public-issue-detail">
        <div className="issue-title"><span className={`issue-state ${selected.state === 'closed' ? 'closed' : ''}`}>{selected.merged ? '已采纳' : selected.state === 'open' ? selected.draft ? '草稿' : '待审阅' : '已关闭'}</span>{repo.private ? <h1>{selected.title}</h1> : <TranslatableContent text={selected.title} format="text" render={(value) => <h1>{value}</h1>} />}<p>{selected.user?.login || 'GitHub 用户'} · {selected.head?.label || selected.head?.ref} → {selected.base?.ref}</p></div>
        {busy && <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取内容…</p>}
        {error && <p className="live-error" role="alert">{error}</p>}
        <div className="conversation"><div className="message"><div className="avatar author-avatar">{(selected.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{selected.user?.login || 'GitHub 用户'}</strong><small>{new Date(selected.created_at).toLocaleString()}</small></div>{selected.body ? repo.private ? markdown(selected.body) : <TranslatableContent text={selected.body} format="markdown" paragraphMode render={markdown} /> : <p className="muted">没有详细描述。</p>}</div></div>{comments.map((comment) => <div className="message" key={comment.id}><div className="avatar">{(comment.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{comment.user?.login || 'GitHub 用户'}</strong><small>{new Date(comment.created_at).toLocaleString()}</small></div>{repo.private ? markdown(comment.body) : <TranslatableContent text={comment.body} format="markdown" paragraphMode render={markdown} />}</div></div>)}</div>
        <div className="pull-files"><h3>修改的文件 {selected.changed_files ?? files.length}</h3>{files.map((file) => <div className="live-file" key={file.filename}>{file.filename}<small>+{file.additions} / −{file.deletions}</small></div>)}</div>
      </div>
    </> : <>
      <div className="panel-heading"><div><h2>改进请求</h2><p className="muted">查看大家提议合入项目的修改。</p></div>{showCreateButton && <button className="button button-primary" onClick={() => { setError(''); setShowForm(true); }}><Plus size={16} />提出改进请求</button>}</div>
      {error && <p className="live-error" role="alert">{error}</p>}
      {items.map((item) => <button className="public-list-row" key={item.id} onClick={() => void open(item)}><GitPullRequest size={19} /><span>{repo.private ? <strong>{item.title}</strong> : <TranslatableContent text={item.title} format="text" render={(value) => <strong>{value}</strong>} />}<small>{item.merged_at ? '已采纳' : item.state === 'open' ? item.draft ? '草稿' : '待审阅' : '已关闭'} · {item.user?.login || 'GitHub 用户'}</small></span><ArrowRight size={17} /></button>)}
      {!busy && !error && items.length === 0 && <p className="muted">这个项目还没有改进请求。</p>}
      {busy && <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取改进请求…</p>}
      {hasMore && <button className="button button-quiet pull-more" disabled={busy} onClick={() => void loadMore()}>加载更多</button>}
    </>}
    {showForm && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setShowForm(false); }}><form className="modal issue-modal" role="dialog" aria-modal="true" aria-labelledby="new-pull-title" onSubmit={(event) => void create(event)}><button type="button" className="icon-button modal-close" aria-label="关闭" disabled={saving} onClick={() => setShowForm(false)}><X size={19} /></button><h2 id="new-pull-title">提出改进请求</h2><p>先把修改保存到 GitHub，再选择包含这些修改的来源。</p><label className="field"><span>标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={256} required placeholder="一句话说明改进内容" /></label><label className="field"><span>详细描述</span><textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} maxLength={65536} placeholder="介绍修改的原因和效果" /></label><div className="pull-source-fields"><label className="field"><span>来源账户</span><input value={sourceOwner} onChange={(event) => setSourceOwner(event.target.value)} required placeholder="GitHub 用户名" /></label><label className="field"><span>来源版本</span><input value={sourceBranch} onChange={(event) => setSourceBranch(event.target.value)} required placeholder="例如 fix-search" /></label></div><label className="field"><span>合入到</span><input value={base} onChange={(event) => setBase(event.target.value)} required placeholder={repo.default_branch} /></label><p className="muted">来源必须是 GitHub 上已有的修改版本。对于他人的项目，先在自己的同名项目副本中准备修改。</p>{error && <p className="live-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-quiet" disabled={saving} onClick={() => setShowForm(false)}>取消</button><button type="submit" className="button button-primary" disabled={saving || !title.trim() || !sourceBranch.trim()}>提交改进请求</button></div></form></div>}
  </section>;
}
