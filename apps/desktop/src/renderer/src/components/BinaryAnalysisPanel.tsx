import { useEffect, useId, useRef, useState } from 'react';
import { Check, FileSearch, FolderOpen, RotateCw, Sparkles, X } from 'lucide-react';
import type { AiReviewProgress, AiSettingsStatus, BinaryAiReviewResult, BinaryAnalysisProgress, BinaryAnalysisResult, BinaryAnalysisSettingsStatus, BinaryAnalysisSource } from '@easyhub/types';
import type { Language } from '../i18n';
import './aiReview.css';
import './binaryAnalysis.css';

interface BinaryAnalysisPanelProps {
  language: Language;
  source?: BinaryAnalysisSource;
  onOpenSettings?: () => void;
  disabled?: boolean;
  onStatusChanged?: (status: BinaryAnalysisSettingsStatus) => void;
}

type Operation = 'choose' | 'install' | 'prepare-ai' | 'review' | 'cancel' | 'check';
type ActiveRequest = { id: string; kind: 'binary' | 'ai'; completion?: Promise<unknown> };

function fileName(source: BinaryAnalysisSource): string {
  return source.kind === 'pull' ? source.path.split(/[\\/]/).at(-1) || source.path : source.name;
}

function sourceIdentity(source?: BinaryAnalysisSource): string {
  if (!source) return '';
  if (source.kind === 'local') return `local:${source.fileId}`;
  if (source.kind === 'pull') return `pull:${source.owner}/${source.repo}:${source.number}:${source.headSha}:${source.path}`;
  return `release:${source.owner}/${source.repo}:${source.assetId}`;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') || fallback : fallback;
}

export function BinaryAnalysisEvidence({ analysis, language, fileLabel = analysis.fileName }: { analysis: BinaryAnalysisResult; language: Language; fileLabel?: string }) {
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;
  return <details className="binary-extracted-details">
    <summary>{t('程序文件提取证据', 'Extracted program evidence')} · <span data-content-original>{fileLabel}</span></summary>
    <div className="ai-review-report" data-content-original>
      <p>{analysis.summary}</p>
      <dl className="binary-file-metadata"><div><dt>{t('文件', 'File')}</dt><dd>{analysis.fileName}</dd></div><div><dt>{t('大小', 'Size')}</dt><dd>{sizeLabel(analysis.size)}</dd></div><div><dt>{t('格式', 'Format')}</dt><dd>{analysis.format}</dd></div><div><dt>{t('架构', 'Architecture')}</dt><dd>{analysis.architecture}</dd></div><div><dt>{t('函数数量', 'Functions')}</dt><dd>{analysis.functionCount.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}</dd></div><div><dt>SHA-256</dt><dd>{analysis.sha256}</dd></div></dl>
      {analysis.functions.length > 0 && <div className="binary-functions"><h4>{t('函数片段', 'Function excerpts')}</h4>{analysis.functions.map((fn, index) => <details key={`${fn.address}:${index}`}><summary><code>{fn.name}</code><span>{fn.address}</span></summary><pre><code>{fn.code}</code></pre></details>)}</div>}
      {analysis.imports.length > 0 && <details><summary>{t(`导入项 (${analysis.imports.length})`, `Imports (${analysis.imports.length})`)}</summary><ul className="binary-extracted-list">{analysis.imports.map((item, index) => <li key={index}><code>{item}</code></li>)}</ul></details>}
      {analysis.strings.length > 0 && <details><summary>{t(`文本片段 (${analysis.strings.length})`, `Text excerpts (${analysis.strings.length})`)}</summary><ul className="binary-extracted-list">{analysis.strings.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      {analysis.limitations.length > 0 && <div className="ai-limitations"><strong>{t('提取范围', 'Extraction coverage')}</strong><ul>{analysis.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    </div>
  </details>;
}

export function BinaryAnalysisPanel({ language, source, onOpenSettings, disabled = false, onStatusChanged }: BinaryAnalysisPanelProps) {
  const [status, setStatus] = useState<BinaryAnalysisSettingsStatus | null>(null);
  const [loading, setLoading] = useState(!disabled);
  const [selectedSource, setSelectedSource] = useState<BinaryAnalysisSource | null>(source ?? null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [progress, setProgress] = useState<BinaryAnalysisProgress | null>(null);
  const [analysis, setAnalysis] = useState<BinaryAnalysisResult | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettingsStatus | null>(null);
  const [aiConfirm, setAiConfirm] = useState(false);
  const [aiProgress, setAiProgress] = useState<AiReviewProgress | null>(null);
  const [review, setReview] = useState<BinaryAiReviewResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const operation = useRef(0);
  const activeRequest = useRef<ActiveRequest | null>(null);
  const pendingCancellation = useRef<{ request: ActiveRequest; completion: Promise<void> } | null>(null);
  const confirmDialog = useRef<HTMLDivElement>(null);
  const aiButton = useRef<HTMLButtonElement>(null);
  const consentTitleId = useId();
  const sourceKey = sourceIdentity(source);
  const previousSourceKey = useRef(sourceKey);
  const t = (zh: string, en: string): string => language === 'en' ? en : zh;

  function updateStatus(value: BinaryAnalysisSettingsStatus): void {
    setStatus(value);
    onStatusChanged?.(value);
  }

  function cancelRequest(request: ActiveRequest): Promise<void> | undefined {
    return request.kind === 'ai' ? window.easyHub?.aiCancelReview(request.id) : window.easyHub?.binaryAnalysisCancel(request.id);
  }

  function settleCancellation(request: ActiveRequest): Promise<void> {
    if (pendingCancellation.current?.request === request) return pendingCancellation.current.completion;
    const completion = (async () => {
      const results = await Promise.allSettled([cancelRequest(request), request.completion]);
      const canceled = results[0];
      if (canceled?.status === 'rejected') throw canceled.reason;
    })();
    const pending = { request, completion };
    pendingCancellation.current = pending;
    const clear = (): void => { if (pendingCancellation.current === pending) pendingCancellation.current = null; };
    void completion.then(clear, clear);
    return completion;
  }

  useEffect(() => {
    mounted.current = true;
    const unsubscribeBinary = window.easyHub?.onBinaryAnalysisProgress?.((value) => {
      if (activeRequest.current?.kind === 'binary' && activeRequest.current.id === value.requestId) setProgress(value);
    });
    const unsubscribeAi = window.easyHub?.onAiReviewProgress?.((value) => {
      if (activeRequest.current?.kind === 'ai' && activeRequest.current.id === value.requestId) setAiProgress(value);
    });
    return () => {
      mounted.current = false;
      operation.current += 1;
      unsubscribeBinary?.(); unsubscribeAi?.();
      if (activeRequest.current) void cancelRequest(activeRequest.current)?.catch(() => undefined);
      activeRequest.current = null;
    };
  }, []);

  useEffect(() => {
    const request = activeRequest.current ?? pendingCancellation.current?.request;
    activeRequest.current = null;
    const id = ++operation.current;
    if (previousSourceKey.current !== sourceKey) { previousSourceKey.current = sourceKey; setSelectedSource(source ?? null); }
    setBusy(request ? 'cancel' : null); setProgress(null); setAnalysis(null);
    setAiConfirm(false); setAiProgress(null); setReview(null); setError(''); setNotice('');
    if (request) void (async () => {
      await settleCancellation(request).catch(() => undefined);
      const value = await window.easyHub?.binaryAnalysisStatus().catch(() => null);
      if (mounted.current && operation.current === id) {
        if (value) updateStatus(value);
        setBusy(null);
      }
    })();
  }, [sourceKey, language]);

  useEffect(() => {
    if (disabled) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    const bridge = window.easyHub;
    if (!bridge?.binaryAnalysisStatus) {
      setLoading(false);
      setError(t('无法读取分析组件状态，请重新打开设置。', 'Could not load analysis component status. Reopen Settings.'));
      return;
    }
    void bridge.binaryAnalysisStatus().then((value) => { if (active) updateStatus(value); })
      .catch((cause) => { if (active) setError(errorMessage(cause, t('无法读取分析组件状态，请重试。', 'Could not load analysis component status. Please retry.'))); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [disabled]);

  useEffect(() => {
    if (!aiConfirm) return;
    confirmDialog.current?.querySelector<HTMLButtonElement>('[data-cancel-binary-ai]')?.focus();
    return () => { aiButton.current?.focus(); };
  }, [aiConfirm]);

  const externalBusy = status?.state === 'installing' || status?.state === 'analyzing';
  const locked = disabled || loading || busy !== null || pendingCancellation.current !== null || externalBusy || !window.easyHub?.binaryAnalysisStatus;
  const current = (id: number): boolean => mounted.current && operation.current === id;

  async function checkStatus(): Promise<void> {
    if (!window.easyHub?.binaryAnalysisStatus || disabled || loading || busy) return;
    const id = ++operation.current;
    setBusy('check'); setError(''); setNotice('');
    try {
      const value = await window.easyHub.binaryAnalysisStatus();
      if (current(id)) updateStatus(value);
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('无法检查分析组件，请重试。', 'Could not check the analysis components. Please retry.')));
    } finally { if (current(id)) setBusy(null); }
  }

  async function chooseFile(): Promise<void> {
    if (!window.easyHub || locked) return;
    const id = ++operation.current;
    setBusy('choose'); setError(''); setNotice('');
    try {
      const value = await window.easyHub.binaryAnalysisChooseFile();
      if (!current(id) || !value) return;
      setSelectedSource(value); setAnalysis(null); setReview(null); setAiConfirm(false);
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('无法选择文件，请重试。', 'Could not select the file. Please retry.')));
    } finally { if (current(id)) setBusy(null); }
  }

  async function install(): Promise<void> {
    if (!window.easyHub || locked) return;
    const id = ++operation.current;
    const requestId = crypto.randomUUID();
    activeRequest.current = { id: requestId, kind: 'binary' };
    setBusy('install'); setError(''); setNotice('');
    setProgress({ requestId, phase: 'installing', completed: 0, total: 0 });
    updateStatus({ ...status, installed: false, state: 'installing', engineVersion: status?.engineVersion ?? '' });
    try {
      const completion = window.easyHub.binaryAnalysisInstall(requestId);
      activeRequest.current = { id: requestId, kind: 'binary', completion };
      const value = await completion;
      if (!current(id)) return;
      updateStatus(value);
      setNotice(t('审查组件已安装，可以选择文件开始 AI 审查。', 'Review components installed. Select a file to start AI review.'));
    } catch (cause) {
      if (current(id)) {
        setError(errorMessage(cause, t('分析组件安装未完成，请重试。', 'Analysis components could not be installed. Please retry.')));
        const value = await window.easyHub.binaryAnalysisStatus().catch(() => null);
        if (current(id) && value) updateStatus(value);
      }
    } finally {
      if (current(id)) { activeRequest.current = null; setBusy(null); setProgress(null); }
    }
  }

  async function prepareAiReview(): Promise<void> {
    if (!window.easyHub || locked || !selectedSource || !status?.installed) return;
    const id = ++operation.current;
    setBusy('prepare-ai'); setError(''); setNotice('');
    try {
      const value = await window.easyHub.aiSettings();
      if (!current(id)) return;
      setAiSettings(value);
      if (!value.hasApiKey || !value.model) setError(t('请先在设置中连接你的 AI 服务。', 'Connect your AI service in Settings first.'));
      else setAiConfirm(true);
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('无法读取 AI 设置，请重试。', 'Could not load AI settings. Please retry.')));
    } finally { if (current(id)) setBusy(null); }
  }

  async function startAiReview(): Promise<void> {
    if (!window.easyHub || locked || !selectedSource || !status?.installed || !aiSettings || !aiConfirm) return;
    const id = ++operation.current;
    const requestId = crypto.randomUUID();
    activeRequest.current = { id: requestId, kind: 'binary' };
    setBusy('review'); setAiConfirm(false); setError(''); setNotice(''); setAnalysis(null); setReview(null);
    setProgress({ requestId, phase: 'preparing', completed: 0, total: 0 }); setAiProgress(null);
    updateStatus({ ...status, state: 'analyzing' });
    try {
      const extraction = window.easyHub.binaryAnalyze({ requestId, source: selectedSource, language });
      activeRequest.current = { id: requestId, kind: 'binary', completion: extraction };
      const evidence = await extraction;
      if (!current(id)) return;
      setAnalysis(evidence); setProgress(null);
      updateStatus({ ...status, state: 'ready' });
      setAiProgress({ requestId, phase: t('正在 AI 审查…', 'Reviewing with AI…'), completed: 0, total: 1 });
      const completion = window.easyHub.binaryAiReview({ requestId, analysisId: evidence.id, providerBaseUrl: aiSettings.baseUrl, consentToSend: true, language });
      activeRequest.current = { id: requestId, kind: 'ai', completion };
      const value = await completion;
      if (!current(id)) return;
      if (value.analysisId !== evidence.id) throw new Error(t('程序内容已更新，请重新开始 AI 审查。', 'The program content has changed. Start AI review again.'));
      setReview(value);
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('AI 审查未能完成，请检查文件和审查组件后重试。', 'AI review could not be completed. Check the file and review components, then retry.')));
    } finally {
      if (current(id)) {
        activeRequest.current = null; setProgress(null); setAiProgress(null);
        const value = await window.easyHub.binaryAnalysisStatus().catch(() => null);
        if (current(id)) { if (value) updateStatus(value); setBusy(null); }
      }
    }
  }

  async function cancel(): Promise<void> {
    const request = activeRequest.current;
    if (!request) return;
    const id = ++operation.current;
    activeRequest.current = null;
    setBusy('cancel'); setProgress(null); setAiProgress(null); setError('');
    try {
      await settleCancellation(request);
      const value = await window.easyHub?.binaryAnalysisStatus();
      if (current(id)) {
        if (value) updateStatus(value);
        setNotice(t('已取消。', 'Canceled.'));
      }
    } catch (cause) {
      if (current(id)) setError(errorMessage(cause, t('未能取消，请重新检查状态。', 'Could not cancel. Check the status again.')));
    } finally { if (current(id)) setBusy(null); }
  }

  const statusText = disabled ? t('演示版不可用', 'Unavailable in demo')
    : loading || busy === 'check' ? t('正在检查组件…', 'Checking components…')
    : status?.state === 'installing' ? t('正在安装组件…', 'Installing components…')
    : status?.state === 'analyzing' ? t('正在分析文件…', 'Analyzing file…')
    : status?.state === 'error' ? t('组件需要检查', 'Components need attention')
    : status?.installed ? t('已就绪', 'Ready')
    : status ? t('尚未安装', 'Not installed') : t('状态暂不可用', 'Status unavailable');
  const progressText = progress?.phase === 'installing' ? t('正在下载并安装分析组件…', 'Downloading and installing analysis components…')
    : progress?.phase === 'preparing' ? t('正在准备所选文件…', 'Preparing the selected file…')
    : progress?.phase === 'complete' ? t('程序内容已提取，正在准备 AI 审查…', 'Program content extracted. Preparing AI review…')
    : t('正在提取程序内容…', 'Extracting program content…');
  const progressDetail = progress && progress.total > 0 ? progress.unit === 'bytes'
    ? `${sizeLabel(progress.completed)} / ${sizeLabel(progress.total)}` : `${progress.completed} / ${progress.total}` : '';
  const shownError = error || (status?.state === 'error' ? status.error ?? '' : '');
  const downloadBytes = status?.downloadBytes;
  const downloadNote = typeof downloadBytes === 'number' && Number.isFinite(downloadBytes) && downloadBytes >= 0
    ? downloadBytes === 0
      ? t('无需额外下载。', 'No additional download is needed.')
      : t(`需要下载约 ${sizeLabel(downloadBytes)}。`, `About ${sizeLabel(downloadBytes)} will be downloaded.`)
    : t('首次使用需下载分析组件。', 'Analysis components are downloaded on first use.');

  return <div className="binary-analysis-panel" aria-busy={loading || busy !== null}>
    <div className="binary-component-status">
      <span className={`binary-status ${status?.installed && status.state === 'ready' ? 'is-ready' : ''}`} role="status">
        {loading || busy === 'check' || externalBusy ? <RotateCw size={14} className="live-spin" /> : status?.installed && status.state === 'ready' ? <Check size={14} /> : <span className="binary-status-dot" />}{statusText}
      </span>
      {!disabled && <button type="button" className="text-link" disabled={loading || busy !== null} onClick={() => void checkStatus()}><RotateCw size={14} />{t('检查组件', 'Check components')}</button>}
    </div>
    {disabled ? <p className="ai-settings-note">{t('请使用正式版连接 AI 服务并选择程序文件审查。', 'Use the full edition to connect your AI service and review program files.')}</p> : <>
      {!status?.installed && !loading && <div className="binary-install-entry">
        <div><strong>{t('安装程序文件审查组件', 'Install program review components')}</strong><p>{downloadNote}{t('审查 exe、dll 等程序文件时，组件先在本机提取程序内容，再交给 AI 审查。', ' The components extract program content locally before AI reviews exe, dll, and other program files.')}</p></div>
        <button type="button" className="button button-primary" disabled={locked} onClick={() => void install()}>{t('安装组件', 'Install components')}</button>
      </div>}
      <div className="binary-file-entry">
        {selectedSource ? <div className="binary-selected-file"><FileSearch size={19} /><span><strong data-content-original>{fileName(selectedSource)}</strong><small>{selectedSource.kind === 'local' ? sizeLabel(selectedSource.size) : selectedSource.kind === 'pull' ? t('来自合并请求', 'From a pull request') : t('来自发行版', 'From a release')}</small></span></div> : <p className="ai-settings-note">{t('选择要审查的程序文件，确认后自动提取内容并进行 AI 审查。', 'Select a program file. After confirmation, its content is extracted and reviewed with AI.')}</p>}
        <div className="binary-file-actions">
          {!source && <button type="button" className="button button-quiet" disabled={locked} onClick={() => void chooseFile()}><FolderOpen size={16} />{selectedSource ? t('更换文件', 'Change file') : t('选择本地文件', 'Select local file')}</button>}
          {selectedSource && <button ref={aiButton} type="button" className="button button-primary" disabled={locked || !status?.installed} onClick={() => void prepareAiReview()}>{busy === 'prepare-ai' ? <RotateCw size={16} className="live-spin" /> : <Sparkles size={16} />}{review ? t('重新审查', 'Review again') : t('AI 审查', 'AI review')}</button>}
        </div>
        {selectedSource && <p className="ai-settings-note">{t('只读取所选文件，不会运行该程序。', 'The selected file is read without running the program.')}</p>}
      </div>
    </>}
    {(progress || aiProgress || busy === 'cancel') && <div className="ai-review-progress binary-analysis-progress" role="status" aria-live="polite">
      <p><RotateCw size={16} className="live-spin" />{busy === 'cancel' ? t('正在取消审查…', 'Canceling review…') : aiProgress ? aiProgress.phase || t('正在 AI 审查…', 'Reviewing with AI…') : progressText}{progressDetail && <span>{progressDetail}</span>}</p>
      {progress && <progress value={progress.total > 0 ? progress.completed : undefined} max={progress.total > 0 ? progress.total : undefined} aria-label={t('分析进度', 'Analysis progress')} />}
      {aiProgress && <progress value={aiProgress.total > 0 ? aiProgress.completed : undefined} max={aiProgress.total > 0 ? aiProgress.total : undefined} aria-label={t('AI 审查进度', 'AI review progress')} />}
      {activeRequest.current && <button type="button" className="button button-quiet" onClick={() => void cancel()}>{t('取消', 'Cancel')}</button>}
    </div>}
    {shownError && <p className="live-error" role="alert">{shownError}</p>}
    {notice && <p className="ai-success" role="status"><Check size={16} />{notice}</p>}
    {onOpenSettings && ((aiSettings && (!aiSettings.hasApiKey || !aiSettings.model)) || !status?.installed) && <button type="button" className="text-link" onClick={onOpenSettings}>{t('打开 AI 设置', 'Open AI settings')}</button>}
    {review && <section className="ai-review-result binary-analysis-result" aria-label={t('AI 审查结果', 'AI review results')}><h3>{t('AI 审查结果', 'AI review results')}</h3><div className="ai-review-report" data-content-original>
      <p className="ai-review-summary">{review.summary}</p><div className="ai-findings">{review.findings.map((finding, index) => <article className="ai-finding" key={`${finding.address ?? ''}:${index}`}>
        <div className="ai-finding-heading"><span className={`ai-severity ai-severity-${finding.severity}`}>{finding.severity === 'high' ? t('重点关注', 'High priority') : finding.severity === 'medium' ? t('建议检查', 'Worth checking') : t('改进建议', 'Suggestion')}</span>{finding.address && <code>{finding.address}</code>}</div>
        <p>{finding.description}</p>{finding.suggestion && <p className="ai-finding-suggestion">{finding.suggestion}</p>}
      </article>)}</div>{review.findings.length === 0 && <p className="ai-no-findings">{t('本次审查没有提出具体问题。', 'This review did not report specific issues.')}</p>}
      {review.limitations.length > 0 && <div className="ai-limitations"><strong>{t('本次审查范围', 'Review coverage')}</strong><ul>{review.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    </div>{analysis && <BinaryAnalysisEvidence analysis={analysis} language={language} />}</section>}
    {aiConfirm && aiSettings && selectedSource && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAiConfirm(false); }}>
      <div ref={confirmDialog} className="modal ai-consent-modal binary-consent-modal" role="dialog" aria-modal="true" aria-labelledby={consentTitleId} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); setAiConfirm(false); }
        if (event.key === 'Tab') {
          const buttons = confirmDialog.current?.querySelectorAll<HTMLButtonElement>('button');
          const first = buttons?.[0]; const last = buttons?.[buttons.length - 1];
          if (first && last && event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (first && last && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
        <button type="button" className="icon-button modal-close" aria-label={t('关闭', 'Close')} onClick={() => setAiConfirm(false)}><X size={19} /></button>
        <div className="modal-symbol"><Sparkles size={25} /></div><h2 id={consentTitleId}>{t('使用 AI 审查这个程序文件？', 'Use AI to review this program file?')}</h2>
        <p>{t('确认后，将先在这台电脑上提取程序内容，再向你的 AI 服务发送文件名、格式与架构、分析摘要，以及提取的函数代码、导入项和文本片段。', 'After confirmation, program content is extracted on this computer. The file name, format, architecture, analysis summary, and extracted function code, imports, and text excerpts are then sent to your AI service.')}</p>
        <dl className="ai-consent-service"><div><dt>{t('服务地址', 'Service address')}</dt><dd data-content-original>{aiSettings.baseUrl}</dd></div><div><dt>{t('模型名称', 'Model name')}</dt><dd data-content-original>{aiSettings.model}</dd></div><div><dt>{t('文件', 'File')}</dt><dd data-content-original>{fileName(selectedSource)}</dd></div></dl>
        <p>{t('请确认你愿意分享这些提取内容。服务商可能收费，审查结果供你进一步检查程序时参考。', 'Confirm that you want to share this extracted content. Your provider may charge for this request. Use the review to guide your own inspection.')}</p>
        <div className="modal-actions"><button data-cancel-binary-ai type="button" className="button button-quiet" onClick={() => setAiConfirm(false)}>{t('取消', 'Cancel')}</button><button type="button" className="button button-primary" onClick={() => void startAiReview()}><Sparkles size={16} />{t('同意并开始审查', 'Agree and start review')}</button></div>
      </div>
    </div>}
  </div>;
}
