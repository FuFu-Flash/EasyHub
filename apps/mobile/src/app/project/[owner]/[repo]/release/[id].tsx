import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import type { GitHubRelease } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';
import { TranslatableMarkdown } from '@/components/TranslatableMarkdown';
import { createDownloadTracker, formatBytes, formatRemainingTime, releaseSourceDownload, type DownloadProgress } from '@/features/github/downloadProgress';
import { loadReleaseDetails } from '@/features/github/releaseDetails';
import { analyzableFile, MAX_ANALYSIS_BYTES } from '@/features/analysis/source';

interface DownloadTarget { key: string; path: string; fileName: string }

export default function Release() {
  const { owner, repo, id } = useLocalSearchParams<{ owner: string; repo: string; id: string }>();
  return <ReleaseDetails key={`${owner}/${repo}/${id}`} owner={owner} repo={repo} id={id} />;
}

function ReleaseDetails({ owner, repo, id }: { owner: string; repo: string; id: string }) {
  const { client, downloadAndShare, ready } = useSession();
  const { t } = usePreferences();
  const [release, setRelease] = useState<GitHubRelease | null>(null);
  const [isPublic, setIsPublic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [notice, setNotice] = useState('');
  const [downloading, setDownloading] = useState<DownloadTarget | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<DownloadTarget | null>(null);
  const [retryTarget, setRetryTarget] = useState<DownloadTarget | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const readController = useRef<AbortController | null>(null);
  const readTask = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); controller.current = null; };
  }, []);

  const load = useCallback(() => {
    if (!client) return Promise.resolve();
    if (readTask.current) return readTask.current;
    const current = new AbortController(); readController.current = current;
    const active = () => !current.signal.aborted && readController.current === current;
    setLoading(true); setLoadError('');
    const task = loadReleaseDetails(client, owner, repo, id, current.signal)
      .then((details) => { if (active()) { setRelease(details.release); setIsPublic(details.isPublic); } })
      .catch(() => { if (active()) setLoadError(t('版本加载失败，请检查权限和网络后重试。', 'Could not load this release. Check your access and connection, then retry.')); })
      .finally(() => {
        if (active()) setLoading(false);
        if (readTask.current === task) readTask.current = null;
      });
    readTask.current = task;
    return task;
  }, [client, owner, repo, id, t]);
  const { refresh, refreshing } = usePullRefresh([load]);
  useFocusEffect(useCallback(() => {
    void load();
    return () => { readController.current?.abort(); readController.current = null; readTask.current = null; controller.current?.abort(); };
  }, [load]));

  const download = useCallback(async (target: DownloadTarget) => {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    const isCurrent = () => mounted.current;
    const tracker = createDownloadTracker(Date.now());
    setDownloading(target); setFeedbackTarget(target); setProgress(null); setDownloadError(''); setNotice(''); setRetryTarget(null);
    try {
      await downloadAndShare(target.path, target.fileName.replace(/[^-\w.]/g, '_'), (done, total) => {
        if (isCurrent() && !current.signal.aborted) setProgress(tracker(done, total, Date.now()));
      }, current.signal);
      if (isCurrent() && !current.signal.aborted) setNotice(t('下载完成，可以保存或分享。', 'Download complete. You can save or share it.'));
    } catch {
      if (isCurrent()) {
        setRetryTarget(target);
        if (current.signal.aborted) setNotice(t('下载已取消，可以重新下载。', 'Download cancelled. You can download it again.'));
        else setDownloadError(t('文件下载失败，请检查网络后重新下载。', 'Download failed. Check your connection and download again.'));
      }
    } finally {
      if (controller.current === current) controller.current = null;
      if (isCurrent()) setDownloading(null);
    }
  }, [downloadAndShare, t]);

  const currentDownloadTitle = progress?.percentage === 100
    ? t('下载完成，正在准备保存或分享…', 'Download complete. Preparing to save or share…')
    : progress ? `${t('正在下载', 'Downloading')}${progress.percentage === null ? '…' : ` ${progress.percentage}%`}`
      : t('准备下载…', 'Preparing download…');
  const assetTarget = (assetId: number, fileName: string): DownloadTarget => ({ key: String(assetId), path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/assets/${assetId}`, fileName });
  const renderDownloadFeedback = (key: string) => {
    if (feedbackTarget?.key !== key) return null;
    return <View style={{ marginTop: 12, gap: 10 }}>
      {downloading?.key === key && <>
        <Action title={t('取消下载', 'Cancel download')} secondary onPress={() => controller.current?.abort()} />
        {progress && <View style={{ gap: 5 }}>
          <Text style={{ color: palette.muted }}>{formatBytes(progress.loaded)}{progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}</Text>
          {progress.bytesPerSecond > 0 && <Text style={{ color: palette.muted }}>{formatBytes(progress.bytesPerSecond)}/s</Text>}
          {progress.etaSeconds !== null && progress.etaSeconds > 0 && <Text style={{ color: palette.muted }}>{t('预计剩余', 'Time left')} {formatRemainingTime(progress.etaSeconds)}</Text>}
        </View>}
      </>}
      {!!downloadError && <Text accessibilityRole="alert" style={{ color: '#bf3947' }}>{downloadError}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>{notice}</Text>}
      {retryTarget?.key === key && !downloading && <Action title={t('重新下载', 'Download again')} secondary onPress={() => { void download(retryTarget); }} />}
    </View>;
  };

  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} subtitle={t('登录后查看这个版本。', 'Sign in to view this release.')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t('返回项目', 'Back to project')} marginBottom={25} />
    {loading && !release && <Loading />}
    {!!loadError && <ErrorText message={loadError} onRetry={refresh} />}
    {release && <>
      <Heading title={release.name || release.tag_name} subtitle={`${release.tag_name} · ${release.prerelease ? t('测试版', 'Prerelease') : t('正式版', 'Stable')}${release.draft ? ` · ${t('草稿', 'Draft')}` : ''}${release.published_at ? ` · ${new Date(release.published_at).toLocaleDateString()}` : ''}`} />
      {!!release.body && <Card>
        <Action title={expanded ? t('收起说明', 'Collapse notes') : t('展开完整说明', 'Read full release notes')} secondary onPress={() => setExpanded((value) => !value)} />
        {expanded && <View style={{ marginTop: 12 }}><TranslatableMarkdown text={release.body} isPublic={isPublic} protectedNames={[repo, release.tag_name, release.name || '', ...release.assets.map((asset) => asset.name)]} style={{ body: { color: palette.ink, lineHeight: 23 }, link: { color: palette.blue } }} /></View>}
      </Card>}
      <Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 15, marginBottom: 12 }}>{t('可下载文件', 'Downloads')}</Text>
      {release.assets.filter((asset) => asset.state === 'uploaded').map((asset) => <Card key={asset.id}>
        <Text selectable style={{ color: palette.ink, fontWeight: '700', lineHeight: 22 }}>{asset.name}</Text>
        <Text style={{ color: palette.muted, marginTop: 4, marginBottom: 12 }}>{formatBytes(asset.size)} · {t('已下载', 'Downloads')} {asset.download_count.toLocaleString()}{asset.label ? ` · ${asset.label}` : ''}</Text>
        <Action title={downloading?.key === String(asset.id) ? currentDownloadTitle : t('下载文件', 'Download file')} disabled={downloading !== null} onPress={() => { void download(assetTarget(asset.id, asset.name)); }} />
        {analyzableFile(asset.name) && asset.size > 0 && asset.size <= MAX_ANALYSIS_BYTES && <View style={{ marginTop: 10 }}><Action title={t('反编译文件', 'Decompile file')} secondary disabled={downloading !== null} onPress={() => router.push({ pathname: '/analysis', params: { source: 'release', owner, repo, assetId: String(asset.id), name: asset.name } })} /></View>}
        {renderDownloadFeedback(String(asset.id))}
      </Card>)}
      {!release.assets.some((asset) => asset.state === 'uploaded') && <Card><Text style={{ color: palette.muted }}>{t('这个版本没有单独上传的文件，可以下载下方源码。', 'This release has no separate files. You can download its source below.')}</Text></Card>}
      <Card>
        <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t('这个版本的项目源码', 'Source code for this release')}</Text>
        <Text style={{ color: palette.muted, marginTop: 5, marginBottom: 14 }}>{release.tag_name}</Text>
        <View style={{ gap: 10 }}>{(['zip', 'tar.gz'] as const).map((format) => <View key={format}>
          <Action secondary title={downloading?.key === format ? currentDownloadTitle : `${t('下载源码', 'Download source')} ${format === 'zip' ? 'ZIP' : 'TAR.GZ'}`} disabled={downloading !== null} onPress={() => { void download({ key: format, ...releaseSourceDownload(owner, repo, release.tag_name, format) }); }} />
          {renderDownloadFeedback(format)}
        </View>)}</View>
      </Card>
    </>}
  </Page>;
}
