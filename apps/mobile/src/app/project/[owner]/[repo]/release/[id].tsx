import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import type { GitHubRelease } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

export default function Release() {
  const { owner, repo, id } = useLocalSearchParams<{ owner: string; repo: string; id: string }>();
  const { client, downloadAndShare, ready } = useSession();
  const { t } = usePreferences();
  const [release, setRelease] = useState<GitHubRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!client) return;
    let active = true;
    client.releases(owner, repo).then((items) => { if (active) setRelease(items.find((item) => item.id === Number(id)) || null); })
      .catch(() => { if (active) setError(t('版本加载失败。', 'Could not load this release.')); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.current?.abort(); };
  }, [client, owner, repo, id, t]);
  const download = async (assetId: number, fileName: string) => {
    const current = new AbortController(); controller.current = current;
    setDownloading(assetId); setProgress(t('准备下载…', 'Preparing download…')); setError('');
    try {
      await downloadAndShare(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/assets/${assetId}`, fileName.replace(/[^-\w.]/g, '_'), (done, total) => setProgress(total > 0 ? `${t('正在下载', 'Downloading')} ${Math.round(done / total * 100)}%` : t('正在下载…', 'Downloading…')), current.signal);
      setProgress(t('下载完成，可以保存或分享。', 'Download complete. You can save or share it.'));
    } catch { if (!current.signal.aborted) setError(t('文件下载失败，请稍后重试。', 'Download failed. Please try again later.')); }
    finally { setDownloading(null); }
  };
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看这个版本。', 'Sign in to view this release.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page><Text onPress={() => router.back()} style={{ color: palette.blue, marginBottom: 25 }}>← {t('返回新版本', 'Back to releases')}</Text>{loading && <Loading />}{!!error && <ErrorText message={error} />}
    {release && <><Heading title={release.name || release.tag_name} subtitle={`${release.tag_name} · ${release.published_at ? new Date(release.published_at).toLocaleDateString() : ''}`} />
      <Card><Markdown style={{ body: { color: palette.ink, lineHeight: 23 }, link: { color: palette.blue } }}>{release.body || t('暂无版本介绍。', 'No release notes yet.')}</Markdown></Card><Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 15, marginBottom: 12 }}>{t('可下载文件', 'Downloads')}</Text>
      {release.assets.length ? release.assets.map((asset) => <Card key={asset.id}><Text style={{ color: palette.ink, fontWeight: '700' }}>{asset.name}</Text><Text style={{ color: palette.muted, marginTop: 4, marginBottom: 12 }}>{(asset.size / 1024 / 1024).toFixed(1)} MB</Text><Action title={downloading === asset.id ? progress : t('下载文件', 'Download file')} disabled={downloading !== null} onPress={() => { void download(asset.id, asset.name); }} /></Card>) : <Card><Text style={{ color: palette.muted }}>{t('这个版本没有单独上传的文件。', 'This release has no separate files.')}</Text></Card>}
      {downloading !== null && <View style={{ marginTop: 5 }}><Action title={t('取消下载', 'Cancel download')} secondary onPress={() => controller.current?.abort()} /></View>}
      {!downloading && !!progress && <Text style={{ color: palette.muted, marginTop: 10 }}>{progress}</Text>}
    </>}
  </Page>;
}
