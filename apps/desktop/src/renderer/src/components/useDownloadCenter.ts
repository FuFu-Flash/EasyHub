import { useEffect, useRef, useState } from 'react';
import type { GitHubRepo } from '@easyhub/github';
import { createDownloadTransferSampler } from './downloadTransfer';

export type DownloadRequest =
  | { kind: 'archive'; repo: GitHubRepo; ref: string; assetId?: number; fileName: string; offerAdd?: boolean }
  | { kind: 'project'; repo: GitHubRepo; fileName: string };

export interface DownloadItem {
  id: string;
  request: DownloadRequest;
  state: 'running' | 'complete' | 'failed' | 'cancelled';
  percent: number | null;
  loaded: number;
  total: number | null;
  bytesPerSecond: number | null;
  phase: string;
  path?: string;
  localLinkId?: string;
  error?: string;
  seen: boolean;
}

export function useDownloadCenter(onProjectDownloaded: () => Promise<void>) {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [open, setOpen] = useState(false);
  const active = useRef<string | null>(null);
  const starting = useRef(false);
  const nextId = useRef(1);
  const unread = items.filter((item) => item.state !== 'running' && !item.seen).length;
  useEffect(() => {
    if (open && unread) setItems((current) => current.map((item) => item.state !== 'running' && !item.seen ? { ...item, seen: true } : item));
  }, [open, unread]);

  function change(id: string, update: Partial<DownloadItem>): void {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function start(request: DownloadRequest, retryId?: string): Promise<void> {
    const api = window.easyHub;
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
          const path = request.assetId === undefined
            ? await api.downloadArchive(request.repo.owner.login, request.repo.name, request.ref)
            : await api.downloadReleaseAsset(request.repo.owner.login, request.repo.name, request.assetId);
          if (path) change(id, { state: 'complete', phase: '项目已经下载完成。', percent: 100, path, seen: false });
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
    if (active.current !== id || !window.easyHub) return;
    const item = items.find((entry) => entry.id === id);
    if (item?.request.kind === 'project') await window.easyHub.localCancel();
    else await window.easyHub.cancelArchive();
  }

  async function openFolder(item: DownloadItem): Promise<void> {
    if (!window.easyHub) return;
    try {
      if (item.localLinkId) await window.easyHub.localOpenFolder(item.localLinkId);
      else if (item.path) await window.easyHub.revealDownloadedArchive(item.path);
    } catch (cause) { change(item.id, { error: cause instanceof Error ? cause.message : '无法打开文件夹。' }); }
  }

  async function openFile(item: DownloadItem): Promise<void> {
    if (!item.path || item.request.kind !== 'archive' || !window.easyHub) return;
    try { await window.easyHub.openDownloadedFile(item.path); }
    catch (cause) { change(item.id, { error: cause instanceof Error ? cause.message : '无法打开文件。' }); }
  }

  return {
    items, open, setOpen, start, cancel, openFolder, openFile, unread,
    dismiss: (id: string) => setItems((current) => current.filter((item) => item.id !== id || item.state === 'running')),
    clearFinished: () => setItems((current) => current.filter((item) => item.state === 'running')),
    busy: items.some((item) => item.state === 'running'),
  };
}
