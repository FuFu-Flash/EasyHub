import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { GitHubCommit } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { archiveTransferTitle, commitArchive } from '@/features/github/archiveDownload';
import { formatBytes, formatRemainingTime } from '@/features/github/downloadProgress';
import { useArchiveDownload } from '@/features/github/useArchiveDownload';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

export default function Version() {
  const { owner, repo, sha } = useLocalSearchParams<{ owner: string; repo: string; sha: string }>();
  return <VersionDetails key={`${owner}/${repo}/${sha}`} owner={owner} repo={repo} sha={sha} />;
}

function VersionDetails({ owner, repo, sha }: { owner: string; repo: string; sha: string }) {
  const { client, downloadAndShare, ready } = useSession();
  const { t } = usePreferences();
  const [details, setDetails] = useState<GitHubCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const readTask = useRef<Promise<void> | null>(null);
  const transfer = useArchiveDownload(downloadAndShare);
  const cancelDownload = transfer.cancel;
  const load = useCallback(() => {
    if (!client) return Promise.resolve();
    if (readTask.current) return readTask.current;
    const controller = new AbortController(); request.current = controller;
    const active = () => !controller.signal.aborted && request.current === controller;
    setLoading(true); setError('');
    const task = client.commit(owner, repo, sha, controller.signal)
      .then((item) => { if (active()) setDetails(item); })
      .catch(() => { if (active()) setError(t('历史版本加载失败，请重试。', 'Could not load this version. Please retry.')); })
      .finally(() => {
        if (active()) setLoading(false);
        if (readTask.current === task) readTask.current = null;
      });
    readTask.current = task;
    return task;
  }, [client, owner, repo, sha, t]);
  const { refresh, refreshing } = usePullRefresh([load]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { request.current?.abort(); request.current = null; readTask.current = null; cancelDownload(); };
  }, [load, cancelDownload]));
  const progress = transfer.progress;
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看历史版本。', 'Sign in to view this version.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t('返回历史版本', 'Back to history')} marginBottom={25} />
    {loading && !details && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {details && <>
      <Heading title={details.commit.message.split('\n')[0] || t('历史版本', 'Version')} subtitle={`${t('作者：', 'Author: ')}${details.commit.author?.name || t('未知作者', 'Unknown author')} · ${details.commit.author?.date ? new Date(details.commit.author.date).toLocaleString() : ''}`} />
      <Card><Text style={{ color: palette.ink, fontWeight: '700' }}>{t('修改内容', 'Changes')}</Text><Text style={{ color: palette.muted, marginTop: 8 }}>{t('新增', 'Added')} {details.stats?.additions ?? 0} {t('行 · 删除', 'lines · removed')} {details.stats?.deletions ?? 0} {t('行', 'lines')}</Text>{details.files?.map((file) => <Text selectable key={file.filename} style={{ color: palette.ink, paddingTop: 10 }}>{file.filename}</Text>)}</Card>
      <Card>
        <Action title={transfer.busy ? archiveTransferTitle(progress, t) : t('下载这个版本 ZIP', 'Download this version ZIP')} disabled={transfer.busy || loading || !!error} onPress={() => { void transfer.download(commitArchive(owner, repo, details.sha)); }} />
        {transfer.busy && <View style={{ marginTop: 10 }}>
          {progress && <Text style={{ color: palette.muted, marginBottom: 10 }}>{formatBytes(progress.loaded)}{progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}{progress.bytesPerSecond > 0 ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : ''}{progress.etaSeconds !== null && progress.etaSeconds > 0 ? ` · ${t('预计剩余', 'Time left')} ${formatRemainingTime(progress.etaSeconds)}` : ''}</Text>}
          <Action title={t('取消下载', 'Cancel download')} secondary onPress={transfer.cancel} />
        </View>}
        {transfer.status === 'complete' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t('下载完成，可以保存或分享。', 'Download complete. You can save or share it.')}</Text>}
        {transfer.status === 'cancelled' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t('下载已取消，可以重新下载。', 'Download cancelled. You can download it again.')}</Text>}
        {transfer.status === 'failed' && <ErrorText message={t('下载失败，请检查网络后重新下载。', 'Download failed. Check your connection and download again.')} />}
        {(transfer.status === 'cancelled' || transfer.status === 'failed') && transfer.target && <View style={{ marginTop: 10 }}><Action title={t('重新下载', 'Download again')} secondary onPress={() => { if (transfer.target) void transfer.download(transfer.target); }} /></View>}
      </Card>
    </>}
  </Page>;
}
