import { useTranslation, useLanguage } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useRef, useState } from 'react';
import type { ChangedFile, LocalFileDiff, LocalPublishPreview, LocalPublishSelection } from '@easyhub/types';
import { ChevronDown, RotateCw } from 'lucide-react';

import { CodeExplanation } from './CodeExplanation';
import { sensitiveFileReasons } from '../../../shared/sensitiveFiles';
import { sensitiveReasonText } from '../sensitiveReasonText';

interface Props {
  id: string;
  refreshKey: number;
  disabled: boolean;
  onSelection: (id: string, selection: LocalPublishSelection | null, pending?: boolean, sensitiveFiles?: ChangedFile[]) => void;
}
export function LocalChangeSelector({ id, refreshKey, disabled, onSelection }: Props) {
  const t = useTranslation();
  const easyHub = useEasyHub();
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
  const english = useLanguage() === 'en';
  
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setPreview(null); setSelected([]); setOpen(null); setDiffs({}); setError(''); setLoading(null);
    onSelection(id, null);
    setReading(true);
    void easyHub?.localPreviewChanges(id).then((next) => {
      if (!active || current !== generation.current) return;
      next = { ...next, files: next.files.map((file) => file.kind === 'deleted' ? file : { ...file, sensitiveReasons: [...new Set([...(file.sensitiveReasons ?? []), ...sensitiveFileReasons(file.path)])] }) };
      const paths = next.pendingPublish ? [] : next.files.filter((file) => !file.sensitiveReasons?.length).map((file) => file.path);
      setPreview(next); setSelected(paths);
      onSelection(id, next.needsReview ? null : { snapshot: next.snapshot, paths }, next.pendingPublish);
    }).catch((cause: unknown) => { if (active && current === generation.current) setError(errorText(cause, t("localChangeSelector.couldNotLoadChangesPleaseRefresh"))); })
      .finally(() => { if (active && current === generation.current) setReading(false); });
    return () => { active = false; generation.current++; };
  // Text does not change the selected snapshot when the interface language changes.
  }, [id, refreshKey, revision, onSelection]);

  function select(paths: string[]): void {
    if (!preview) return;
    setSelected(paths); onSelection(id, preview.needsReview ? null : { snapshot: preview.snapshot, paths }, preview.pendingPublish, preview.files.filter((file) => paths.includes(file.path) && file.sensitiveReasons?.length));
  }
  async function cancelReading(): Promise<void> {
    const current = ++generation.current; onSelection(id, null);
    setReading(false); setLoading(null); setOpen(null);
    try { await easyHub?.localCancelPreview(id); if (current === generation.current) setError(t("localChangeSelector.readingCancelledRefreshChangesToTryAgain")); }
    catch (cause) { if (current === generation.current) setError(errorText(cause, t("localChangeSelector.couldNotCancelPleaseRefreshShortly"))); }
  }
  async function showDiff(path: string): Promise<void> {
    if (!preview) return;
    if (open === path) { setOpen(null); return; }
    setOpen(path); setError('');
    if (diffs[path]) return;
    const current = generation.current; const requestId = ++request.current;
    setLoading(path);
    try {
      const next = await easyHub!.localFileDiff(id, path, preview.snapshot);
      if (current === generation.current) setDiffs((old) => ({ ...old, [path]: next }));
    } catch (cause) {
      if (current === generation.current && requestId === request.current) {
        setError(errorText(cause, t("localChangeSelector.couldNotPreviewThisFilePleaseRefreshChanges")));
        onSelection(id, null);
      }
    } finally { if (current === generation.current && requestId === request.current) setLoading(null); }
  }
  const verbs = { added: t("localChangeSelector.added"), modified: t("localChangeSelector.modified"), deleted: t("localChangeSelector.deleted"), renamed: t("localChangeSelector.renamed") };
  return <section className="local-selection" aria-label={t("localChangeSelector.filesToPublish")}>
    <div className="local-selection-heading"><div><strong>{t("localChangeSelector.filesToPublish")}</strong><span>{preview ? t("localChangeSelector.filesSelected", { p0: selected.length, p1: preview.files.length }) : reading ? t("localChangeSelector.loadingChanges") : ''}</span></div>{(reading || loading) && <button className="text-link" type="button" disabled={disabled} onClick={() => void cancelReading()}>{t("localChangeSelector.cancelReading")}</button>}<button className="text-link" type="button" disabled={disabled || reading} onClick={() => setRevision((value) => value + 1)}><RotateCw size={14} />{t("localChangeSelector.refreshChanges")}</button></div>
    <p className="local-selection-hint">{t("localChangeSelector.onlySelectedFilesArePublishedOtherChangesStayOn")}</p>
    {error && <p className="live-error" role="alert"><ErrorMessage error={error} /></p>}
    {preview && preview.files.length > 0 && <label className="local-selection-all"><input type="checkbox" checked={selected.length === preview.files.length} disabled={disabled || preview.needsReview || preview.pendingPublish} onChange={(event) => select(event.target.checked ? preview.files.map((file) => file.path) : [])} />{t("localChangeSelector.selectAll")}</label>}
    {preview?.files.map((file) => { const diff = diffs[file.path]; return <div className="local-selection-file" key={file.path}>
      <div className="local-selection-row"><label><input type="checkbox" aria-label={t("localChangeSelector.publishFileLabel", { p0: t("localChangeSelector.publish"), p1: file.path })} checked={selected.includes(file.path)} disabled={disabled || preview.needsReview || preview.pendingPublish} onChange={(event) => select(event.target.checked ? [...selected, file.path] : selected.filter((path) => path !== file.path))} /><span className={`local-change-kind ${file.kind}`}>{verbs[file.kind]}</span><span className="local-selection-path" data-content-original="true" title={file.path}>{file.previousPath ? `${file.previousPath} → ` : ''}{file.path}</span></label><button type="button" className="text-link" disabled={disabled} aria-expanded={open === file.path} onClick={() => void showDiff(file.path)}>{open === file.path ? t("localChangeSelector.hideChanges") : t("localChangeSelector.viewChanges")}<ChevronDown size={14} /></button></div>
      {open === file.path && <div className="local-diff-panel">{loading === file.path ? <p role="status">{t("localChangeSelector.loadingFile")}</p> : diff?.unavailable ? <p>{diff.unavailable === 'binary' ? t("localChangeSelector.thisIsAnImageProgramOrOtherNonText") : t("localChangeSelector.thisFileIsTooLargeForALinePreview")}</p> : diff && <><div className="local-diff-summary"><span>+{diff.additions}</span><span>−{diff.deletions}</span>{file.kind === 'renamed' && !diff.additions && !diff.deletions && <small>{t("localChangeSelector.fileContentsUnchanged")}</small>}</div><CodeExplanation source={{ kind: 'local', projectId: id, snapshot: preview.snapshot, path: file.path }} language={english ? 'en' : 'zh'}><div className="local-diff-lines" data-code-selection-region data-content-original="true" tabIndex={0} aria-label={t("localChangeSelector.lineByLineChanges")}>{diff.lines.map((line, index) => <div className={`local-diff-line ${line.kind}`} key={index}><span aria-hidden="true">{line.before ?? ''}</span><span aria-hidden="true">{line.after ?? ''}</span><span aria-hidden="true">{line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ' '}</span><code data-explain-code>{line.text}</code></div>)}</div></CodeExplanation></>}</div>}
      {file.sensitiveReasons?.length ? <details className="local-sensitive-warning"><summary>{t("localChangeSelector.mayContainPasswordsOrKeys")}</summary><ul>{file.sensitiveReasons.map((reason) => <li key={reason}>{sensitiveReasonText(reason, english ? 'en' : 'zh')}</li>)}</ul></details> : null}
    </div>; })}
    {preview && !preview.files.length && <p className="muted">{preview.pendingPublish ? t("localChangeSelector.savedLocalChangesAreWaitingToUploadYouCan") : t("localChangeSelector.thereAreNoUnpublishedChanges")}</p>}
  </section>;
}
