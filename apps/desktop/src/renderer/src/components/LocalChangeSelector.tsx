import { useEffect, useRef, useState } from 'react';
import type { LocalFileDiff, LocalPublishPreview, LocalPublishSelection } from '@easyhub/types';
import { ChevronDown, RotateCw } from 'lucide-react';
import { readLanguage } from '../i18n';
import { CodeExplanation } from './CodeExplanation';
import './local-change-selector.css';

interface Props {
  id: string;
  refreshKey: number;
  disabled: boolean;
  onSelection: (id: string, selection: LocalPublishSelection | null, pending?: boolean) => void;
}
export function LocalChangeSelector({ id, refreshKey, disabled, onSelection }: Props) {
  const [preview, setPreview] = useState<LocalPublishPreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, LocalFileDiff>>({});
  const [loading, setLoading] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const request = useRef(0);
  const english = readLanguage() === 'en';
  const t = (zh: string, en: string): string => english ? en : zh;
  const errorText = (cause: unknown, fallback: string): string => cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : fallback;
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setPreview(null); setSelected([]); setOpen(null); setDiffs({}); setError(''); setLoading(null);
    onSelection(id, null);
    setReading(true);
    void window.easyHub?.localPreviewChanges(id).then((next) => {
      if (!active || current !== generation.current) return;
      const paths = next.pendingPublish ? [] : next.files.map((file) => file.path);
      setPreview(next); setSelected(paths);
      onSelection(id, next.needsReview ? null : { snapshot: next.snapshot, paths }, next.pendingPublish);
    }).catch((cause: unknown) => { if (active && current === generation.current) setError(errorText(cause, t('无法读取修改，请重新读取。', 'Could not load changes. Please refresh.'))); })
      .finally(() => { if (active && current === generation.current) setReading(false); });
    return () => { active = false; generation.current++; };
  // Text does not change the selected snapshot when the interface language changes.
  }, [id, refreshKey, revision, onSelection]);

  function select(paths: string[]): void {
    if (!preview) return;
    setSelected(paths); onSelection(id, preview.needsReview ? null : { snapshot: preview.snapshot, paths }, preview.pendingPublish);
  }
  async function cancelReading(): Promise<void> {
    const current = ++generation.current; onSelection(id, null);
    setReading(false); setLoading(null); setOpen(null);
    try { await window.easyHub?.localCancelPreview(id); if (current === generation.current) setError(t('已取消读取，可以重新读取修改。', 'Reading cancelled. Refresh changes to try again.')); }
    catch (cause) { if (current === generation.current) setError(errorText(cause, t('无法取消，请稍后重新读取。', 'Could not cancel. Please refresh shortly.'))); }
  }
  async function showDiff(path: string): Promise<void> {
    if (!preview) return;
    if (open === path) { setOpen(null); return; }
    setOpen(path); setError('');
    if (diffs[path]) return;
    const current = generation.current; const requestId = ++request.current;
    setLoading(path);
    try {
      const next = await window.easyHub!.localFileDiff(id, path, preview.snapshot);
      if (current === generation.current) setDiffs((old) => ({ ...old, [path]: next }));
    } catch (cause) {
      if (current === generation.current && requestId === request.current) {
        setError(errorText(cause, t('无法预览，请重新读取修改。', 'Could not preview this file. Please refresh changes.')));
        onSelection(id, null);
      }
    } finally { if (current === generation.current && requestId === request.current) setLoading(null); }
  }
  const verbs = english ? { added: 'Added', modified: 'Modified', deleted: 'Deleted', renamed: 'Renamed' } : { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' };
  return <section className="local-selection" aria-label={t('本次发布文件', 'Files to publish')}>
    <div className="local-selection-heading"><div><strong>{t('本次发布文件', 'Files to publish')}</strong><span>{preview ? t(`已选 ${selected.length} / ${preview.files.length} 个文件`, `${selected.length} / ${preview.files.length} files selected`) : reading ? t('正在读取修改…', 'Loading changes…') : ''}</span></div>{(reading || loading) && <button className="text-link" type="button" disabled={disabled} onClick={() => void cancelReading()}>{t('取消读取', 'Cancel reading')}</button>}<button className="text-link" type="button" disabled={disabled || reading} onClick={() => setRevision((value) => value + 1)}><RotateCw size={14} />{t('重新读取', 'Refresh changes')}</button></div>
    <p className="local-selection-hint">{t('只发布勾选的文件，未选修改继续保留在电脑上。', 'Only selected files are published. Other changes stay on this computer.')}</p>
    {error && <p className="live-error" role="alert">{error}</p>}
    {preview && preview.files.length > 0 && <label className="local-selection-all"><input type="checkbox" checked={selected.length === preview.files.length} disabled={disabled || preview.needsReview || preview.pendingPublish} onChange={(event) => select(event.target.checked ? preview.files.map((file) => file.path) : [])} />{t('全选', 'Select all')}</label>}
    {preview?.files.map((file) => { const diff = diffs[file.path]; return <div className="local-selection-file" key={file.path}>
      <div className="local-selection-row"><label><input type="checkbox" aria-label={`${t('发布', 'Publish')} ${file.path}`} checked={selected.includes(file.path)} disabled={disabled || preview.needsReview || preview.pendingPublish} onChange={(event) => select(event.target.checked ? [...selected, file.path] : selected.filter((path) => path !== file.path))} /><span className={`local-change-kind ${file.kind}`}>{verbs[file.kind]}</span><span className="local-selection-path" data-content-original="true" title={file.path}>{file.previousPath ? `${file.previousPath} → ` : ''}{file.path}</span></label><button type="button" className="text-link" disabled={disabled} aria-expanded={open === file.path} onClick={() => void showDiff(file.path)}>{open === file.path ? t('收起不同', 'Hide changes') : t('查看不同', 'View changes')}<ChevronDown size={14} /></button></div>
      {open === file.path && <div className="local-diff-panel">{loading === file.path ? <p role="status">{t('正在读取文件…', 'Loading file…')}</p> : diff?.unavailable ? <p>{diff.unavailable === 'binary' ? t('这是图片、程序或其他非文本文件，无法逐行预览；仍可勾选发布。', 'This is an image, program, or other non-text file. It can still be selected for publishing.') : t('这个文件较大，无法逐行预览；请在本地查看后再勾选发布。', 'This file is too large for a line preview. Check it locally before publishing.')}</p> : diff && <><div className="local-diff-summary"><span>+{diff.additions}</span><span>−{diff.deletions}</span>{file.kind === 'renamed' && !diff.additions && !diff.deletions && <small>{t('文件内容未变', 'File contents unchanged')}</small>}</div><CodeExplanation source={{ kind: 'local', projectId: id, snapshot: preview.snapshot, path: file.path }} language={english ? 'en' : 'zh'}><div className="local-diff-lines" data-code-selection-region data-content-original="true" tabIndex={0} aria-label={t('逐行修改预览', 'Line-by-line changes')}>{diff.lines.map((line, index) => <div className={`local-diff-line ${line.kind}`} key={index}><span aria-hidden="true">{line.before ?? ''}</span><span aria-hidden="true">{line.after ?? ''}</span><span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ' '}</span><code data-explain-code>{line.text}</code></div>)}</div></CodeExplanation></>}</div>}
    </div>; })}
    {preview && !preview.files.length && <p className="muted">{preview.pendingPublish ? t('有已保存的本地版本等待上传，可以重试发布。', 'A saved local version is waiting to upload. You can retry publishing.') : t('目前没有尚未发布的修改。', 'There are no unpublished changes.')}</p>}
  </section>;
}
