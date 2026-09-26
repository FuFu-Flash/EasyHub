import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { GitHubForkComparison, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { ArrowRight, ExternalLink, GitFork, RotateCw } from 'lucide-react';

function errorText(error: unknown): string { return error instanceof Error ? error.message : '暂时无法检查仓库副本，请稍后重试。'; }

export function ForkContributionPanel({ repo, localLinkId, suggestedTitle, onOpenLocal, onBrowseOriginal, onOpenExternal }: {
  repo: GitHubRepo; localLinkId?: string; suggestedTitle: string; onOpenLocal: () => void; onBrowseOriginal: (owner: string, name: string) => void; onOpenExternal: (url: string) => void;
}) {
  const [detail, setDetail] = useState<GitHubRepo | null>(repo.parent ? repo : null);
  const [comparison, setComparison] = useState<GitHubForkComparison | null>(null);
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [created, setCreated] = useState<GitHubPullRequest | null>(null);
  const [pendingLocalFiles, setPendingLocalFiles] = useState(0);

  async function refresh(): Promise<void> {
    setChecking(true); setError('');
    try {
      const fork = await window.easyHub!.github<GitHubRepo>('repository', repo.owner.login, repo.name);
      if (!fork.fork || !fork.parent) throw new Error('找不到这个副本对应的原项目。');
      setDetail(fork);
      const [difference, local] = await Promise.all([
        window.easyHub!.github<GitHubForkComparison>('forkComparison', repo.owner.login, repo.name),
        localLinkId ? window.easyHub!.localStatus(localLinkId) : Promise.resolve(null),
      ]);
      setComparison(difference); setPendingLocalFiles(local?.files.length ?? 0);
    } catch (cause) { setError(errorText(cause)); }
    finally { setChecking(false); }
  }

  useEffect(() => { void refresh(); }, [repo.id, repo.owner.login, repo.name, localLinkId]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !comparison?.ahead_by || saving) return;
    setSaving(true); setError('');
    try {
      if (localLinkId) {
        const local = await window.easyHub!.localStatus(localLinkId);
        if (local.files.length > 0) { setPendingLocalFiles(local.files.length); throw new Error('这台电脑还有未发布的修改，请先发布源码。'); }
      }
      const result = await window.easyHub!.github<GitHubPullRequest>('submitForkContribution', repo.owner.login, repo.name, title.trim(), body.trim());
      setCreated(result);
    } catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  }

  const parent = detail?.parent;
  const activeRequest = created ?? comparison?.openRequest;
  return <section className="panel fork-contribution" data-testid="fork-contribution">
    <div className="panel-heading"><div><h2><GitFork size={19} />仓库副本</h2><p className="muted">在这里准备修改，再把改进交给原项目作者审阅。</p></div></div>
    {parent && <>
      <div className="fork-relationship"><span><small>原项目</small><button className="plain-heading" onClick={() => onBrowseOriginal(parent.owner.login, parent.name)}>{parent.full_name}</button><button className="fork-link" onClick={() => onOpenExternal(parent.html_url)} aria-label="在 GitHub 打开原项目"><ExternalLink size={14} /></button></span><ArrowRight size={18} /><span><small>你的仓库副本</small><strong>{detail.full_name}</strong><button className="fork-link" onClick={() => onOpenExternal(detail.html_url || `https://github.com/${detail.full_name}`)} aria-label="在 GitHub 打开仓库副本"><ExternalLink size={14} /></button></span></div>
      <p className="fork-branch-line">版本关系：原项目 {parent.default_branch} → 仓库副本 {detail.default_branch}</p>
    </>}
    {checking ? <p className="live-loading"><RotateCw size={16} className="live-spin" />正在核对两个项目的修改…</p> : comparison ? <>
      <div className="fork-change-summary"><strong>{comparison.ahead_by} 次待提交的更新</strong><span>{comparison.files?.length ?? 0} 个文件与原项目不同</span><button className="text-link" disabled={saving} onClick={() => void refresh()}>刷新</button></div>
      {comparison.files?.slice(0, 8).map((file) => <div className="live-file" key={file.filename}>{file.filename}<small>+{file.additions} / −{file.deletions}</small></div>)}
      {pendingLocalFiles > 0 ? <p className="live-error">这台电脑还有 {pendingLocalFiles} 个文件未发布。先发布源码，再提交改进。</p> : comparison.ahead_by === 0 ? <p className="muted">还没有可以提交的代码改进。先下载仓库副本，修改文件并发布源码。</p> : activeRequest ? <div className="public-proposal-notice">{created ? '改进请求已提交。' : '这个副本的改进请求正在等待审阅。'}<button className="text-link" onClick={() => onOpenExternal(activeRequest.html_url)}>在 GitHub 查看 <ExternalLink size={15} /></button></div> : <form className="fork-submit-form" onSubmit={(event) => void submit(event)}><label className="field"><span>改进标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={256} required placeholder={suggestedTitle || '一句话说明改了什么'} /></label><label className="field"><span>详细描述</span><textarea rows={4} value={body} onChange={(event) => setBody(event.target.value)} maxLength={65536} placeholder="说明修改的原因和效果" /></label><button type="submit" className="button button-primary" disabled={saving || !title.trim()}>{saving ? '正在提交…' : '向原项目提交改进'} <ArrowRight size={16} /></button></form>}
    </> : null}
    <button className="button button-quiet" onClick={onOpenLocal}>下载或打开本地副本 <ArrowRight size={16} /></button>
    {error && <p className="live-error" role="alert">{error}</p>}
  </section>;
}
