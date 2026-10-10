import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { createDownloadTracker, type DownloadProgress } from './downloadProgress';
import { transferArchive, type ArchiveDownloadTarget, type ArchiveTransport } from './archiveDownload';

interface TransferState { status: 'idle' | 'running' | 'complete' | 'cancelled' | 'failed'; target: ArchiveDownloadTarget | null; progress: DownloadProgress | null }

export function useArchiveDownload(transport: ArchiveTransport) {
  const [state, setState] = useState<TransferState>({ status: 'idle', target: null, progress: null });
  const current = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current?.abort(); };
  }, []);
  const cancel = useCallback(() => current.current?.abort(), []);
  useFocusEffect(useCallback(() => cancel, [cancel]));
  const download = useCallback(async (target: ArchiveDownloadTarget) => {
    if (current.current) return;
    const controller = new AbortController(); current.current = controller;
    const tracker = createDownloadTracker(Date.now());
    setState({ status: 'running', target, progress: null });
    try {
      const status = await transferArchive(transport, target, (loaded, total) => {
        if (mounted.current && current.current === controller) setState({ status: 'running', target, progress: tracker(loaded, total, Date.now()) });
      }, controller.signal);
      if (mounted.current && current.current === controller) setState((value) => ({ ...value, status }));
    } catch {
      if (mounted.current && current.current === controller) setState((value) => ({ ...value, status: 'failed' }));
    } finally { if (current.current === controller) current.current = null; }
  }, [transport]);
  return { ...state, busy: state.status === 'running', download, cancel };
}
