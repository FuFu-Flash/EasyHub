import { useEffect, useRef, useState } from 'react';
import { createDownloadTransferSampler } from './downloadTransfer';
import type { DownloadCommand, DownloadItem, DownloadRequest } from '../../../downloads';
export type { DownloadItem, DownloadRequest } from '../../../downloads';

export function useDownloadCenter(onProjectDownloaded: () => Promise<void>) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [open, setOpen] = useState(false);
  const active = useRef<string | null>(null);
  const starting = useRef(false);
  const nextId = useRef(1);
  const managed = Boolean(window.easyHub?.downloadsList);
  const onDownloaded = useRef(onProjectDownloaded);
  onDownloaded.current = onProjectDownloaded;
  useEffect(() => {
    const api = window.easyHub;
    if (!api?.downloadsList) return;
    let alive = true;
    let receivedEvent = false;
    const completed = new Set<string>();
    const accept = (next: DownloadItem[]): void => {
      if (!alive) return;
      setItems((current) => [...current.filter((item) => item.id.startsWith('download-') && item.state === 'failed'), ...next]);
      for (const item of next) if (item.state === 'complete' && item.request.kind === 'project' && !completed.has(item.id)) {
        completed.add(item.id); void onDownloaded.current().catch(() => undefined);
      }
    };
    const stop = api.onDownloadsChanged((next) => { receivedEvent = true; accept(next); });
    void api.downloadsList().then((next) => { if (!receivedEvent) accept(next); }).catch(() => undefined);
    return () => { alive = false; stop(); };
  }, []);
  const unread = items.filter((item) => ['complete', 'failed', 'cancelled'].includes(item.state) && !item.seen).length;
  useEffect(() => {
    if (open && unread) {
      if (managed) for (const item of items) if (!item.id.startsWith('download-') && !item.seen && ['complete', 'failed', 'cancelled'].includes(item.state)) void window.easyHub?.downloadsCommand(item.id, 'seen').catch(() => undefined);
      setItems((current) => current.map((item) => ['complete', 'failed', 'cancelled'].includes(item.state) && !item.seen ? { ...item, seen: true } : item));
    }
  }, [open, unread]);

  function change(id: string, update: Partial<DownloadItem>): void {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function start(request: DownloadRequest, retryId?: string): Promise<void> {
    const api = window.easyHub;
    if (api?.downloadsEnqueue) {
      setOpen(true);
      try {
        if (retryId && request.kind !== 'project' && items.some((item) => item.id === retryId) && !retryId.startsWith('download-')) await api.downloadsCommand(retryId, 'resume');
        else {
          const item = await api.downloadsEnqueue(request);
          if (item && retryId && item.id !== retryId) {
            if (!retryId.startsWith('download-')) await api.downloadsCommand(retryId, 'remove');
            setItems((current) => current.filter((old) => old.id !== retryId));
          }
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '无法开始下载，请稍后重试。';
        const failed: DownloadItem = { id: retryId?.startsWith('download-') ? retryId : `download-${nextId.current++}`, request, state: 'failed', loaded: 0, total: null, bytesPerSecond: null, percent: null, phase: '无法开始下载', error, seen: false };
        setItems((current) => [failed, ...current.filter((item) => item.id !== failed.id)]);
      }
      return;
    }
    if (!api || active.current || starting.current) { setOpen(true); return; }
    starting.current = true;
    let parent: string | null = null;
    try {
      if (request.kind === 'project') parent = await api.chooseFolder();
      if (request.kind === 'project' && !parent) return;
      const id = retryId ?? `download-${nextId.current++}`;
      const item: DownloadItem = { id, request, state: 'running', percent: null, loaded: 0, total: null, bytesPerSecond: null, phase: '正在准备下载…', seen: true };
      setItems((current) => retryId ? current.map((old) => old.id === id ? item : old) : [item, ...current].slice(0, 10));
      setOpen(true);
      active.current = id;
      starting.current = false;
      const sampleSpeed = createDownloadTransferSampler(Date.now());
      const stop = request.kind === 'project'
        ? api.onLocalProgress((progress) => {
          const percent = progress.total ? Math.min(99, Math.round(100 * (progress.loaded ?? 0) / progress.total)) : null;
          change(id, { phase: progress.phase, loaded: progress.loaded ?? 0, total: progress.total ?? null, percent });
        })
        : api.onDownloadProgress((progress) => {
          const speed = sampleSpeed(progress.loaded, Date.now());
          change(id, { phase: '正在下载…', loaded: progress.loaded, total: progress.total, percent: progress.percent, bytesPerSecond: speed });
        });
      try {
        if (request.kind === 'project') {
          const link = await api.localDownload(request.repo.owner.login, request.repo.name, parent!);
          change(id, { state: 'complete', phase: '项目已经下载完成。', percent: 100, localLinkId: link.id, path: link.localPath, seen: false });
          await onProjectDownloaded().catch(() => undefined);
        } else {
          const path = request.kind === 'pull-file'
            ? await api.downloadPullRequestFile(request.repo.owner.login, request.repo.name, request.number, request.path, request.headSha)
            : request.assetId === undefined
            ? await api.downloadArchive(request.repo.owner.login, request.repo.name, request.ref)
            : await api.downloadReleaseAsset(request.repo.owner.login, request.repo.name, request.assetId);
          if (path) change(id, { state: 'complete', phase: request.kind === 'pull-file' ? '修改文件已经下载完成。' : '项目已经下载完成。', percent: 100, path, seen: false });
          else setItems((current) => current.filter((old) => old.id !== id));
        }
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : '下载失败，请稍后重试。';
        change(id, { state: error.includes('取消') ? 'cancelled' : 'failed', phase: error.includes('取消') ? '已取消' : '下载失败', error, seen: false });
      } finally { stop(); active.current = null; }
    } catch (cause) {
      const id = `download-${nextId.current++}`;
      const failed: DownloadItem = { id, request, state: 'failed', percent: null, loaded: 0, total: null, bytesPerSecond: null, phase: '下载失败', error: cause instanceof Error ? cause.message : '无法选择保存位置。', seen: false };
      setItems((current) => [failed, ...current].slice(0, 10));
      setOpen(true);
    }
    finally { starting.current = false; }
  }

  async function cancel(id: string): Promise<void> {
    if (managed) { await control(id, 'cancel'); return; }
    if (active.current !== id || !window.easyHub) return;
    const item = items.find((entry) => entry.id === id);
    if (item?.request.kind === 'project') await window.easyHub.localCancel();
    else await window.easyHub.cancelArchive();
  }

  async function openFolder(item: DownloadItem): Promise<void> {
    if (!window.easyHub) return;
    try {
      if (managed && !item.id.startsWith('download-')) { await window.easyHub.downloadsOpen(item.id, true); return; }
      if (item.localLinkId) await window.easyHub.localOpenFolder(item.localLinkId);
      else if (item.path) await window.easyHub.revealDownloadedArchive(item.path);
    } catch (cause) { change(item.id, { error: cause instanceof Error ? cause.message : '无法打开文件夹。' }); }
  }

  async function openFile(item: DownloadItem): Promise<void> {
    if (!item.path || item.request.kind === 'project' || !window.easyHub) return;
    try { if (managed && !item.id.startsWith('download-')) await window.easyHub.downloadsOpen(item.id, false); else await window.easyHub.openDownloadedFile(item.path); }
    catch (cause) { change(item.id, { error: cause instanceof Error ? cause.message : '无法打开文件。' }); }
  }

  async function control(id: string, command: DownloadCommand): Promise<void> {
    try { await window.easyHub?.downloadsCommand(id, command); }
    catch (cause) { change(id, { error: cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '操作未完成，请重试。' }); }
  }

  return {
    items, open, setOpen, start, cancel, openFolder, openFile, unread,
    pause: (id: string) => control(id, 'pause'),
    resume: (id: string) => control(id, 'resume'),
    dismiss: (id: string) => { if (managed && !id.startsWith('download-')) void control(id, 'remove'); else setItems((current) => current.filter((item) => item.id !== id || item.state === 'running')); },
    clearFinished: () => { if (managed) void window.easyHub?.downloadsClear().catch(() => undefined); setItems((current) => current.filter((item) => !['complete', 'cancelled', 'failed'].includes(item.state))); },
    busy: managed ? false : items.some((item) => item.state === 'running'),
    supportsPause: managed,
  };
}
