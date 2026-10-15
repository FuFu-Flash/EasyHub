import { useTranslation } from '@/features/localization/react';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Linking, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { validHistoryBranch, type GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { archiveTransferTitle, commitArchive } from '@/features/github/archiveDownload';
import { formatBytes, formatRemainingTime } from '@/features/github/downloadProgress';
import { useArchiveDownload } from '@/features/github/useArchiveDownload';
import { createCommitChangesReader } from '@/features/github/sourceHistory';
import { CommitFileChanges } from '@/components/SourceHistoryPanel';
import { CommitExplanation } from '@/components/CommitExplanation';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

type Parameters = { owner: string; repo: string; sha: string; branch?: string; historyPath?: string; mode?: string };
export default function Version() {
  const params = useLocalSearchParams<Parameters>();
  return <VersionDetails key={`${params.owner}/${params.repo}/${params.sha}`} {...params} />;
}

function VersionDetails({ owner, repo, sha, branch, mode }: Parameters) {
  const { client, downloadAndShare, ready } = useSession();
  const { language } = usePreferences();
  const t = useTranslation();
  const feedback = usePageFeedback();
  const [repository, setRepository] = useState<GitHubRepo | null>(null);
  const reader = useMemo(() => createCommitChangesReader(sha, (page, signal) => {
    if (!client) throw new Error('GitHub unavailable');
    return client.commitChangesPage(owner, repo, sha, page, signal);
  }), [client, owner, repo, sha]);
  const { commit: details, busy: loading, failedPage, nextPage, limited } = useSyncExternalStore(reader.subscribe, reader.snapshot, reader.snapshot);
  const transfer = useArchiveDownload(downloadAndShare);
  const cancelDownload = transfer.cancel;
  const { refresh, refreshing } = usePullRefresh([reader.reload]);
  useFocusEffect(useCallback(() => {
    if (!client) return;
    const controller = new AbortController();
    void reader.revalidate();
    void client.repo(owner, repo, controller.signal).then(item => { if (!controller.signal.aborted) setRepository(item); }).catch(() => undefined);
    return () => { controller.abort(); reader.cancel(); cancelDownload(); };
  }, [client, reader, owner, repo, cancelDownload]));
  const fileHistory = (path: string) => router.push({ pathname: '/project/[owner]/[repo]', params: { owner, repo, section: 'history', historyPath: path,
    ...(validHistoryBranch(branch) ? { historyBranch: branch } : {}), ...(mode ? { mode } : {}) } });
  const openGitHub = async () => {
    const current = feedback.capture();
    try { await Linking.openURL(`https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${encodeURIComponent(sha)}`); }
    catch { if (current()) feedback.set(t("sha.couldNotOpenThisLink")); }
  };
  const progress = transfer.progress;
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t("project.pleaseSignIn")} subtitle={t("sha.signInToViewChangeHistory")} /><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></Page>;
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t("sha.backToChangeHistory")} marginBottom={25} />
    {loading && !details && <Loading />}
    {failedPage !== null && <ErrorText message={t("sha.couldNotLoadCodeChangesPreviouslyLoadedFilesAreKept")} onRetry={() => { void reader.retry(); }} />}
    {!!feedback.value && <ErrorText message={feedback.value} />}
    {details && <>
      <Heading title={details.commit.message.split('\n')[0] || t("common.changeHistory")} subtitle={`${details.author?.login || details.commit.author?.name || t("SourceHistoryPanel.unknownAuthor")} · ${details.commit.author?.date ? new Date(details.commit.author.date).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN') : ''}`} />
      <Card><Text selectable style={{ color: palette.muted, fontFamily: 'monospace', marginBottom: 12 }}>{details.sha}</Text>{details.commit.message.includes('\n') && <Text selectable style={{ color: palette.ink, lineHeight: 22, marginBottom: 12 }}>{details.commit.message.slice(details.commit.message.indexOf('\n') + 1).trim()}</Text>}
        <Text style={{ color: palette.ink, marginBottom: 12 }}>{t("sha.changedFiles")} {details.files?.length ?? 0}{nextPage ? '+' : ''} · +{details.stats?.additions ?? 0} / −{details.stats?.deletions ?? 0}</Text><Action title={t("sha.viewTheCompleteDiffOnGitHub")} secondary onPress={() => { void openGitHub(); }} />
      </Card>
      <CommitExplanation owner={owner} repo={repo} sha={details.sha} disabled={!details.files?.length || repository === null} privateProject={repository?.private === true} />
      {details.files?.map(file => <CommitFileChanges key={file.filename} file={file} onFileHistory={fileHistory} />)}
      {!loading && failedPage === null && !details.files?.length && <Card><Text style={{ color: palette.muted }}>{t("sha.thisCommitHasNoFileChanges")}</Text></Card>}
      {loading && <Loading />}
      {nextPage !== null && failedPage === null && <View style={{ marginBottom: 12 }}><Action title={t("number.loadMoreFiles")} disabled={loading} secondary onPress={() => { void reader.more(); }} /></View>}
      {limited && <Card><Text style={{ color: palette.muted, lineHeight: 21 }}>{t("sha.theFileCountReachedTheGitHubAPILimitViewTheRemaining")}</Text></Card>}
      <Card>
        <Action title={transfer.busy ? archiveTransferTitle(progress, t) : t("sha.downloadFilesAtThisPoint")} disabled={transfer.busy || loading || failedPage !== null} onPress={() => { void transfer.download(commitArchive(owner, repo, details.sha)); }} />
        {transfer.busy && <View style={{ marginTop: 10 }}>
          {progress && <Text style={{ color: palette.muted, marginBottom: 10 }}>{formatBytes(progress.loaded)}{progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}{progress.bytesPerSecond > 0 ? ` · ${formatBytes(progress.bytesPerSecond)}/s` : ''}{progress.etaSeconds !== null && progress.etaSeconds > 0 ? ` · ${t("project.timeLeft")} ${formatRemainingTime(progress.etaSeconds)}` : ''}</Text>}
          <Action title={t("BinaryAnalysisSettings.cancelDownload")} secondary onPress={transfer.cancel} />
        </View>}
        {transfer.status === 'complete' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t("project.downloadCompleteYouCanSaveOrShareIt")}</Text>}
        {transfer.status === 'cancelled' && <Text style={{ color: palette.muted, marginTop: 10 }}>{t("project.downloadCancelledYouCanDownloadItAgain")}</Text>}
        {transfer.status === 'failed' && <ErrorText message={t("project.downloadFailedCheckYourConnectionAndDownloadAgain")} />}
        {(transfer.status === 'cancelled' || transfer.status === 'failed') && transfer.target && <View style={{ marginTop: 10 }}><Action title={t("project.downloadAgain")} secondary onPress={() => { if (transfer.target) void transfer.download(transfer.target); }} /></View>}
      </Card>
    </>}
  </Page>;
}
