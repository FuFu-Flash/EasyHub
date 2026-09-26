import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GitHubComment, GitHubPullFile, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import type { AiReviewProgress, AiReviewResult, AiSettingsStatus } from '@easyhub/types';
import { ArrowLeft, ArrowRight, Check, Download, GitPullRequest, Plus, RotateCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { TranslatableContent } from './TranslatableContent';
import type { Language } from '../i18n';
import './aiReview.css';

function errorText(error: unknown): string { return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : '暂时无法完成操作，请稍后重试。'; }
interface PullReviewSnapshot { repository: GitHubRepo; pullRequest: GitHubPullRequest; files: GitHubPullFile[]; filesTruncated: boolean }

export function PullRequestsPanel({ repo, currentUser, language, showCreateButton = true, refreshKey = 0, onDownloadFile, onOpenAiSettings, downloadBusy = false }: {
  repo: GitHubRepo;
  currentUser: string;
  language: Language;
  showCreateButton?: boolean;
  refreshKey?: number;
  onDownloadFile?: (requestNumber: number, path: string, headSha: string) => Promise<void>;
  onOpenAiSettings?: () => void;
  downloadBusy?: boolean;
}) {
  const [items, setItems] = useState<GitHubPullRequest[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<GitHubPullRequest | null>(null);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [files, setFiles] = useState<GitHubPullFile[]>([]);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [snapshotRepo, setSnapshotRepo] = useState<GitHubRepo | null>(null);
  const [filesTruncated, setFilesTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sourceOwner, setSourceOwner] = useState(currentUser);
  const [sourceBranch, setSourceBranch] = useState('');
  const [base, setBase] = useState(repo.default_branch);
  const [saving, setSaving] = useState(false);
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettingsStatus | null>(null);
  const [aiConfirm, setAiConfirm] = useState(false);
  const [aiPreparing, setAiPreparing] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiReviewProgress | null>(null);
  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [aiError, setAiError] = useState('');
  const aiRequestId = useRef<string | null>(null);
  const previousLanguage = useRef(language);
  const viewVersion = useRef(0);
  const mounted = useRef(false);
  const owner = repo.owner.login;
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  const canManage = snapshotReady && snapshotRepo !== null && !snapshotRepo.archived && (snapshotRepo.permissions?.admin === true || snapshotRepo.permissions?.push === true || snapshotRepo.owner.login.toLowerCase() === currentUser.toLowerCase());
  const hasRevision = Boolean(selected?.head.sha);
  const hasDecisionRevision = hasRevision && Boolean(selected?.base.ref && selected.base.sha);
  const markdown = (value: string) => <div className="intro-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>;

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = window.easyHub?.onAiReviewProgress((value) => {
      if (value.requestId === aiRequestId.current) setAiProgress(value);
    });
    return () => {
      mounted.current = false;
      viewVersion.current += 1;
      unsubscribe?.();
      if (aiRequestId.current) void window.easyHub?.aiCancelReview(aiRequestId.current).catch(() => undefined);
      aiRequestId.current = null;
    };
  }, []);

  function resetReview(): void {
    if (aiRequestId.current) void window.easyHub?.aiCancelReview(aiRequestId.current).catch(() => undefined);
    aiRequestId.current = null;
    setAiProgress(null); setAiReview(null); setAiError(''); setAiConfirm(false); setAiPreparing(false);
  }

  useEffect(() => {
    if (previousLanguage.current === language) return;
    previousLanguage.current = language;
    resetReview();
  }, [language]);

  useEffect(() => {
    let active = true;
    viewVersion.current += 1;
    resetReview(); setDecision(null); setNotice('');
    setSnapshotReady(false); setSnapshotRepo(null); setFilesTruncated(false);
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
    const version = ++viewVersion.current;
    resetReview(); setDecision(null); setNotice('');
    setSnapshotReady(false); setSnapshotRepo(null); setFilesTruncated(false);
    setSelected(item); setComments([]); setFiles([]); setBusy(true); setError('');
    try {
      const detail = await window.easyHub!.github<GitHubPullRequest>('pullRequest', owner, repo.name, item.number);
      if (version !== viewVersion.current || !mounted.current) return;
      if (!detail.head.sha) throw new Error(t('暂时无法确认修改版本，请重新获取。', 'The change version could not be verified. Please refresh.'));
      const [context, discussion] = await Promise.all([
        window.easyHub!.github<PullReviewSnapshot>('pullReviewContext', owner, repo.name, item.number, detail.head.sha),
        window.easyHub!.github<GitHubComment[]>('comments', owner, repo.name, item.number),
      ]);
      if (version !== viewVersion.current || !mounted.current) return;
      if (context.pullRequest.head.sha !== detail.head.sha || context.pullRequest.base.ref !== detail.base.ref || context.pullRequest.base.sha !== detail.base.sha) throw new Error(t('这次改进已更新，请重新获取后再决定。', 'These changes have been updated. Refresh before deciding.'));
      setSelected(context.pullRequest); setComments(discussion); setFiles(context.files);
      setSnapshotRepo(context.repository); setFilesTruncated(context.filesTruncated); setSnapshotReady(true);
      setItems((current) => current.map((known) => known.id === context.pullRequest.id ? context.pullRequest : known));
    } catch (cause) { if (version === viewVersion.current && mounted.current) setError(errorText(cause)); }
    finally { if (version === viewVersion.current && mounted.current) setBusy(false); }
  }

  async function applyDecision(): Promise<void> {
    if (!selected || !decision || !selected.head.sha || !selected.base.sha || !selected.base.ref || !canManage || !snapshotReady || decisionBusy) return;
    const version = viewVersion.current;
    const action = decision;
    setDecisionBusy(true); setError(''); setNotice('');
    try {
      if (action === 'accept') {
        const result = await window.easyHub!.github<{ merged: boolean; sha: string; message: string }>('acceptPullRequest', owner, repo.name, selected.number, { expectedHeadSha: selected.head.sha, expectedBaseRef: selected.base.ref, expectedBaseSha: selected.base.sha });
        if (!result.merged) throw new Error(t('这次改进暂时不能合入，请刷新后查看最新状态。', 'These changes cannot be merged yet. Refresh to see the latest status.'));
      } else {
        await window.easyHub!.github<GitHubPullRequest>('rejectPullRequest', owner, repo.name, selected.number, { expectedHeadSha: selected.head.sha, expectedBaseRef: selected.base.ref, expectedBaseSha: selected.base.sha, ...(decisionReason.trim() ? { reason: decisionReason.trim() } : {}) });
      }
      if (version !== viewVersion.current || !mounted.current) return;
      setDecision(null); setDecisionReason('');
      setSnapshotReady(false);
      const updated = { ...selected, state: 'closed' as const, merged: action === 'accept', merged_at: action === 'accept' ? new Date().toISOString() : selected.merged_at };
      setSelected(updated); setItems((current) => current.map((known) => known.id === updated.id ? updated : known));
      setNotice(action === 'accept' ? t('改进已批准并合入项目。', 'The changes were approved and merged into the project.') : t('改进请求已拒绝并关闭。', 'The change request was rejected and closed.'));
      try {
        const [context, discussion] = await Promise.all([
          window.easyHub!.github<PullReviewSnapshot>('pullReviewContext', owner, repo.name, selected.number, selected.head.sha),
          window.easyHub!.github<GitHubComment[]>('comments', owner, repo.name, selected.number),
        ]);
        if (version !== viewVersion.current || !mounted.current) return;
        setSelected(context.pullRequest); setComments(discussion); setFiles(context.files); setSnapshotRepo(context.repository); setFilesTruncated(context.filesTruncated); setSnapshotReady(true);
        setItems((current) => current.map((known) => known.id === context.pullRequest.id ? context.pullRequest : known));
      } catch { if (version === viewVersion.current && mounted.current) setError(t('操作已完成，但最新内容暂时未能载入。请重新获取。', 'The action succeeded, but the latest content could not be loaded. Please refresh.')); }
    } catch (cause) { if (version === viewVersion.current && mounted.current) { setDecision(null); setSnapshotReady(false); setError(errorText(cause)); } }
    finally { if (mounted.current) setDecisionBusy(false); }
  }

  async function download(file: GitHubPullFile): Promise<void> {
    if (!onDownloadFile || !selected?.head.sha || !snapshotReady || file.status === 'removed' || downloadingFile || downloadBusy) return;
    const version = viewVersion.current;
    setDownloadingFile(file.filename); setError('');
    try { await onDownloadFile(selected.number, file.filename, selected.head.sha); }
    catch (cause) { if (mounted.current && version === viewVersion.current) setError(errorText(cause)); }
    finally { if (mounted.current) setDownloadingFile(null); }
  }

  async function prepareAiReview(): Promise<void> {
    if (!selected || !hasRevision || !snapshotReady || aiRequestId.current || aiPreparing || busy) return;
    const version = viewVersion.current;
    setAiPreparing(true); setAiError('');
    try {
      const settings = await window.easyHub!.aiSettings();
      if (!mounted.current || version !== viewVersion.current) return;
      setAiSettings(settings);
      if (!settings.hasApiKey || !settings.model) setAiError(t('请先在设置中连接你的 AI 服务。', 'Connect your AI service in Settings first.'));
      else setAiConfirm(true);
    } catch (cause) { if (mounted.current && version === viewVersion.current) setAiError(errorText(cause)); }
    finally { if (mounted.current && version === viewVersion.current) setAiPreparing(false); }
  }

  async function startAiReview(): Promise<void> {
    if (!selected?.head.sha || !snapshotReady || !aiSettings || !aiConfirm || aiRequestId.current) return;
    const requestId = crypto.randomUUID();
    const version = viewVersion.current;
    aiRequestId.current = requestId;
    setAiConfirm(false); setAiError(''); setAiReview(null);
    setAiProgress({ requestId, phase: '正在准备审查…', completed: 0, total: 0 });
    try {
      const result = await window.easyHub!.aiReviewPull({ owner, repo: repo.name, number: selected.number, headSha: selected.head.sha, requestId, consentToSend: true, providerBaseUrl: aiSettings.baseUrl, language });
      if (!mounted.current || version !== viewVersion.current || aiRequestId.current !== requestId) return;
      if (result.headSha !== selected.head.sha) throw new Error(t('修改内容已更新，请刷新后重新审查。', 'The changes have been updated. Refresh and review them again.'));
      setAiReview(result);
    } catch (cause) {
      if (mounted.current && version === viewVersion.current && aiRequestId.current === requestId) setAiError(errorText(cause));
    } finally {
      if (mounted.current && aiRequestId.current === requestId) { aiRequestId.current = null; setAiProgress(null); }
    }
  }

  function cancelAiReview(): void {
    const requestId = aiRequestId.current;
    aiRequestId.current = null; setAiProgress(null);
    if (requestId) void window.easyHub!.aiCancelReview(requestId).catch(() => undefined);
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
      <button className="back-link" disabled={decisionBusy} onClick={() => { viewVersion.current += 1; resetReview(); setSelected(null); setError(''); setBusy(false); setNotice(''); }}><ArrowLeft size={16} />返回改进请求</button>
      <div className="issue-detail public-issue-detail">
        <div className="issue-title"><span className={`issue-state ${selected.state === 'closed' ? 'closed' : ''}`}>{selected.merged ? '已采纳' : selected.state === 'open' ? selected.draft ? '草稿' : '待审阅' : '已关闭'}</span>{repo.private ? <h1>{selected.title}</h1> : <TranslatableContent text={selected.title} format="text" render={(value) => <h1>{value}</h1>} />}<p>{selected.user?.login || 'GitHub 用户'} · {selected.head?.label || selected.head?.ref} → {selected.base?.ref}</p></div>
        {busy && <p className="live-loading"><RotateCw size={16} className="live-spin" />正在获取内容…</p>}
        {error && <p className="live-error" role="alert">{error}</p>}
        {notice && <p className="ai-success" role="status"><Check size={17} />{notice}</p>}
        {canManage && selected.state === 'open' && !selected.merged && <div className="pull-review-actions">
          <div><strong>{t('审阅这次改进', 'Review these changes')}</strong><p>{selected.draft ? t('作者还在准备这次改进，完成后才能批准合入。', 'The author is still preparing these changes. They can be approved once ready.') : t('批准会将修改合入项目，拒绝会关闭这次请求。', 'Approval merges the changes into your project. Rejection closes this request.')}</p></div>
          <div className="pull-review-buttons"><button className="button button-quiet pull-reject-button" disabled={busy || decisionBusy || !hasDecisionRevision} onClick={() => { setDecisionReason(''); setDecision('reject'); }}>{t('拒绝', 'Reject')}</button><button className="button button-primary" disabled={busy || decisionBusy || !hasDecisionRevision || selected.draft} onClick={() => setDecision('accept')}><Check size={16} />{t('批准并合入', 'Approve and merge')}</button></div>
        </div>}
        {error && <button className="text-link" disabled={busy || decisionBusy} onClick={() => void open(selected)}><RotateCw size={15} />{t('重新获取', 'Refresh')}</button>}
        <div className="conversation"><div className="message"><div className="avatar author-avatar">{(selected.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{selected.user?.login || 'GitHub 用户'}</strong><small>{new Date(selected.created_at).toLocaleString()}</small></div>{selected.body ? repo.private ? markdown(selected.body) : <TranslatableContent text={selected.body} format="markdown" paragraphMode render={markdown} /> : <p className="muted">没有详细描述。</p>}</div></div>{comments.map((comment) => <div className="message" key={comment.id}><div className="avatar">{(comment.user?.login || 'G').slice(0, 1).toUpperCase()}</div><div className="message-box"><div><strong>{comment.user?.login || 'GitHub 用户'}</strong><small>{new Date(comment.created_at).toLocaleString()}</small></div>{repo.private ? markdown(comment.body) : <TranslatableContent text={comment.body} format="markdown" paragraphMode render={markdown} />}</div></div>)}</div>
        <div className="pull-files">
          <div className="pull-files-heading"><h3>修改的文件 {selected.changed_files ?? files.length}</h3><button className="button button-quiet" disabled={busy || !snapshotReady || !hasRevision || aiPreparing || aiProgress !== null} onClick={() => void prepareAiReview()}>{aiPreparing ? <RotateCw size={16} className="live-spin" /> : <Sparkles size={16} />}{t('AI 审查', 'AI review')}</button></div>
          {filesTruncated && <p className="ai-settings-note">{t('本次修改的文件较多，GitHub 只返回了部分文件。请在 GitHub 上确认完整修改后再决定是否合入。', 'GitHub returned only part of this large change. Check the full changes on GitHub before deciding whether to merge.')}</p>}
          {files.map((file) => <div className="live-file pull-download-row" key={file.filename}><span className="pull-file-name" data-content-original>{file.filename}</span><small>+{file.additions} / −{file.deletions}</small><button className="button button-quiet small-button" disabled={file.status === 'removed' || !onDownloadFile || !snapshotReady || !hasRevision || downloadingFile !== null || downloadBusy} onClick={() => void download(file)} aria-label={`${t('下载文件', 'Download file')} ${file.filename}`}>{downloadingFile === file.filename ? <RotateCw size={15} className="live-spin" /> : <Download size={15} />}{file.status === 'removed' ? t('已删除', 'Deleted') : t('下载', 'Download')}</button></div>)}
          {!busy && files.length === 0 && <p className="muted">{t('没有可显示的文件修改。', 'There are no file changes to display.')}</p>}
        </div>
        {(aiProgress || aiReview || aiError) && <section className="ai-review-result" aria-label={t('AI 审查结果', 'AI review results')}>
          <div className="pull-files-heading"><h3><ShieldCheck size={18} />{t('AI 审查', 'AI review')}</h3>{aiProgress && <button className="button button-quiet small-button" onClick={cancelAiReview}>{t('取消审查', 'Cancel review')}</button>}</div>
          {aiProgress && <div className="ai-review-progress" role="status"><p><RotateCw size={16} className="live-spin" />{t('正在审查修改…', 'Reviewing changes…')}{aiProgress.total > 0 && <span>{aiProgress.completed} / {aiProgress.total}</span>}</p>{aiProgress.total > 0 && <progress value={aiProgress.completed} max={aiProgress.total} aria-label={t('审查进度', 'Review progress')} />}</div>}
          {aiError && <><p className="live-error" role="alert">{aiError}</p>{(!aiSettings?.hasApiKey || !aiSettings.model) && onOpenAiSettings && <button className="text-link" onClick={onOpenAiSettings}>{t('打开 AI 设置', 'Open AI settings')}<ArrowRight size={15} /></button>}</>}
          {aiReview && <div className="ai-review-report" data-content-original>
            <p className="ai-review-summary">{aiReview.summary}</p>
            <p className="ai-review-scope">{t(`已审查 ${aiReview.reviewedFiles} / ${aiReview.totalFiles} 个文件。结果仅供参考，请结合实际修改确认。`, `Reviewed ${aiReview.reviewedFiles} of ${aiReview.totalFiles} files. Use these suggestions together with your own review.`)}</p>
            <div className="ai-findings">{aiReview.findings.map((finding, index) => <article className="ai-finding" key={`${finding.file}:${finding.line ?? 0}:${index}`}>
              <div className="ai-finding-heading"><span className={`ai-severity ai-severity-${finding.severity}`}>{finding.severity === 'high' ? t('高风险', 'High risk') : finding.severity === 'medium' ? t('需要留意', 'Needs attention') : t('建议', 'Suggestion')}</span><code>{finding.file}{finding.line !== undefined ? `:${finding.line}` : ''}</code></div>
              <p>{finding.description}</p><p className="ai-finding-suggestion"><strong>{t('建议：', 'Suggestion: ')}</strong>{finding.suggestion}</p>
            </article>)}</div>
            {aiReview.findings.length === 0 && <p className="ai-no-findings">{t('本次审查没有提出具体问题。', 'This review did not report specific issues.')}</p>}
            {aiReview.limitations.length > 0 && <div className="ai-limitations"><strong>{t('本次审查范围', 'Review coverage')}</strong><ul>{aiReview.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
          </div>}
        </section>}
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
    {decision && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !decisionBusy) setDecision(null); }}><form className="modal pull-decision-modal" role="dialog" aria-modal="true" aria-labelledby="pull-decision-title" onSubmit={(event) => { event.preventDefault(); void applyDecision(); }}>
      <button type="button" className="icon-button modal-close" aria-label={t('关闭', 'Close')} disabled={decisionBusy} onClick={() => setDecision(null)}><X size={19} /></button>
      <h2 id="pull-decision-title">{decision === 'accept' ? t('批准并合入这次改进？', 'Approve and merge these changes?') : t('拒绝并关闭这次请求？', 'Reject and close this request?')}</h2>
      <p className="pull-confirm-title" data-content-original>{selected.title}</p>
      <dl className="ai-consent-service"><div><dt>{t('目标版本', 'Target version')}</dt><dd data-content-original>{repo.full_name} / {selected.base.ref}</dd></div></dl>
      <p>{decision === 'accept' ? t('确认后，这次修改会保存到你的 GitHub 项目中。请先检查修改文件和审查结果。', 'These changes will be saved to your project on GitHub. Check the changed files and review results before confirming.') : t('确认后，这次改进请求会关闭。填写的原因会作为回复发给对方。', 'This change request will be closed. Any reason you enter will be posted as a reply.')}</p>
      {decision === 'reject' && <label className="field"><span>{t('拒绝原因（选填）', 'Reason for rejection (optional)')}</span><textarea rows={4} maxLength={65536} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} disabled={decisionBusy} placeholder={t('说明这次没有采用的原因…', 'Explain why you are not accepting these changes…')} /></label>}
      <div className="modal-actions"><button type="button" className="button button-quiet" disabled={decisionBusy} onClick={() => setDecision(null)}>{t('取消', 'Cancel')}</button><button type="submit" className={`button ${decision === 'accept' ? 'button-primary' : 'danger-confirm'}`} disabled={decisionBusy}>{decisionBusy && <RotateCw size={16} className="live-spin" />}{decision === 'accept' ? t('确认批准并合入', 'Confirm approval and merge') : t('确认拒绝并关闭', 'Confirm rejection and close')}</button></div>
    </form></div>}
    {aiConfirm && aiSettings && selected && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAiConfirm(false); }}><div className="modal ai-consent-modal" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title">
      <button type="button" className="icon-button modal-close" aria-label={t('关闭', 'Close')} onClick={() => setAiConfirm(false)}><X size={19} /></button>
      <div className="modal-symbol"><Sparkles size={25} /></div><h2 id="ai-consent-title">{t('使用 AI 审查这次改进？', 'Use AI to review these changes?')}</h2>
      <p>{t('将向你配置的 AI 服务发送这次改进的标题、描述、文件名和修改内容。', 'The title, description, file names, and changes will be sent to your configured AI service.')}</p>
      <dl className="ai-consent-service"><div><dt>{t('服务地址', 'Service address')}</dt><dd data-content-original>{aiSettings.baseUrl}</dd></div><div><dt>{t('模型名称', 'Model name')}</dt><dd data-content-original>{aiSettings.model}</dd></div><div><dt>{t('项目', 'Project')}</dt><dd data-content-original>{repo.full_name}</dd></div></dl>
      {repo.private && <p className="ai-private-notice">{t('这是私有项目。请确认你愿意将本次修改内容发送给此服务。', 'This project is private. Confirm that you want to send these changes to this service.')}</p>}
      <p>{t('服务商可能收取费用。审查结果仅在 EasyHub 中展示，是否合入由你决定。', 'Your provider may charge for this request. The review is shown in EasyHub, and you decide whether to merge.')}</p>
      <div className="modal-actions"><button className="button button-quiet" onClick={() => setAiConfirm(false)}>{t('取消', 'Cancel')}</button><button className="button button-primary" onClick={() => void startAiReview()}><Sparkles size={16} />{t('同意并开始审查', 'Agree and start review')}</button></div>
    </div></div>}
  </section>;
}
