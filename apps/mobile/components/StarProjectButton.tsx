import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useFocusEffect } from 'expo-router';
import type { RefreshHandle } from '@/features/github/usePullRefresh';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action } from './elements';
import { AppAlert } from './AppAlert';

export function StarProjectButton({ owner, repo, ref }: { owner: string; repo: string; ref?: Ref<RefreshHandle> }) {
  const { client } = useSession();
  const { t } = usePreferences();
  const [starred, setStarred] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const focused = useRef(false);
  const request = useRef<AbortController | null>(null);
  const task = useRef<Promise<void> | null>(null);
  const mutating = useRef(false);
  const read = useCallback(() => {
    if (!client || mutating.current || !focused.current) return Promise.resolve();
    if (task.current) return task.current;
    const controller = new AbortController(); request.current = controller;
    const current = client.isStarred(owner, repo, controller.signal)
      .then((value) => { if (!controller.signal.aborted && request.current === controller) setStarred(value); })
      .catch(() => undefined)
      .finally(() => { if (task.current === current) task.current = null; });
    task.current = current;
    return current;
  }, [client, owner, repo]);
  useImperativeHandle(ref, () => ({ refresh: read }), [read]);
  useFocusEffect(useCallback(() => {
    focused.current = true; void read();
    return () => { focused.current = false; request.current?.abort(); request.current = null; task.current = null; };
  }, [read]));
  const toggle = async () => {
    if (!client || busy || mutating.current) return;
    mutating.current = true; request.current?.abort(); request.current = null; task.current = null;
    setBusy(true);
    try {
      const current = starred ?? await client.isStarred(owner, repo);
      await client.setStarred(owner, repo, !current); setStarred(!current);
    } catch { AppAlert.alert(t('Star 更新失败', 'Could not update Star'), t('请检查网络和授权后重试。', 'Check your connection and permissions, then retry.')); }
    finally { mutating.current = false; setBusy(false); }
  };
  return <Action title={busy ? t('正在更新…', 'Updating…') : starred ? t('★ 已 Star · 点击取消', '★ Starred · Tap to remove') : t('☆ 在 GitHub 上 Star', '☆ Star on GitHub')} secondary disabled={!client || busy} onPress={() => void toggle()} />;
}
