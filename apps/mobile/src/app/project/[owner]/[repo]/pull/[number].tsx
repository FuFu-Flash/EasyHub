import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { AppAlert as Alert } from '@/components/AppAlert';
import { AiReviewButton } from '@/components/AiReviewButton';
import { PullChecksPanel, type PullChecksHandle } from '@/components/PullChecksPanel';
import { PullBinaryEvidence } from '@/components/PullBinaryEvidence';
import type { BinaryAnalysisResult } from '@easyhub/types';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { GitHubError, friendlyGitHubError, isEmptyAddedPullFile, type GitHubComment, type GitHubPullFile, type GitHubPullRequest, type GitHubPullReview, type GitHubRepo, type GitHubReviewEvent } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { invalidateOpenIssues } from '@/features/github/openIssues';
import { AI_PROVIDERS, reviewPullRequest, type AiReviewResult, type AiSettings } from '@/features/ai/review';
import { loadAiSettings } from '@/features/ai/settings';
import { checkedPullDownload } from '@/features/github/pullDownload';
import { analyzableFile } from '@/features/analysis/source';
import { analyzeGithubFile } from '@/features/analysis/download';
import { analysisEngineStatus } from '@/features/analysis/native';
import { frameworkRequirement } from '@/features/analysis/frameworks';
import { publicTranslationAllowed } from '@/features/translation/paragraphs';
import { TranslatableMarkdown } from '@/components/TranslatableMarkdown';
import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { MaterialArrow } from '@/components/MaterialArrow';
import { Action, BackLink, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

type ReviewChoice = { event: GitHubReviewEvent; title: string; description: string };
type PullParameters = { owner: string; repo: string; number: string };
type ProgramEvidence = { headSha: string; fileSha: string; analysis: BinaryAnalysisResult };
function analysisRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (letter) => {
    const value = Math.floor(Math.random() * 16);
    return (letter === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
export default function PullRequestDetail() {
  const params = useLocalSearchParams<PullParameters>();
  return <PullDetails key={`${params.owner}/${params.repo}/${params.number}`} {...params} />;
}
function PullDetails({ owner, repo, number }: PullParameters) {
  const { client, ready, user } = useSession();
  const { t, language } = usePreferences();
  const [pull, setPull] = useState<GitHubPullRequest | null>(null);
  const [repository, setRepository] = useState<GitHubRepo | null>(null);
  const [files, setFiles] = useState<GitHubPullFile[]>([]);
  const [filePage, setFilePage] = useState(1);
  const [moreFiles, setMoreFiles] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState('');
  const [reviews, setReviews] = useState<GitHubPullReview[]>([]);
  const [nextReviewPage, setNextReviewPage] = useState<number | null>(1);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [reviewsCancelled, setReviewsCancelled] = useState(false);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [nextCommentPage, setNextCommentPage] = useState<number | null>(1);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [commentsCancelled, setCommentsCancelled] = useState(false);
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<GitHubReviewEvent>('COMMENT');
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<AiReviewResult | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiProgress, setAiProgress] = useState<{ completed: number; total: number; phase?: string } | null>(null);
  const [binaryResults, setBinaryResults] = useState<Record<string, ProgramEvidence>>({});
  const binaryCache = useRef<Record<string, ProgramEvidence>>({});
  const [binaryProgress, setBinaryProgress] = useState<{ file: string; message: string } | null>(null);
  const [binaryError, setBinaryError] = useState('');
  const binaryController = useRef<AbortController | null>(null);
  const aiController = useRef<AbortController | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const fileController = useRef<AbortController | null>(null);
  const reviewController = useRef<AbortController | null>(null);
  const commentController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const headRevision = useRef<string | null>(null);
  const snapshot = useRef<GitHubPullRequest | null>(null);
  const focused = useRef(false);
  const [showChecks, setShowChecks] = useState(false);
  const checks = useRef<PullChecksHandle | null>(null);
  const checksReady = useRef<{ headSha: string; resolve(): void } | null>(null);
  const readTask = useRef<{ revision: number; promise: Promise<void> } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const pullNumber = Number(number);
  const frameworkStatus = analysisEngineStatus();
  const stopReadWork = useCallback(() => {
    generation.current++;
    checks.current?.cancel();
    checksReady.current?.resolve(); checksReady.current = null; readTask.current = null;
    for (const request of [detailController, fileController, reviewController, commentController, aiController, downloadController, binaryController]) {
      request.current?.abort(); request.current = null;
    }
  }, []);
  useEffect(() => () => { stopReadWork(); }, [stopReadWork]);
  const isPublic = publicTranslationAllowed(repository);
  const names = [owner, repo, ...(pull?.user?.login ? [pull.user.login] : []), ...comments.flatMap((item) => item.user?.login ? [item.user.login] : [])];
  const translatedTitle = useTranslatedContent(pull?.title || '', names, isPublic).value;
  const loadComments = useCallback(async (page: number, reset = false) => {
    if (!client || !focused.current || commentController.current) return;
    const revision = generation.current;
    const controller = new AbortController(); commentController.current = controller;
    setLoadingComments(true); setCommentError(''); setCommentsCancelled(false);
    try {
      const result = await client.commentsPage(owner, repo, pullNumber, page, controller.signal);
      if (controller.signal.aborted || commentController.current !== controller || generation.current !== revision) return;
      setComments((current) => [...new Map([...(reset ? [] : current), ...result.items].map((item) => [item.id, item])).values()]
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id));
      setNextCommentPage(result.nextPage);
    } catch {
      if (!controller.signal.aborted && commentController.current === controller && generation.current === revision)
        setCommentError(t('回复加载失败，请重试。', 'Could not load replies. Please retry.'));
    } finally {
      if (commentController.current === controller) { commentController.current = null; setLoadingComments(false); }
    }
  }, [client, owner, repo, pullNumber, t]);
  const loadReviews = useCallback(async (page: number, reset = false) => {
    if (!client || !focused.current || reviewController.current) return;
    const revision = generation.current;
    const controller = new AbortController(); reviewController.current = controller;
    setLoadingReviews(true); setReviewError(''); setReviewsCancelled(false);
    try {
      const result = await client.pullReviewsPage(owner, repo, pullNumber, page, controller.signal);
      if (controller.signal.aborted || reviewController.current !== controller || generation.current !== revision) return;
      setReviews((current) => [...new Map([...(reset ? [] : current), ...result.items].map((item) => [item.id, item])).values()]
        .sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || '') || a.id - b.id));
      setNextReviewPage(result.nextPage);
    } catch {
      if (!controller.signal.aborted && reviewController.current === controller && generation.current === revision)
        setReviewError(t('审查记录加载失败，请重试。', 'Could not load reviews. Please retry.'));
    } finally {
      if (reviewController.current === controller) { reviewController.current = null; setLoadingReviews(false); }
    }
  }, [client, owner, repo, pullNumber, t]);
  const onChecksReady = useCallback((handle: PullChecksHandle | null) => {
    checks.current = handle;
    const pending = checksReady.current;
    if (handle && pending?.headSha === handle.headSha) {
      checksReady.current = null;
      void handle.refresh().finally(pending.resolve);
    }
  }, []);
  const load = useCallback((force = false) => {
    if (!client || !focused.current || !Number.isSafeInteger(pullNumber) || pullNumber < 1) return Promise.resolve();
    if (!force && readTask.current?.revision === generation.current) return readTask.current.promise;
    stopReadWork();
    const revision = generation.current;
    const controller = new AbortController(); detailController.current = controller;
    // Keep the visible snapshot, but invalidate every action until its revision is verified again.
    headRevision.current = null;
    setLoading(true); setLoadingFiles(false); setFileError(''); setError('');
    setLoadingComments(false); setCommentError(''); setCommentsCancelled(false);
    setLoadingReviews(false); setReviewError(''); setReviewsCancelled(false);
    setAiProgress(null); setAiResult(null); setAiError(''); setDownloading(null);
    binaryCache.current = {}; setBinaryResults({}); setBinaryProgress(null); setBinaryError('');
    const replies = loadComments(1, true);
    const reviewHistory = loadReviews(1, true);
    const detailsTask = Promise.all([
      client.repo(owner, repo, controller.signal),
      (async () => {
        const details = await client.pullRequest(owner, repo, pullNumber, controller.signal);
        const changed = await client.pullFilesPage(owner, repo, pullNumber, 1, controller.signal);
        const latest = await client.pullRequest(owner, repo, pullNumber, controller.signal);
        if (latest.head.sha !== details.head.sha || latest.base.sha !== details.base.sha || latest.base.ref !== details.base.ref || latest.changed_files !== details.changed_files || latest.state !== details.state) throw new Error('Pull request changed while reading files.');
        return { details, changed };
      })(),
    ]).then(async ([source, { details, changed }]) => {
      if (controller.signal.aborted || detailController.current !== controller || generation.current !== revision) return;
      const checkTask = details.head.sha ? checks.current?.headSha === details.head.sha ? checks.current.refresh()
        : new Promise<void>((resolve) => { checksReady.current = { headSha: details.head.sha!, resolve }; }) : Promise.resolve();
      headRevision.current = details.head.sha || null;
      setRepository(source);
      const previous = snapshot.current;
      if (previous && (previous.head.sha !== details.head.sha || previous.base.sha !== details.base.sha || previous.base.ref !== details.base.ref || details.state !== 'open')) setDecision(null);
      snapshot.current = details; setPull(details);
      setFiles(changed); setFilePage(1); setMoreFiles(changed.length === 100);
      await checkTask;
    }).catch(() => {
      if (!controller.signal.aborted && detailController.current === controller && generation.current === revision)
        setError(t('合并请求暂时无法加载，请重试。', 'Could not load this pull request. Please try again.'));
    }).finally(() => {
      if (detailController.current === controller) { detailController.current = null; setLoading(false); }
    });
    const task = Promise.allSettled([detailsTask, replies, reviewHistory]).then(() => undefined)
      .finally(() => { if (readTask.current?.promise === task) readTask.current = null; });
    readTask.current = { revision, promise: task };
    return task;
  }, [client, owner, repo, pullNumber, t, loadComments, loadReviews, stopReadWork]);
  const { refresh, refreshing } = usePullRefresh([load]);
  useFocusEffect(useCallback(() => {
    focused.current = true; setShowChecks(true); void load();
    return () => { focused.current = false; setShowChecks(false); stopReadWork(); };
  }, [load, stopReadWork]));
  const downloadFile = useCallback(async (file: GitHubPullFile) => {
    if (!client || !pull || !focused.current || headRevision.current !== pull.head.sha || downloadController.current) return;
    const controller = new AbortController(); downloadController.current = controller;
    setDownloading(file.filename);
    let destination: File | null = null;
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber, controller.signal);
      const source = checkedPullDownload(file, pull, latest);
      const response = await client.downloadBlob(source.owner, source.repo, source.sha, controller.signal);
      const contents = new Uint8Array(await response.arrayBuffer());
      if (controller.signal.aborted) return;
      destination = new File(Paths.cache, `${Date.now()}-${source.name}`); destination.create(); destination.write(contents);
      if (!await Sharing.isAvailableAsync()) throw new Error(t('此设备暂不支持保存或分享文件。', 'This device cannot save or share files.'));
      if (!controller.signal.aborted) await Sharing.shareAsync(destination.uri);
    } catch (reason) {
      if (destination?.exists) destination.delete();
      if (!controller.signal.aborted) Alert.alert(t('下载失败', 'Download failed'), reason instanceof Error ? reason.message : t('请稍后重试。', 'Please try again later.'));
    } finally { if (downloadController.current === controller) { downloadController.current = null; setDownloading(null); } }
  }, [client, owner, repo, pull, pullNumber, t]);
  const loadProgramEvidence = async (file: GitHubPullFile, currentPull: GitHubPullRequest, signal: AbortSignal, onProgress: (phase: string) => void) => {
    if (!client || !file.sha || !currentPull.head.sha || !currentPull.head.repo || file.status === 'removed') throw new Error(t('无法读取当前程序文件，请刷新后重试。', 'Cannot read this program file. Refresh and retry.'));
    const cached = binaryCache.current[file.filename];
    if (cached?.headSha === currentPull.head.sha && cached.fileSha === file.sha) return cached.analysis;
    const requirement = frameworkRequirement(analysisEngineStatus(), file.filename, language);
    if (!requirement.ready) throw new Error(requirement.message);
    const analysis = await analyzeGithubFile({ client, requestId: analysisRequestId(), language, signal,
      source: { kind: 'pull', owner, repo, number: pullNumber, headSha: currentPull.head.sha, fileSha: file.sha, path: file.filename },
      onProgress: (progress) => { if (!signal.aborted) onProgress(progress.message); } });
    if (!signal.aborted && focused.current && headRevision.current === currentPull.head.sha) {
      const evidence = { headSha: currentPull.head.sha, fileSha: file.sha, analysis };
      binaryCache.current = { ...binaryCache.current, [file.filename]: evidence };
      setBinaryResults(binaryCache.current);
    }
    return analysis;
  };
  const inspectProgram = async (file: GitHubPullFile) => {
    if (!client || !pull || !focused.current || binaryController.current || aiController.current || headRevision.current !== pull.head.sha) return;
    const controller = new AbortController(); binaryController.current = controller;
    const revision = generation.current;
    setBinaryError(''); setBinaryProgress({ file: file.filename, message: t('正在读取程序文件…', 'Reading program file…') });
    try {
      await loadProgramEvidence(file, pull, controller.signal, (message) => {
        if (binaryController.current === controller && generation.current === revision) setBinaryProgress({ file: file.filename, message });
      });
    } catch (reason) {
      if (binaryController.current === controller && generation.current === revision) setBinaryError(controller.signal.aborted
        ? t('程序分析已取消，可以重试。', 'Program analysis cancelled. You can retry.')
        : reason instanceof Error ? reason.message : t('程序分析失败，请重试。', 'Program analysis failed. Try again.'));
    } finally { if (binaryController.current === controller) { binaryController.current = null; setBinaryProgress(null); } }
  };
  const startAiReview = async (consented: AiSettings, revision: number, headSha: string) => {
    if (!client || !pull || !focused.current || generation.current !== revision || headRevision.current !== headSha || aiController.current || binaryController.current) return;
    const controller = new AbortController();
    aiController.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 120_000 + 3 * (180_000 + 120_000));
    setAiError(''); setAiResult(null); setAiProgress({ completed: 0, total: 1 });
    try {
      const settings = await loadAiSettings();
      if (!settings) throw new Error(t('请先在设置中配置 AI 服务。', 'Set up an AI service in Settings first.'));
      if (settings.providerId !== consented.providerId || settings.model !== consented.model) throw new Error(t('AI 设置已变化，请重新确认。', 'AI settings changed. Confirm again.'));
      const result = await reviewPullRequest({ client, owner, repo, number: pullNumber, headSha,
        settings, language, signal: controller.signal, consentToSend: true, providerBaseUrl: AI_PROVIDERS.find((provider) => provider.id === consented.providerId)!.baseUrl,
        binaryReviewer: { analyze: loadProgramEvidence },
        onProgress: (completed, total, phase) => { if (!controller.signal.aborted) setAiProgress({ completed, total, phase }); } });
      if (!controller.signal.aborted && aiController.current === controller) setAiResult(result);
    } catch (reason) {
      if (aiController.current === controller) {
        if (timedOut) setAiError(t('审查等待时间较长，请稍后重试。', 'Review took too long. Please try again later.'));
        else if (!controller.signal.aborted) setAiError(reason instanceof Error ? reason.message : t('AI 审查暂时无法完成，请重试。', 'AI review could not be completed. Please try again.'));
      }
    } finally { clearTimeout(timeout); if (aiController.current === controller) { aiController.current = null; setAiProgress(null); } }
  };
  const prepareAiReview = async () => {
    if (!pull?.head.sha || !focused.current || aiController.current || binaryController.current) return;
    const revision = generation.current;
    const headSha = pull.head.sha;
    try {
      const settings = await loadAiSettings();
      if (!focused.current || generation.current !== revision || headRevision.current !== headSha || aiController.current) return;
      if (!settings) {
        Alert.alert(t('请先设置 AI 审查', 'Set up AI review first'), t('在设置中选择 AI 服务商并填写你自己的 API Key。', 'Choose an AI provider and enter your own API key in Settings.'), [
          { text: t('取消', 'Cancel'), style: 'cancel' }, { text: t('打开设置', 'Open Settings'), onPress: () => router.push('/(tabs)/settings') },
        ]); return;
      }
      const provider = AI_PROVIDERS.find((item) => item.id === settings.providerId)!;
      Alert.alert(t('使用 AI 审查这次改进？', 'Use AI to review these changes?'),
        `${t('将发送本次 PR 的标题、描述及文字差异；没有文字差异的程序文件会先在本机反编译，再发送文件名、SHA-256、抽样代码、导入符号和字符串。最多分析 3 个程序文件。', 'This PR’s title, description and text changes will be sent. Program files without text diffs are first decompiled on this device; file names, SHA-256, sampled code, imports and strings are then sent. Up to 3 program files are analyzed.')}\n\n${provider.name} · ${settings.model}\n${provider.baseUrl}${repository?.private ? `\n\n${t('这是私有项目，请确认你愿意发送本次修改。', 'This is a private project. Confirm you want to send these changes.')}` : ''}\n\n${t('结果仅供参考，是否采纳由你决定。', 'The result is advisory. You decide whether to accept the changes.')}`,
        [{ text: t('取消', 'Cancel'), style: 'cancel' }, { text: t('同意并开始审查', 'Agree and start review'), onPress: () => { void startAiReview(settings, revision, headSha); } }]);
    } catch { if (focused.current && generation.current === revision) Alert.alert(t('无法读取 AI 设置', 'Could not read AI settings'), t('请检查设置后重试。', 'Check Settings and try again.')); }
  };
  const loadMoreFiles = async () => {
    if (!client || loading || !focused.current || fileController.current || !headRevision.current) return;
    const revision = generation.current;
    const headSha = headRevision.current;
    const controller = new AbortController(); fileController.current = controller;
    setLoadingFiles(true); setFileError('');
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber, controller.signal);
      if (controller.signal.aborted || fileController.current !== controller || generation.current !== revision) return;
      if (latest.head.sha !== headSha || latest.base.sha !== pull?.base.sha || latest.base.ref !== pull?.base.ref || latest.changed_files !== pull?.changed_files) {
        Alert.alert(t('修改内容已更新', 'Changes have been updated'), t('正在刷新，请重新检查修改文件。', 'Refreshing the request. Check the changed files again.'));
        void load(true); return;
      }
      const next = filePage + 1;
      const result = await client.pullFilesPage(owner, repo, pullNumber, next, controller.signal);
      const checked = await client.pullRequest(owner, repo, pullNumber, controller.signal);
      if (controller.signal.aborted || fileController.current !== controller || generation.current !== revision || headRevision.current !== headSha) return;
      if (checked.head.sha !== headSha || checked.base.sha !== pull?.base.sha || checked.base.ref !== pull?.base.ref || checked.changed_files !== pull?.changed_files) { void load(true); return; }
      setFiles((current) => [...new Map([...current, ...result].map((item) => [item.filename, item])).values()]);
      setFilePage(next); setMoreFiles(result.length === 100);
    } catch {
      if (!controller.signal.aborted && fileController.current === controller && generation.current === revision)
        setFileError(t('更多文件加载失败，请重试。', 'Could not load more files. Please retry.'));
    } finally { if (fileController.current === controller) { fileController.current = null; setLoadingFiles(false); } }
  };
  const submit = async () => {
    if (!client || !pull || !focused.current || headRevision.current !== pull.head.sha || busy || (event !== 'APPROVE' && !body.trim())) return;
    setBusy(true);
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber);
      if (latest.head.sha !== pull.head.sha || latest.state !== 'open') {
        Alert.alert(t('修改内容已更新', 'Changes have been updated'), t('请刷新并重新检查文件后再决定。', 'Refresh and check the files again before deciding.'));
        void load(true); return;
      }
      await client.createPullReview(owner, repo, pullNumber, event, body.trim(), pull.head.sha);
      setBody(''); setEvent('COMMENT'); void load(true);
      Alert.alert(t('审查已提交', 'Review submitted'));
    } catch (reason) { Alert.alert(t('提交失败', 'Could not submit review'), friendlyGitHubError(reason)); }
    finally { setBusy(false); }
  };
  const confirmSubmit = () => {
    if (event === 'COMMENT') { void submit(); return; }
    Alert.alert(event === 'APPROVE' ? t('确认同意这次修改？', 'Approve these changes?') : t('确认请求修改？', 'Request changes?'),
      t('你的审查意见会发布到 GitHub。', 'Your review will be posted to GitHub.'), [
        { text: t('取消', 'Cancel'), style: 'cancel' },
        { text: t('确认提交', 'Submit review'), onPress: () => { void submit(); } },
      ]);
  };
  const applyDecision = async () => {
    if (!client || !pull || !focused.current || headRevision.current !== pull.head.sha || !repository || !decision || busy) return;
    setBusy(true);
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber);
      if (latest.head.sha !== pull.head.sha || latest.base.sha !== pull.base.sha || latest.base.ref !== pull.base.ref || latest.state !== 'open') {
        Alert.alert(t('修改内容已更新', 'Changes have been updated'), t('请刷新并重新检查文件后再决定。', 'Refresh and check the files again before deciding.'));
        setDecision(null); void load(true); return;
      }
      if (decision === 'accept') {
        if (pull.draft || (pull.changed_files ?? files.length) > files.length) throw new Error(t('请先查看全部修改文件。', 'Review all changed files first.'));
        const method = repository.allow_merge_commit ? 'merge' : repository.allow_squash_merge ? 'squash' : repository.allow_rebase_merge ? 'rebase' : null;
        if (!method) throw new Error(t('这个项目目前不允许在应用内合入修改。', 'This project does not allow merging here.'));
        if (!pull.head.sha) throw new Error(t('无法确认这次修改，请刷新后重试。', 'Could not identify this revision. Refresh and try again.'));
        const result = await client.mergePullRequest(owner, repo, pullNumber, pull.head.sha, method);
        if (!result.merged) throw new Error(t('GitHub 没有确认合入成功，请刷新后检查。', 'GitHub did not confirm the merge. Refresh and check the result.'));
        Alert.alert(t('已批准并合入', 'Approved and merged'));
      } else {
        if (decisionReason.trim()) { await client.createComment(owner, repo, pullNumber, decisionReason.trim()); setDecisionReason(''); }
        await client.closePullRequest(owner, repo, pullNumber);
        Alert.alert(t('已拒绝并关闭', 'Rejected and closed'));
      }
      invalidateOpenIssues(client);
      setDecision(null); setDecisionReason(''); void load(true);
    } catch (reason) { Alert.alert(t('操作未完成', 'Action could not be completed'), reason instanceof GitHubError && reason.status === 409 ? t('修改内容刚刚发生变化，请刷新后重新审查。', 'The changes just changed. Refresh and review again.') : reason instanceof GitHubError ? friendlyGitHubError(reason) : reason instanceof Error ? reason.message : t('请稍后重试。', 'Please try again later.')); }
    finally { setBusy(false); }
  };
  const confirmDecision = () => {
    Alert.alert(decision === 'accept' ? t('批准并合入这次改进？', 'Approve and merge these changes?') : t('拒绝并关闭这次请求？', 'Reject and close this request?'),
      decision === 'accept' ? t('确认后，这次修改会保存到你的 GitHub 项目中。请先检查修改文件。', 'These changes will be saved to your GitHub project. Check the changed files first.') : t('确认后，这次改进请求会关闭。填写的原因会作为回复发给对方。', 'This change request will be closed. Your reason will be posted as a reply.'), [
        { text: t('取消', 'Cancel'), style: 'cancel' },
        { text: t('确认', 'Confirm'), onPress: () => { void applyDecision(); } },
      ]);
  };
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t('请先登录', 'Please sign in')} /><Action title={t('使用 GitHub 登录', 'Sign in with GitHub')} onPress={() => router.push('/login')} /></Page>;
  const isAuthor = user?.login.toLowerCase() === pull?.user?.login.toLowerCase();
  const canReview = pull?.state === 'open' && !pull.draft && !repository?.archived;
  const canManage = !!repository && !repository.archived && !!user && (repository.permissions?.push || repository.owner.login.toLowerCase() === user.login.toLowerCase());
  const choices: ReviewChoice[] = [
    { event: 'COMMENT', title: t('发表意见', 'Comment'), description: t('留下审查意见，不表态同意与否。', 'Leave feedback without approval.') },
    { event: 'APPROVE', title: t('同意修改', 'Approve'), description: t('确认你已看过这次修改。', 'Approve the proposed changes.') },
    { event: 'REQUEST_CHANGES', title: t('请求修改', 'Request changes'), description: t('说明哪些地方需要调整。', 'Ask for changes before merging.') },
  ];
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t('返回改进请求', 'Back to change requests')} marginBottom={22} />
    {loading && !pull && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {pull && <>
      <Text style={{ color: pull.merged_at ? palette.blue : pull.state === 'open' ? palette.green : palette.muted, fontWeight: '800', marginBottom: 7 }}>{pull.draft ? t('草稿', 'Draft') : pull.merged_at ? t('已采纳', 'Accepted') : pull.state === 'open' ? t('待审阅', 'Awaiting review') : t('已关闭', 'Closed')}</Text>
      <Heading title={translatedTitle} subtitle={`#${pull.number} · ${pull.user?.login || t('GitHub 用户', 'GitHub user')} · ${new Date(pull.created_at).toLocaleDateString()}`} />
      {canManage && pull.state === 'open' && <Card><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800' }}>{t('审阅这次改进', 'Review these changes')}</Text><Text style={{ color: palette.muted, marginTop: 7, marginBottom: 13 }}>{pull.draft ? t('作者还在准备这次改进，完成后才能批准合入。', 'The author is still preparing these changes. It can be merged when ready.') : t('批准会将修改合入项目，拒绝会关闭这次请求。', 'Approval merges the changes; rejection closes the request.')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}><Action title={t('拒绝', 'Reject')} secondary disabled={busy || loading || !!error} onPress={() => setDecision('reject')} /><Action title={t('批准并合入', 'Approve and merge')} disabled={busy || loading || !!error || pull.draft || (pull.changed_files ?? files.length) > files.length} onPress={() => setDecision('accept')} /></View></Card>}
      {decision && <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{decision === 'accept' ? t('批准并合入这次改进？', 'Approve and merge these changes?') : t('拒绝并关闭这次请求？', 'Reject and close this request?')}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>{pull.title}</Text>{decision === 'reject' && <TextInput value={decisionReason} onChangeText={setDecisionReason} multiline placeholder={t('拒绝原因（选填）', 'Reason for rejection (optional)')} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, minHeight: 78, padding: 10, marginTop: 12, textAlignVertical: 'top' }} />}<View style={{ marginTop: 13, gap: 8 }}><Action title={busy ? t('正在处理…', 'Working…') : t('确认', 'Confirm')} disabled={busy || loading || !!error} onPress={confirmDecision} /><Action title={t('取消', 'Cancel')} secondary disabled={busy || loading || !!error} onPress={() => setDecision(null)} /></View></Card>}
      <Card><View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Text style={{ color: palette.muted, lineHeight: 21, flexShrink: 1, maxWidth: '100%' }}>{t('目标', 'Target')}: {pull.base.ref}</Text>
        <MaterialArrow name="back" color={palette.muted} size={24} />
        <Text style={{ color: palette.muted, lineHeight: 21, flexShrink: 1, maxWidth: '100%' }}>{t('来源', 'Source')}: {pull.head.label || pull.head.ref}</Text>
      </View>
        <Text style={{ color: palette.ink, fontWeight: '800', marginBottom: 8 }}>{t('修改说明', 'Description')}</Text>
        <TranslatableMarkdown text={pull.body || t('没有填写说明。', 'No description provided.')} isPublic={isPublic} protectedNames={names} />
      </Card>
      {showChecks && !!pull.head.sha && <PullChecksPanel ref={onChecksReady} client={client} owner={owner} repo={repo} headSha={pull.head.sha} language={language} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, marginBottom: 12 }}>
        <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800', flexShrink: 1 }}>{t('修改的文件', 'Changed files')} · {pull.changed_files ?? files.length}</Text>
        <AiReviewButton title={t('AI 审查', 'AI review')} disabled={loading || !!error || busy || !!aiProgress || !!binaryProgress || !pull.head.sha || pull.state !== 'open'} onPress={() => { void prepareAiReview(); }} />
      </View>
      {files.some((file) => !file.patch && analyzableFile(file.filename) && file.status !== 'removed' && !isEmptyAddedPullFile(file)) && <Text style={{ color: palette.muted, marginBottom: 12, lineHeight: 21 }}>{t('AI 审查会结合文字差异与程序文件的反编译证据。也可以先在下方查看程序代码。', 'AI review combines text changes with decompiled program evidence. You can also inspect recovered code below first.')}</Text>}
      {files.map((file) => <Card key={file.filename}>
        <Text selectable style={{ color: palette.ink, fontWeight: '800' }}>{file.filename}</Text>
        {!!file.previous_filename && <Text style={{ color: palette.muted, marginTop: 4 }}>{t('原文件：', 'Previously: ')}{file.previous_filename}</Text>}
        <Text style={{ color: palette.muted, marginTop: 5 }}>{file.status} · +{file.additions} / −{file.deletions}</Text>
        {file.patch ? <ScrollView horizontal style={{ marginTop: 12, backgroundColor: '#f3f6fb', borderRadius: 8 }}><Text selectable style={{ fontFamily: 'monospace', color: palette.ink, padding: 12, fontSize: 12, lineHeight: 19 }}>{file.patch}</Text></ScrollView> : <Text style={{ color: palette.muted, marginTop: 10 }}>{isEmptyAddedPullFile(file) ? t('新建空文件。', 'New empty file.') : t('GitHub 未提供文字差异，可下载文件检查。', 'GitHub did not provide a text diff. Download the file to inspect it.')}</Text>}
        <View style={{ marginTop: 12 }}><Action title={downloading === file.filename ? t('正在下载…', 'Downloading…') : file.status === 'removed' ? t('文件已删除', 'File deleted') : t('下载修改文件', 'Download changed file')} secondary disabled={loading || !!error || downloading !== null || file.status === 'removed' || !file.sha || !pull.head.sha} onPress={() => { void downloadFile(file); }} /></View>
        {analyzableFile(file.filename) && file.status !== 'removed' && !isEmptyAddedPullFile(file) && <View style={{ marginTop: 9, gap: 9 }}><Action title={binaryProgress?.file === file.filename ? t('正在反编译…', 'Decompiling…') : t('反编译并检查程序', 'Decompile and inspect program')} secondary disabled={loading || !!error || !file.sha || !pull.head.sha || !pull.head.repo || !frameworkRequirement(frameworkStatus, file.filename, language).ready || !!binaryProgress || !!aiProgress} onPress={() => { void inspectProgram(file); }} />
          {!frameworkRequirement(frameworkStatus, file.filename, language).ready && <><Text style={{ color: palette.muted, lineHeight: 22 }}>{frameworkRequirement(frameworkStatus, file.filename, language).message}</Text><Action secondary title={t('打开设置下载组件', 'Open Settings to download components')} disabled={!!binaryProgress || !!aiProgress} onPress={() => router.push('/(tabs)/settings')} /></>}
          {binaryProgress?.file === file.filename && <><Text accessibilityLiveRegion="polite" style={{ color: palette.muted, lineHeight: 21 }}>{binaryProgress.message}</Text><Action title={t('取消程序分析', 'Cancel program analysis')} secondary onPress={() => binaryController.current?.abort()} /></>}
        </View>}
        {binaryResults[file.filename]?.headSha === pull.head.sha && binaryResults[file.filename]?.fileSha === file.sha
          ? <PullBinaryEvidence key={binaryResults[file.filename].analysis.id} analysis={binaryResults[file.filename].analysis} headSha={pull.head.sha || ''} />
          : aiResult && aiResult.headSha === pull.head.sha && aiResult.binaryAnalyses?.filter((item) => item.file === file.filename && item.fileSha === file.sha).map((item) => <PullBinaryEvidence key={item.analysis.id} analysis={item.analysis} headSha={pull.head.sha || ''} />)}
      </Card>)}
      {!!binaryError && <ErrorText message={binaryError} />}
      {downloading !== null && <Action title={t('取消下载', 'Cancel download')} secondary onPress={() => downloadController.current?.abort()} />}
      {!!fileError && <ErrorText message={fileError} />}
      {moreFiles && <Action title={loadingFiles ? t('正在加载…', 'Loading…') : fileError ? t('重试加载文件', 'Retry files') : t('加载更多文件', 'Load more files')} secondary disabled={loading || !!error || loadingFiles} onPress={() => { void loadMoreFiles(); }} />}
      {loadingFiles && <View style={{ marginTop: 9 }}><Action title={t('取消加载文件', 'Cancel file loading')} secondary onPress={() => { fileController.current?.abort(); fileController.current = null; setLoadingFiles(false); }} /></View>}
      {(aiProgress || aiError || aiResult) && <Card style={{ backgroundColor: '#f8fbff', borderColor: '#dfe9f8', marginTop: 10 }}>
        <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>✦ {t('AI 审查', 'AI review')}</Text>
        {aiProgress && <View style={{ marginTop: 11, gap: 10 }}><Text accessibilityLiveRegion="polite" style={{ color: '#58779d' }}>{aiProgress.phase || t('正在审查修改…', 'Reviewing changes…')}{aiProgress.total > 1 ? ` ${aiProgress.completed} / ${aiProgress.total}` : ''}</Text><AiReviewButton title={t('取消审查', 'Cancel review')} icon={false} onPress={() => aiController.current?.abort()} /></View>}
        {!!aiError && <Text style={{ color: '#bf3947', marginTop: 11 }}>{aiError}</Text>}
        {aiResult && <View style={{ marginTop: 14 }}><Text style={{ color: palette.ink, lineHeight: 22, fontWeight: '700' }}>{aiResult.summary}</Text>
          <Text style={{ color: palette.muted, marginTop: 9 }}>{t(`已审查 ${aiResult.reviewedFiles} / ${aiResult.totalFiles} 个文件。结果仅供参考。`, `Reviewed ${aiResult.reviewedFiles} of ${aiResult.totalFiles} files. Results are advisory.`)}</Text>
          {!!aiResult.binaryReviewedFiles && <Text style={{ color: palette.muted, marginTop: 6 }}>{t(`其中 ${aiResult.binaryReviewedFiles} 个程序文件已结合反编译证据审查。`, `${aiResult.binaryReviewedFiles} program files were reviewed using decompiled evidence.`)}</Text>}
          {aiResult.findings.map((finding, index) => <View key={`${finding.file}-${index}`} style={{ marginTop: 13, padding: 13, backgroundColor: '#fff', borderColor: palette.border, borderWidth: 1, borderRadius: 11 }}><Text style={{ color: finding.severity === 'high' ? '#bc3c47' : palette.ink, fontWeight: '800' }}>{finding.severity === 'high' ? t('高风险', 'High risk') : finding.severity === 'medium' ? t('需要留意', 'Needs attention') : t('建议', 'Suggestion')} · {finding.file}{finding.line ? `:${finding.line}` : ''}{finding.address ? ` · ${finding.address}` : ''}</Text><Text style={{ color: palette.ink, marginTop: 8, lineHeight: 21 }}>{finding.description}</Text><Text style={{ color: palette.muted, marginTop: 7, lineHeight: 21 }}>{t('建议：', 'Suggestion: ')}{finding.suggestion}</Text></View>)}
          {aiResult.findings.length === 0 && <Text style={{ color: palette.muted, marginTop: 12 }}>{t('本次审查没有提出具体问题。', 'No specific issues were reported.')}</Text>}
          {aiResult.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, marginTop: 9, lineHeight: 19 }}>• {item}</Text>)}
        </View>}
      </Card>}
      <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 18, marginBottom: 12 }}>{t('讨论回复', 'Discussion replies')} · {comments.length}</Text>
      {comments.map((item) => <Card key={`comment-${item.id}`}><Text style={{ color: palette.ink, fontWeight: '800' }}>{item.user?.login || t('GitHub 用户', 'GitHub user')}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>{new Date(item.created_at).toLocaleString()}</Text><TranslatableMarkdown text={item.body} isPublic={isPublic} protectedNames={names} /></Card>)}
      {!loadingComments && nextCommentPage === null && comments.length === 0 && <Text style={{ color: palette.muted, marginBottom: 12 }}>{t('暂时没有讨论回复。', 'No discussion replies yet.')}</Text>}
      {!!commentError && <ErrorText message={commentError} />}
      {commentsCancelled && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginBottom: 10 }}>{t('回复加载已取消，可以重试。', 'Reply loading cancelled. You can retry.')}</Text>}
      {loadingComments ? <View style={{ gap: 9, marginBottom: 15 }}><Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>{t('正在加载回复…', 'Loading replies…')}</Text><Action title={t('取消加载回复', 'Cancel reply loading')} secondary onPress={() => { commentController.current?.abort(); commentController.current = null; setLoadingComments(false); setCommentsCancelled(true); }} /></View>
        : nextCommentPage !== null && <View style={{ marginBottom: 15 }}><Action title={commentError || commentsCancelled ? t('重试加载回复', 'Retry replies') : t('加载更多回复', 'Load more replies')} secondary onPress={() => { void loadComments(nextCommentPage); }} /></View>}
      <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 18, marginBottom: 12 }}>{t('审查记录', 'Review history')} · {reviews.filter((item) => item.state !== 'PENDING').length}</Text>
      {reviews.filter((item) => item.state !== 'PENDING').map((item) => <Card key={`review-${item.id}`}><Text style={{ color: palette.ink, fontWeight: '800' }}>{item.user?.login || t('GitHub 用户', 'GitHub user')} · {item.state === 'APPROVED' ? t('已同意', 'Approved') : item.state === 'CHANGES_REQUESTED' ? t('请求修改', 'Requested changes') : t('发表意见', 'Commented')}</Text>{!!item.body && <TranslatableMarkdown text={item.body} isPublic={isPublic} protectedNames={names} />}</Card>)}
      {!loadingReviews && nextReviewPage === null && reviews.every((item) => item.state === 'PENDING') && <Text style={{ color: palette.muted, marginBottom: 12 }}>{t('暂时没有已提交的审查。', 'No submitted reviews yet.')}</Text>}
      {!!reviewError && <ErrorText message={reviewError} />}
      {reviewsCancelled && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginBottom: 10 }}>{t('审查记录加载已取消，可以重试。', 'Review loading cancelled. You can retry.')}</Text>}
      {loadingReviews ? <View style={{ gap: 9, marginBottom: 15 }}><Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>{t('正在加载审查记录…', 'Loading reviews…')}</Text><Action title={t('取消加载审查记录', 'Cancel review loading')} secondary onPress={() => { reviewController.current?.abort(); reviewController.current = null; setLoadingReviews(false); setReviewsCancelled(true); }} /></View>
        : nextReviewPage !== null && <View style={{ marginBottom: 15 }}><Action title={reviewError || reviewsCancelled ? t('重试加载审查记录', 'Retry reviews') : t('加载更多审查记录', 'Load more reviews')} secondary onPress={() => { void loadReviews(nextReviewPage); }} /></View>}
      {canReview && <Card style={{ marginTop: 12 }}><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{t('提交审查意见', 'Submit review')}</Text>
        {choices.filter((choice) => !isAuthor || choice.event === 'COMMENT').map((choice) => <Pressable key={choice.event} accessibilityRole="radio" accessibilityState={{ selected: event === choice.event }} onPress={() => setEvent(choice.event)} style={{ flexDirection: 'row', gap: 10, paddingVertical: 9, alignItems: 'center' }}><View style={{ width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: event === choice.event ? palette.blue : palette.border, backgroundColor: event === choice.event ? palette.blue : '#fff' }} /><View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '700' }}>{choice.title}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{choice.description}</Text></View></Pressable>)}
        <TextInput value={body} onChangeText={setBody} multiline placeholder={t('写下你的审查意见…', 'Write your review…')} style={{ backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 11, minHeight: 100, padding: 12, textAlignVertical: 'top', marginTop: 12, marginBottom: 12 }} />
        <Action title={busy ? t('正在提交…', 'Submitting…') : t('提交审查', 'Submit review')} disabled={busy || loading || !!error || (event !== 'APPROVE' && !body.trim())} onPress={confirmSubmit} />
      </Card>}
      {pull.state === 'open' && pull.draft && <Card><Text style={{ color: palette.muted }}>{t('这是草稿，作者准备好后才能正式审查。', 'This is a draft. Formal review is available when the author marks it ready.')}</Text></Card>}
    </>}
  </Page>;
}
