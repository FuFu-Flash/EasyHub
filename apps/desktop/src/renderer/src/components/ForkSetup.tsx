import { useEffect, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { ArrowRight, GitFork, RotateCw } from 'lucide-react';

function errorText(error: unknown): string { return error instanceof Error ? error.message : '暂时无法创建仓库副本，请稍后重试。'; }

export function ForkSetup({ source, currentUser, onReady }: { source: GitHubRepo; currentUser: string; onReady: (fork: GitHubRepo) => void }) {
  const [name, setName] = useState(source.name);
  const [existing, setExisting] = useState<GitHubRepo | null>(null);
  const [checking, setChecking] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setChecking(true); setExisting(null); setError(''); setName(source.name);
    void window.easyHub!.github<GitHubRepo | null>('myFork', source.owner.login, source.name)
      .then((fork) => { if (active) setExisting(fork); })
      .catch((cause) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [source.id, source.owner.login, source.name]);

  async function create(): Promise<void> {
    if (creating || checking || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..') return;
    setCreating(true); setError('');
    try {
      const fork = await window.easyHub!.github<GitHubRepo>('forkRepo', source.owner.login, source.name, name.trim());
      onReady(fork);
    } catch (cause) { setError(errorText(cause)); }
    finally { setCreating(false); }
  }

  return <div className="fork-setup">
    <div className="fork-relationship"><span><small>原项目</small><strong>{source.full_name}</strong></span><ArrowRight size={18} /><span><small>你的仓库副本</small><strong>{currentUser}/{existing?.name || name || source.name}</strong></span></div>
    <p>EasyHub 会在你的 GitHub 账号下创建副本。之后可以下载到电脑、修改文件并发布源码，再把改进提交给原项目作者。</p>
    {checking ? <p className="live-loading"><RotateCw size={16} className="live-spin" />正在查找已有的仓库副本…</p> : existing ? <>
      <p className="fork-existing"><GitFork size={17} />已经有一个关联的仓库副本：{existing.full_name}</p>
      <button type="button" className="button button-primary" onClick={() => onReady(existing)}>打开仓库副本 <ArrowRight size={16} /></button>
    </> : <>
      <label className="field"><span>副本名称</span><input aria-label="副本名称" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} disabled={creating} /></label>
      <small>仅复制主要版本。原项目保持不变，副本归你管理。</small>
      <button type="button" className="button button-primary" disabled={creating || !/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..'} onClick={() => void create()}>{creating ? '正在创建仓库副本…' : '创建仓库副本'} <ArrowRight size={16} /></button>
    </>}
    {error && <p className="live-error" role="alert">{error}</p>}
  </div>;
}
