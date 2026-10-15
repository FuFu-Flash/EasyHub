import { useTranslation } from '@/features/localization/react';
import { useCallback, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useFocusEffect } from 'expo-router';
import type { RefreshHandle } from '@/features/github/usePullRefresh';
import { useSession } from '@/features/auth/session';

import { Action } from './elements';
import { AppAlert } from './AppAlert';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';

export function StarProjectButton({ owner, repo, ref }: { owner: string; repo: string; ref?: Ref<RefreshHandle> }) {
  const { client } = useSession();
  const t = useTranslation();
  const { capture } = usePageFeedback();
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
    const currentVisit = capture();
    try {
      const current = starred ?? await client.isStarred(owner, repo);
      await client.setStarred(owner, repo, !current); setStarred(!current);
    } catch { if (currentVisit()) AppAlert.alert(t("StarProjectButton.couldNotUpdateStar"), t("StarProjectButton.checkYourConnectionAndPermissionsThenRetry")); }
    finally { mutating.current = false; setBusy(false); }
  };
  return <Action title={busy ? t("StarProjectButton.updating") : starred ? t("StarProjectButton.starredTapToRemove") : t("StarProjectButton.starOnGitHub")} secondary disabled={!client || busy} onPress={() => void toggle()} />;
}
