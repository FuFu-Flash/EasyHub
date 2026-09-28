import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { GitHubCommit } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

export default function Version() {
  const { owner, repo, sha } = useLocalSearchParams<{ owner: string; repo: string; sha: string }>();
  const { client, downloadAndShare, ready } = useSession();
  const { t } = usePreferences();
  const [details, setDetails] = useState<GitHubCommit | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!client) return;
    let active = true;
    client.commit(owner, repo, sha).then((item) => { if (active) setDetails(item); })
      .catch(() => { if (active) setError(t('历史版本加载失败。', 'Could not load this version.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.current?.abort(); };
  }, [client, owner, repo, sha, t]);
  const download = async () => {
    const current = new AbortController(); controller.current = current;
    setBusy(true); setError(''); setProgress(t('准备下载…', 'Preparing download…'));
    try {
      await downloadAndShare(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(sha)}`, `${repo}-${sha.slice(0, 7)}.zip`, (done, total) => setProgress(total > 0 ? `${t('正在下载', 'Downloading')} ${Math.round(done / total * 100)}%` : t('正在下载…', 'Downloading…')), current.signal);
      setProgress(t('下载完成，可以保存或分享。', 'Download complete. You can save or share it.'));
    } catch { if (!current.signal.aborted) setError(t('下载失败，请检查网络后重试。', 'Download failed. Check your connection and try again.')); }
    finally { setBusy(false); }
  };
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看历史版本。', 'Sign in to view this version.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page>
    <Text onPress={() => router.back()} style={{ color: palette.blue, marginBottom: 25 }}>← {t('返回历史版本', 'Back to history')}</Text>
    {loading && <Loading />}{!!error && <ErrorText message={error} />}
    {details && <>
      <Heading title={details.commit.message.split('\n')[0] || t('历史版本', 'Version')} subtitle={`${t('作者：', 'Author: ')}${details.commit.author?.name || t('未知作者', 'Unknown author')} · ${details.commit.author?.date ? new Date(details.commit.author.date).toLocaleString() : ''}`} />
      <Card><Text style={{ color: palette.ink, fontWeight: '700' }}>{t('修改内容', 'Changes')}</Text><Text style={{ color: palette.muted, marginTop: 8 }}>{t('新增', 'Added')} {details.stats?.additions ?? 0} {t('行 · 删除', 'lines · removed')} {details.stats?.deletions ?? 0} {t('行', 'lines')}</Text>{details.files?.map((file) => <Text key={file.filename} style={{ color: palette.ink, paddingTop: 10 }}>{file.filename}</Text>)}</Card>
      <Action title={busy ? progress : t('下载这个版本', 'Download this version')} disabled={busy} onPress={() => { void download(); }} />
      {busy && <View style={{ marginTop: 10 }}><Action title={t('取消下载', 'Cancel download')} secondary onPress={() => controller.current?.abort()} /></View>}
      {!busy && !!progress && <Text style={{ color: palette.muted, marginTop: 10 }}>{progress}</Text>}
    </>}
  </Page>;
}
