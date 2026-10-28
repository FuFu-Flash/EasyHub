import { useTranslation, useLanguage } from '../localization';
import { useEasyHub } from '../bridge';
import { ErrorMessage } from './ErrorMessage';
import { errorText } from '../errors';
import { useEffect, useRef, useState } from 'react';
import type { ChangedFile, LocalFileDiff, LocalPublishBatch, LocalPublishPreview, LocalPublishSelection } from '@easyhub/types';
import { ChevronDown, RotateCw } from 'lucide-react';

import { CodeExplanation } from './CodeExplanation';
import { sensitiveFileReasons } from '../../../shared/sensitiveFiles';
import { sensitiveReasonText } from '../sensitiveReasonText';

interface Props {
  id: string;
  refreshKey: number;
  disabled: boolean;
  onSelection: (
    id: string,
    selection: LocalPublishSelection | null,
    pending?: boolean,
    sensitiveFiles?: ChangedFile[],
  ) => void;
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
  const [split, setSplit] = useState(false);
  const [groupCount, setGroupCount] = useState(2);
  const [groupOf, setGroupOf] = useState<Record<string, number>>({});
  const [groupNotes, setGroupNotes] = useState<string[]>([]);
  const generation = useRef(0);
  const request = useRef(0);
  const selectAll = useRef<HTMLInputElement>(null);
  const english = useLanguage() === 'en';

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setPreview(null);
    setSelected([]);
    setOpen(null);
    setDiffs({});
    setError('');
    setLoading(null);
    setSplit(false);
    setGroupCount(2);
    setGroupOf({});
    setGroupNotes([]);
    onSelection(id, null);
    setReading(true);
    void easyHub
      ?.localPreviewChanges(id)
      .then((next) => {
        if (!active || current !== generation.current) return;
        next = {
          ...next,
          files: next.files.map((file) =>
            file.kind === 'deleted'
              ? file
              : {
                  ...file,
                  sensitiveReasons: [
                    ...new Set([...(file.sensitiveReasons ?? []), ...sensitiveFileReasons(file.path)]),
                  ],
                },
          ),
        };
        const paths = next.pendingPublish
          ? []
          : next.files.filter((file) => !file.sensitiveReasons?.length).map((file) => file.path);
        setPreview(next);
        setSelected(paths);
        onSelection(id, next.needsReview ? null : { snapshot: next.snapshot, paths }, next.pendingPublish);
      })
      .catch((cause: unknown) => {
        if (active && current === generation.current)
          setError(errorText(cause, t('localChangeSelector.couldNotLoadChangesPleaseRefresh')));
      })
      .finally(() => {
        if (active && current === generation.current) setReading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
    // Text does not change the selected snapshot when the interface language changes.
  }, [id, refreshKey, revision, onSelection]);
  useEffect(() => {
    // A partly selected list shows the mixed state instead of an empty "select all".
    if (selectAll.current)
      selectAll.current.indeterminate = selected.length > 0 && selected.length < (preview?.files.length ?? 0);
  }, [selected, preview]);

  function report(
    paths: string[],
    grouping: { split: boolean; count: number; of: Record<string, number>; notes: string[] } = {
      split,
      count: groupCount,
      of: groupOf,
      notes: groupNotes,
    },
  ): void {
    if (!preview) return;
    // Several groups are sent in order; one group (or none) is the ordinary single save.
    const groups: LocalPublishBatch[] = grouping.split
      ? Array.from({ length: grouping.count }, (_, index) => ({
          paths: paths.filter((path) => (grouping.of[path] ?? 0) === index),
          message: grouping.notes[index]?.trim() || undefined,
        })).filter((group) => group.paths.length)
      : [];
    const batches = groups.length > 1 ? groups : undefined;
    onSelection(
      id,
      preview.needsReview
        ? null
        : { snapshot: preview.snapshot, paths: batches ? batches.flatMap((batch) => batch.paths) : paths, batches },
      preview.pendingPublish,
      preview.files.filter((file) => paths.includes(file.path) && file.sensitiveReasons?.length),
    );
  }
  function select(paths: string[]): void {
    setSelected(paths);
    report(paths);
  }
  function changeSplit(value: boolean): void {
    setSplit(value);
    report(selected, { split: value, count: groupCount, of: groupOf, notes: groupNotes });
  }
  function changeGroup(path: string, index: number): void {
    const of = { ...groupOf, [path]: index };
    setGroupOf(of);
    report(selected, { split, count: groupCount, of, notes: groupNotes });
  }
  function addGroup(): void {
    const count = Math.min(groupCount + 1, 10);
    setGroupCount(count);
    report(selected, { split, count, of: groupOf, notes: groupNotes });
  }
  function changeNote(index: number, value: string): void {
    const notes = [...groupNotes];
    notes[index] = value;
    setGroupNotes(notes);
    report(selected, { split, count: groupCount, of: groupOf, notes });
  }
  async function cancelReading(): Promise<void> {
    const current = ++generation.current;
    onSelection(id, null);
    setReading(false);
    setLoading(null);
    setOpen(null);
    try {
      await easyHub?.localCancelPreview(id);
      if (current === generation.current) setError(t('localChangeSelector.readingCancelledRefreshChangesToTryAgain'));
    } catch (cause) {
      if (current === generation.current)
        setError(errorText(cause, t('localChangeSelector.couldNotCancelPleaseRefreshShortly')));
    }
  }
  async function showDiff(path: string): Promise<void> {
    if (!preview) return;
    if (open === path) {
      setOpen(null);
      return;
    }
    setOpen(path);
    setError('');
    if (diffs[path]) return;
    const current = generation.current;
    const requestId = ++request.current;
    setLoading(path);
    try {
      const next = await easyHub!.localFileDiff(id, path, preview.snapshot);
      if (current === generation.current) setDiffs((old) => ({ ...old, [path]: next }));
    } catch (cause) {
      if (current === generation.current && requestId === request.current) {
        setError(errorText(cause, t('localChangeSelector.couldNotPreviewThisFilePleaseRefreshChanges')));
        onSelection(id, null);
      }
    } finally {
      if (current === generation.current && requestId === request.current) setLoading(null);
    }
  }
  const verbs = {
    added: t('localChangeSelector.added'),
    modified: t('localChangeSelector.modified'),
    deleted: t('localChangeSelector.deleted'),
    renamed: t('localChangeSelector.renamed'),
  };
  // With several groups the list is shown group by group, each group under its own heading and note.
  const grouped = split && !preview?.pendingPublish;
  const orderedFiles = [...(preview?.files ?? [])].sort((a, b) => {
    if (!grouped) return 0;
    const rank = (file: ChangedFile) => (selected.includes(file.path) ? (groupOf[file.path] ?? 0) : groupCount);
    return rank(a) - rank(b);
  });
  const seenGroups = new Set<number>();
  return (
    <section className="local-selection" aria-label={t('localChangeSelector.filesToPublish')}>
      <div className="local-selection-heading">
        <div>
          <strong>{t('localChangeSelector.filesToPublish')}</strong>
          <span>
            {preview
              ? t('localChangeSelector.filesSelected', { p0: selected.length, p1: preview.files.length })
              : reading
                ? t('localChangeSelector.loadingChanges')
                : ''}
          </span>
        </div>
        {(reading || loading) && (
          <button className="text-link" type="button" disabled={disabled} onClick={() => void cancelReading()}>
            {t('localChangeSelector.cancelReading')}
          </button>
        )}
        <button
          className="text-link"
          type="button"
          disabled={disabled || reading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RotateCw size={14} />
          {t('localChangeSelector.refreshChanges')}
        </button>
      </div>
      {error && (
        <p className="live-error" role="alert">
          <ErrorMessage error={error} />
        </p>
      )}
      {preview && preview.files.length > 0 && (
        <label className="local-selection-all">
          <input
            ref={selectAll}
            type="checkbox"
            checked={selected.length === preview.files.length}
            disabled={disabled || preview.needsReview || preview.pendingPublish}
            onChange={(event) => select(event.target.checked ? preview.files.map((file) => file.path) : [])}
          />
          {t('localChangeSelector.selectAll')}
        </label>
      )}
      {preview && selected.length > 1 && !preview.needsReview && !preview.pendingPublish && (
        <div className="local-split">
          <label>
            <input
              type="checkbox"
              checked={split}
              disabled={disabled}
              onChange={(event) => changeSplit(event.target.checked)}
            />
            {t('localChangeSelector.splitIntoVersions')}
          </label>
          {split && (
            <>
              <small>{t('localChangeSelector.splitHint')}</small>
              <button className="text-link" type="button" disabled={disabled || groupCount >= 10} onClick={addGroup}>
                {t('localChangeSelector.addGroup')}
              </button>
            </>
          )}
        </div>
      )}
      {preview && orderedFiles.map((file) => {
        const diff = diffs[file.path];
        const group = groupOf[file.path] ?? 0;
        const firstOfGroup = grouped && selected.includes(file.path) && !seenGroups.has(group) && seenGroups.add(group);
        return (
          <div className="local-selection-file" key={file.path}>
            {firstOfGroup && (
              <div className="local-group-head">
                <strong>{t('localChangeSelector.groupName', { p0: group + 1 })}</strong>
                <input
                  aria-label={t('localChangeSelector.groupNote', { p0: group + 1 })}
                  placeholder={t('localChangeSelector.groupNote', { p0: group + 1 })}
                  maxLength={200}
                  disabled={disabled}
                  value={groupNotes[group] ?? ''}
                  onChange={(event) => changeNote(group, event.target.value)}
                />
              </div>
            )}
            <div className="local-selection-row">
              <label>
                <input
                  type="checkbox"
                  aria-label={t('localChangeSelector.publishFileLabel', {
                    p0: t('localChangeSelector.publish'),
                    p1: file.path,
                  })}
                  checked={selected.includes(file.path)}
                  disabled={disabled || preview.needsReview || preview.pendingPublish}
                  onChange={(event) =>
                    select(
                      event.target.checked ? [...selected, file.path] : selected.filter((path) => path !== file.path),
                    )
                  }
                />
                <span className={`local-change-kind ${file.kind}`}>{verbs[file.kind]}</span>
                <span className="local-selection-path" data-content-original="true" title={file.path}>
                  {file.previousPath ? `${file.previousPath} → ` : ''}
                  {file.path}
                </span>
                {file.sensitiveReasons?.length ? (
                  <span className="local-sensitive-tag">
                    {selected.includes(file.path)
                      ? t('localChangeSelector.sensitiveIncluded')
                      : t('localChangeSelector.sensitiveSkipped')}
                  </span>
                ) : null}
              </label>
              {split && selected.includes(file.path) && !preview.pendingPublish && (
                <select
                  className="local-group-select"
                  aria-label={t('localChangeSelector.groupOfFile', { p0: file.path })}
                  disabled={disabled}
                  value={groupOf[file.path] ?? 0}
                  onChange={(event) => changeGroup(file.path, Number(event.target.value))}
                >
                  {Array.from({ length: groupCount }, (_, index) => (
                    <option key={index} value={index}>
                      {t('localChangeSelector.groupName', { p0: index + 1 })}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="text-link"
                disabled={disabled}
                aria-expanded={open === file.path}
                onClick={() => void showDiff(file.path)}
              >
                {open === file.path ? t('localChangeSelector.hideChanges') : t('localChangeSelector.viewChanges')}
                <ChevronDown size={14} />
              </button>
            </div>
            {open === file.path && (
              <div className="local-diff-panel">
                {loading === file.path ? (
                  <p role="status">{t('localChangeSelector.loadingFile')}</p>
                ) : diff?.unavailable ? (
                  <p>
                    {diff.unavailable === 'binary'
                      ? t('localChangeSelector.thisIsAnImageProgramOrOtherNonText')
                      : t('localChangeSelector.thisFileIsTooLargeForALinePreview')}
                  </p>
                ) : (
                  diff && (
                    <>
                      <div className="local-diff-summary">
                        <span>+{diff.additions}</span>
                        <span>−{diff.deletions}</span>
                        {file.kind === 'renamed' && !diff.additions && !diff.deletions && (
                          <small>{t('localChangeSelector.fileContentsUnchanged')}</small>
                        )}
                      </div>
                      <CodeExplanation
                        source={{ kind: 'local', projectId: id, snapshot: preview.snapshot, path: file.path }}
                        language={english ? 'en' : 'zh'}
                      >
                        <div
                          className="local-diff-lines"
                          data-code-selection-region
                          data-content-original="true"
                          tabIndex={0}
                          aria-label={t('localChangeSelector.lineByLineChanges')}
                        >
                          {diff.lines.map((line, index) => (
                            <div className={`local-diff-line ${line.kind}`} key={index}>
                              <span aria-hidden="true">{line.before ?? ''}</span>
                              <span aria-hidden="true">{line.after ?? ''}</span>
                              <span aria-hidden="true">
                                {line.kind === 'added' ? '+' : line.kind === 'deleted' ? '−' : ' '}
                              </span>
                              <code data-explain-code>{line.text}</code>
                            </div>
                          ))}
                        </div>
                      </CodeExplanation>
                    </>
                  )
                )}
              </div>
            )}
            {file.sensitiveReasons?.length ? (
              <details className="local-sensitive-warning">
                <summary>{t('localChangeSelector.mayContainPasswordsOrKeys')}</summary>
                <ul>
                  {file.sensitiveReasons.map((reason) => (
                    <li key={reason}>{sensitiveReasonText(reason, english ? 'en' : 'zh')}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        );
      })}
      {preview && !preview.files.length && (
        <p className="muted">
          {preview.pendingPublish
            ? t('localChangeSelector.savedLocalChangesAreWaitingToUploadYouCan')
            : t('localChangeSelector.thereAreNoUnpublishedChanges')}
        </p>
      )}
    </section>
  );
}
