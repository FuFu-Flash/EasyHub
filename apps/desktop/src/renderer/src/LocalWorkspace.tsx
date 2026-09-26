import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import type { FolderInspection, LocalOperationProgress, LocalProjectLink, LocalProjectStatus, SyncDecision, SyncPreview } from '@easyhub/types';
import { ArrowLeft, Check, CheckCircle2, Download, FolderOpen, Globe2, LockKeyhole, Plus, RotateCw, Send } from 'lucide-react';

interface Props {
  mode: 'list' | 'create';
  repos: GitHubRepo[];
  selectedRepo: GitHubRepo | null;
  onBack: () => void;
  onCreated: () => Promise<void>;
  onDownloadProject: (repo: GitHubRepo) => Promise<void>;
  downloadBusy: boolean;
  initialSyncReview?: { id: string; preview: SyncPreview; message: string } | null;
  onSyncReviewOpened?: () => void;
}

const fileVerb = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' } as const;
function errorText(error: unknown): string { return error instanceof Error ? error.message : '操作失败，请稍后重试。'; }

export function LocalWorkspace({ mode, repos, selectedRepo, onBack, onCreated, onDownloadProject, downloadBusy, initialSyncReview, onSyncReviewOpened }: Props) {
  const [links, setLinks] = useState<LocalProjectLink[]>([]);
  const [statuses, setStatuses] = useState<Record<string, LocalProjectStatus>>({});
  const [inspection, setInspection] = useState<FolderInspection | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [publishId, setPublishId] = useState<string | null>(null);
  const [expandedRepoId, setExpandedRepoId] = useState<number | null>(selectedRepo?.id ?? null);
  const [syncReview, setSyncReview] = useState<{ id: string; preview: SyncPreview } | null>(null);
  const [syncChoices, setSyncChoices] = useState<Record<string, SyncDecision['choice']>>({});
  const [showDifferences, setShowDifferences] = useState<Record<string, boolean>>({});
  const [publishAfterSync, setPublishAfterSync] = useState<string | null>(null);
  const [updateMessage, setUpdateMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<LocalOperationProgress | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const api = window.easyHub;

  const refresh = useCallback(async () => {
    if (!api) return;
    const items = await api.localList();
    setLinks(items);
    for (const item of items) {
      try { const status = await api.localStatus(item.id); setStatuses((old) => ({ ...old, [item.id]: status })); }
      catch { /* The folder may have moved. The publish action will show a precise error. */ }
    }
  }, [api]);

  useEffect(() => { void refresh().catch((cause) => setError(errorText(cause))); }, [refresh]);
  useEffect(() => {
    if (!initialSyncReview) return;
    setSyncReview({ id: initialSyncReview.id, preview: initialSyncReview.preview });
    setPublishAfterSync(initialSyncReview.message ? initialSyncReview.id : null);
    setPublishId(initialSyncReview.message ? initialSyncReview.id : null);
    setUpdateMessage(initialSyncReview.message);
    onSyncReviewOpened?.();
  }, [initialSyncReview, onSyncReviewOpened]);
  useEffect(() => {
    const stopProgress = api?.onLocalProgress(setProgress);
    const stopStatus = api?.onLocalStatus(({ id, status }) => setStatuses((old) => ({ ...old, [id]: status })));
    return () => { stopProgress?.(); stopStatus?.(); };
  }, [api]);

  async function task(work: () => Promise<void>): Promise<void> {
    setBusy(true); setError(''); setNotice(''); setProgress(null);
    try { await work(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); setProgress(null); }
  }

  async function chooseFolder(): Promise<void> {
    if (!api) return;
    await task(async () => {
      const path = await api.chooseFolder();
      if (!path) return;
      const result = await api.localInspect(path);
      setInspection(result);
      setName(result.name ?? path.split(/[\\/]/).filter(Boolean).at(-1) ?? '');
      if (result.state === 'github') {
        const link = await api.localConnect(path);
        setInspection(null); setNotice(`${link.name} 已添加到我的项目。`); await refresh();
      }
    });
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault(); if (!api || !inspection) return;
    await task(async () => {
      const link = await api.localCreate(inspection.path, name.trim(), description.trim(), isPrivate);
      setInspection(null); setName(''); setDescription('');
      setNotice(`${link.name} 创建成功，文件已发布到 GitHub。`);
      await refresh(); await onCreated();
    });
  }

  async function download(repo: GitHubRepo): Promise<void> {
    await onDownloadProject(repo);
    try { await refresh(); }
    catch (cause) { setError(errorText(cause)); }
  }

  async function publish(event: FormEvent, item: LocalProjectLink): Promise<void> {
    event.preventDefault(); if (!api) return;
    await task(async () => {
      const preview = await api.localCheckSync(item.id);
      if (preview.state === 'blocked') { setError(preview.message ?? '暂时无法安全发布。'); return; }
      if (preview.state === 'review') { setSyncReview({ id: item.id, preview }); setSyncChoices({}); setPublishAfterSync(item.id); return; }
      const result = await api.localPublish(item.id, updateMessage.trim());
      setPublishId(null); setUpdateMessage('');
      setNotice(`发布成功，${result.changed} 个文件已保存到 GitHub。`);
      await refresh(); await onCreated();
    });
  }

  async function checkLatest(item: LocalProjectLink): Promise<void> {
    if (!api) return;
    await task(async () => {
      const preview = await api.localCheckSync(item.id);
      if (preview.state === 'blocked') { setError(preview.message ?? '暂时无法安全获取最新内容。'); return; }
      if (preview.state === 'current') { setNotice('这个项目已经是最新的。'); setSyncReview(null); return; }
      if (preview.state === 'review') { setSyncReview({ id: item.id, preview }); setSyncChoices({}); setShowDifferences({}); setPublishAfterSync(null); return; }
      const result = await api.localSync(item.id, preview.remoteRevision, []);
      setNotice(`已获取 GitHub 上的最新内容，更新了 ${result.updated} 个文件。`);
      await refresh();
    });
  }

  async function confirmSync(item: LocalProjectLink): Promise<void> {
    if (!api || syncReview?.id !== item.id) return;
    const review = syncReview.preview;
    if (review.files.some((file) => !syncChoices[file.path])) { setError('请先为每个文件选择要保留的版本。'); return; }
    await task(async () => {
      const decisions = review.files.map((file) => ({ path: file.path, choice: syncChoices[file.path]! }));
      const result = await api.localSync(item.id, review.remoteRevision, decisions);
      setSyncReview(null); setSyncChoices({});
      if (publishAfterSync === item.id) {
        const published = await api.localPublish(item.id, updateMessage.trim());
        setPublishId(null); setUpdateMessage(''); setPublishAfterSync(null);
        setNotice(`已获取最新内容并发布更新，${published.changed} 个文件已保存到 GitHub。`);
        await onCreated();
      } else setNotice(`已获取最新内容，更新了 ${result.updated} 个文件。`);
      await refresh();
    });
  }

  const visibleLinks = selectedRepo ? links.filter((item) => item.repositoryId === selectedRepo.id) : links;
  const visibleRepos = selectedRepo ? [selectedRepo] : repos;
  return <div className="local-workspace">
    <button className="back-link" onClick={onBack}><ArrowLeft size={17} />返回</button>
    <div className="page-header"><div><h1>{mode === 'create' ? '新建项目' : selectedRepo?.name ?? '本地项目'}</h1><p>{mode === 'create' ? '选择一个文件夹，EasyHub 会把它保存到 GitHub。' : '查看本地文件的修改并发布源码。'}</p></div></div>
    {error && <div className="live-error" role="alert">{error}</div>}
    {notice && <div className="live-notice" role="status">{notice}</div>}
    {busy && <div className="live-loading" role="status"><RotateCw size={16} className="live-spin" />{progress?.phase ?? '正在处理…'}{progress?.total ? ` ${Math.round(100 * (progress.loaded ?? 0) / progress.total)}%` : ''}{progress?.cancelable !== false && <button className="text-link" onClick={() => void api?.localCancel()}>取消</button>}</div>}
    {mode === 'list' && !selectedRepo && <section className="panel live-section"><div className="panel-heading"><h2>添加现有文件夹</h2></div><p>EasyHub 会检查文件夹，已有的 GitHub 项目会直接加入。</p><button className="button button-quiet" disabled={busy} onClick={() => void chooseFolder()}><FolderOpen size={17} />选择文件夹</button></section>}
    {(mode === 'create' || inspection && inspection.state !== 'github') && <form className="panel live-form live-create-form" onSubmit={(event) => void create(event)}>
      <h2>{inspection?.state === 'existing' ? '要把这个文件夹创建成一个新项目吗？' : '创建项目'}</h2>
      <label className="field"><span>项目名称</span><input aria-label="项目名称" value={name} required maxLength={100} onChange={(event) => setName(event.target.value)} /></label>
      <label className="field"><span>一句介绍</span><input aria-label="一句介绍" value={description} maxLength={350} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="field"><span>本地文件夹</span><div className="folder-field"><FolderOpen size={19} /><span title={inspection?.path ?? ''}>{inspection?.path || '还没有选择文件夹'}</span><button type="button" className="button button-quiet" disabled={busy} onClick={() => void chooseFolder()}>选择文件夹</button></div></div>
      <div className="field"><span>谁能看到？</span><div className="choice-grid" role="group" aria-label="谁能看到？"><button type="button" className={`choice ${isPrivate ? 'chosen' : ''}`} aria-pressed={isPrivate} onClick={() => setIsPrivate(true)}><span className="choice-circle">{isPrivate && <Check size={13} />}</span><LockKeyhole size={18} /><strong>只有我</strong><small>仅自己可见</small></button><button type="button" className={`choice ${!isPrivate ? 'chosen' : ''}`} aria-pressed={!isPrivate} onClick={() => setIsPrivate(false)}><span className="choice-circle">{!isPrivate && <Check size={13} />}</span><Globe2 size={18} /><strong>所有人</strong><small>可以分享给别人</small></button></div></div>
      <button className="button button-primary submit-button" disabled={busy || !name.trim() || !inspection || inspection.state === 'github'} type="submit"><Plus size={17} />创建项目</button>
    </form>}
    {visibleLinks.map((item) => { const status = statuses[item.id]; return <section className="panel live-section local-project-card" key={item.id}>
      <div className="panel-heading"><h2>{item.name}</h2><span className="muted">{status ? status.files.length ? `${status.files.length} 个文件还没发布` : '已保存' : '正在检查文件'}</span></div>
      <p className="muted">{item.localPath}</p>
      <div className="local-actions"><button className="button button-quiet" disabled={busy} onClick={() => void api?.localOpenFolder(item.id)}><FolderOpen size={16} />打开文件夹</button><button className="button button-quiet" disabled={busy} onClick={() => { setExpandedRepoId(item.repositoryId); void task(async () => { if (api) { const next = await api.localStatus(item.id); setStatuses((old) => ({ ...old, [item.id]: next })); } }); }}><RotateCw size={16} />查看修改</button><button className="button button-quiet" disabled={busy} onClick={() => void checkLatest(item)}><RotateCw size={16} />获取最新</button>{status?.files.length ? <button className="button button-primary" disabled={busy} onClick={() => { setExpandedRepoId(item.repositoryId); setPublishId(item.id); setUpdateMessage(''); }}><Send size={16} />发布源码</button> : null}</div>
      {expandedRepoId === item.repositoryId && status && <div className="local-changes"><div className="local-changes-heading"><strong>尚未发布的修改</strong><span>{status.files.filter((file) => file.kind === 'modified').length} 个修改 · {status.files.filter((file) => file.kind === 'added').length} 个新增 · {status.files.filter((file) => file.kind === 'deleted').length} 个删除{status.files.some((file) => file.kind === 'renamed') ? ` · ${status.files.filter((file) => file.kind === 'renamed').length} 个重命名` : ''}</span></div>{status.files.length ? <div className="local-file-list">{status.files.map((file) => <div key={file.path}><span>{fileVerb[file.kind]}</span>{file.previousPath ? `${file.previousPath} → ` : ''}{file.path}</div>)}</div> : <p className="muted">目前没有尚未发布的修改。</p>}</div>}
      {status?.needsReview && <p className="live-error">这个文件夹有其他工具准备的修改，请先在该工具中完成或取消。</p>}
      {syncReview?.id === item.id && <div className="sync-review"><h3>有内容需要确认</h3><p>这些文件在另一台电脑上也修改过。请查看内容，再选择要保留的版本。</p>{syncReview.preview.files.map((file) => <div className="sync-review-file" key={file.path}><strong>{file.path}</strong><div className="local-actions"><button className="button button-quiet" type="button" onClick={() => setShowDifferences((old) => ({ ...old, [file.path]: !old[file.path] }))}>{showDifferences[file.path] ? '收起不同' : '查看不同'}</button><button className={`button ${syncChoices[file.path] === 'mine' ? 'button-primary' : 'button-quiet'}`} type="button" onClick={() => setSyncChoices((old) => ({ ...old, [file.path]: 'mine' }))}>保留我的</button><button className={`button ${syncChoices[file.path] === 'github' ? 'button-primary' : 'button-quiet'}`} type="button" onClick={() => setSyncChoices((old) => ({ ...old, [file.path]: 'github' }))}>使用 GitHub 版本</button></div>{showDifferences[file.path] && <div className="sync-review-diff"><div><span>你的版本</span><pre>{file.mine ?? '这个版本没有该文件。'}</pre></div><div><span>GitHub 上的版本</span><pre>{file.github ?? '这个版本没有该文件。'}</pre></div></div>}</div>)}<div className="local-actions"><button className="button button-quiet" type="button" onClick={() => { setSyncReview(null); setPublishAfterSync(null); }}>稍后处理</button><button className="button button-primary" type="button" disabled={busy || syncReview.preview.files.some((file) => !syncChoices[file.path])} onClick={() => void confirmSync(item)}>确认并获取最新</button></div></div>}
      {publishId === item.id && status && <form className="local-publish" onSubmit={(event) => void publish(event, item)}><h3>发布源码</h3><p>把日常代码修改保存到 GitHub。</p><label className="field"><span>这次改了什么？</span><input aria-label="这次改了什么？" required maxLength={200} value={updateMessage} onChange={(event) => setUpdateMessage(event.target.value)} placeholder="例如：修复窗口缩放问题" /></label><div className="local-actions"><button className="button button-quiet" type="button" onClick={() => setPublishId(null)}>取消</button><button className="button button-primary" disabled={busy || status.needsReview || !updateMessage.trim()} type="submit">发布更新</button></div></form>}
    </section>; })}
    {mode !== 'create' && <section className="panel live-section"><div className="panel-heading"><h2>我的云端项目</h2></div>{visibleRepos.filter((repo) => !links.some((item) => item.repositoryId === repo.id)).map((repo) => <div className="live-repo-row local-cloud-row" key={repo.id}><span><strong>{repo.name}</strong><small>{repo.description || '还没有一句介绍'}</small></span><button className="button button-quiet" disabled={busy || downloadBusy} onClick={() => void download(repo)}><Download size={16} />下载</button></div>)}{visibleRepos.every((repo) => links.some((item) => item.repositoryId === repo.id)) && <p className="muted"><CheckCircle2 size={16} />云端项目都已添加到电脑。</p>}</section>}
  </div>;
}
