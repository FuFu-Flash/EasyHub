import { friendlyGitHubError } from '@/features/localization/githubError';
import { localizeError } from '../../../../../../features/localization/error.ts';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { AppAlert as Alert } from '@/components/AppAlert';
import { AiReviewButton } from '@/components/AiReviewButton';
import { PullChecksPanel, type PullChecksHandle } from '@/components/PullChecksPanel';
import { PullBinaryEvidence } from '@/components/PullBinaryEvidence';
import { ProgramReviewPrompt } from '@/components/ProgramReviewPrompt';
import type { BinaryAnalysisResult } from '@easyhub/types';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { GitHubError, isEmptyAddedPullFile, type GitHubComment, type GitHubPullFile, type GitHubPullRequest, type GitHubPullReview, type GitHubRepo, type GitHubReviewEvent } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { formatDate, formatDateTime } from '@/features/localization/format';
import { usePullRefresh } from '@/features/github/usePullRefresh';
import { invalidateOpenIssues } from '@/features/github/openIssues';
import { AI_PROVIDERS, reviewPullRequest, type AiReviewResult, type AiSettings, type ReviewProgressDetail } from '@/features/ai/review';
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
import { readListWindow } from '@/features/workspace/readingWindow';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';

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
  const { language } = usePreferences();
  const t = useTranslation();
  const { capture } = usePageFeedback();
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
  const [aiProgress, setAiProgress] = useState<({ completed: number; total: number; phase?: string } & Partial<ReviewProgressDetail>) | null>(null);
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
  const openedPages = useRef({ files: 1, comments: 1, reviews: 1 });
  const failedWindows = useRef({ comments: false, reviews: false });
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
    const revalidate = reset || failedWindows.current.comments;
    setLoadingComments(true); setCommentError(''); setCommentsCancelled(false);
    try {
      const result = revalidate ? await readListWindow((next, signal) => client.commentsPage(owner, repo, pullNumber, next, signal), openedPages.current.comments, (item) => item.id, controller.signal)
        : { ...await client.commentsPage(owner, repo, pullNumber, page, controller.signal), pages: page };
      if (controller.signal.aborted || commentController.current !== controller || generation.current !== revision) return;
      setComments((current) => [...new Map([...(revalidate ? [] : current), ...result.items].map((item) => [item.id, item])).values()]
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id));
      setNextCommentPage(result.nextPage);
      openedPages.current.comments = result.pages;
      failedWindows.current.comments = false;
    } catch {
      if (!controller.signal.aborted && commentController.current === controller && generation.current === revision) {
        failedWindows.current.comments = revalidate;
        setCommentError(t("number.couldNotLoadRepliesPleaseRetry"));
      }
    } finally {
      if (commentController.current === controller) { commentController.current = null; setLoadingComments(false); }
    }
  }, [client, owner, repo, pullNumber, t]);
  const loadReviews = useCallback(async (page: number, reset = false) => {
    if (!client || !focused.current || reviewController.current) return;
    const revision = generation.current;
    const controller = new AbortController(); reviewController.current = controller;
    const revalidate = reset || failedWindows.current.reviews;
    setLoadingReviews(true); setReviewError(''); setReviewsCancelled(false);
    try {
      const result = revalidate ? await readListWindow((next, signal) => client.pullReviewsPage(owner, repo, pullNumber, next, signal), openedPages.current.reviews, (item) => item.id, controller.signal)
        : { ...await client.pullReviewsPage(owner, repo, pullNumber, page, controller.signal), pages: page };
      if (controller.signal.aborted || reviewController.current !== controller || generation.current !== revision) return;
      setReviews((current) => [...new Map([...(revalidate ? [] : current), ...result.items].map((item) => [item.id, item])).values()]
        .sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || '') || a.id - b.id));
      setNextReviewPage(result.nextPage);
      openedPages.current.reviews = result.pages;
      failedWindows.current.reviews = false;
    } catch {
      if (!controller.signal.aborted && reviewController.current === controller && generation.current === revision) {
        failedWindows.current.reviews = revalidate;
        setReviewError(t("number.couldNotLoadReviewsPleaseRetry"));
      }
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
    if (force) openedPages.current = { files: 1, comments: 1, reviews: 1 };
    const revision = generation.current;
    const controller = new AbortController(); detailController.current = controller;
    // Keep the visible snapshot, but invalidate every action until its revision is verified again.
    headRevision.current = null;
    setLoading(true); setLoadingFiles(false); setFileError(''); setError('');
    setLoadingComments(false); setCommentError(''); setCommentsCancelled(false);
    setLoadingReviews(false); setReviewError(''); setReviewsCancelled(false);
    setAiProgress(null); setAiError(''); setDownloading(null);
    setBinaryProgress(null); setBinaryError('');
    const replies = loadComments(1, true);
    const reviewHistory = loadReviews(1, true);
    const detailsTask = Promise.all([
      client.repo(owner, repo, controller.signal),
      (async () => {
        const details = await client.pullRequest(owner, repo, pullNumber, controller.signal);
        const changed = await readListWindow(async (page, signal) => {
          const items = await client.pullFilesPage(owner, repo, pullNumber, page, signal);
          return { items, nextPage: items.length === 100 ? page + 1 : null };
        }, openedPages.current.files, (file) => file.filename, controller.signal);
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
      if (previous && (previous.head.sha !== details.head.sha || previous.base.sha !== details.base.sha || previous.base.ref !== details.base.ref)) {
        binaryCache.current = {}; setBinaryResults({}); setAiResult(null); setDecision(null);
      }
      if (details.state !== 'open') setDecision(null);
      snapshot.current = details; setPull(details);
      setFiles(changed.items); setFilePage(changed.pages); setMoreFiles(changed.nextPage !== null); openedPages.current.files = changed.pages;
      await checkTask;
    }).catch(() => {
      if (!controller.signal.aborted && detailController.current === controller && generation.current === revision)
        setError(t("number.couldNotLoadThisPullRequestPleaseTryAgain"));
    }).finally(() => {
      if (detailController.current === controller) { detailController.current = null; setLoading(false); }
    });
    const task = Promise.allSettled([detailsTask, replies, reviewHistory]).then(() => undefined)
      .finally(() => { if (readTask.current?.promise === task) readTask.current = null; });
    readTask.current = { revision, promise: task };
    return task;
  }, [client, owner, repo, pullNumber, t, loadComments, loadReviews, stopReadWork]);
  const { refresh, refreshing } = usePullRefresh([() => load(true)]);
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
      if (!await Sharing.isAvailableAsync()) throw new Error(t("number.thisDeviceCannotSaveOrShareFiles"));
      if (!controller.signal.aborted) await Sharing.shareAsync(destination.uri);
    } catch (reason) {
      if (destination?.exists) destination.delete();
      if (!controller.signal.aborted) Alert.alert(t("number.downloadFailed"), localizeError(reason, t, t("project.pleaseTryAgainLater")));
    } finally { if (downloadController.current === controller) { downloadController.current = null; setDownloading(null); } }
  }, [client, owner, repo, pull, pullNumber, t]);
  const loadProgramEvidence = async (file: GitHubPullFile, currentPull: GitHubPullRequest, signal: AbortSignal, onProgress: (phase: string) => void) => {
    if (!client || !file.sha || !currentPull.head.sha || !currentPull.head.repo || file.status === 'removed') throw new Error(t("number.cannotReadThisProgramFileRefreshAndRetry"));
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
    setBinaryError(''); setBinaryProgress({ file: file.filename, message: t("number.readingProgramFile") });
    try {
      await loadProgramEvidence(file, pull, controller.signal, (message) => {
        if (binaryController.current === controller && generation.current === revision) setBinaryProgress({ file: file.filename, message });
      });
    } catch (reason) {
      if (binaryController.current === controller && generation.current === revision) setBinaryError(controller.signal.aborted
        ? t("number.programAnalysisCancelledYouCanRetry")
        : localizeError(reason, t, t("number.programAnalysisFailedTryAgain")));
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
      if (!settings) throw new Error(t("number.setUpAnAIServiceInSettingsFirst"));
      if (settings.providerId !== consented.providerId || settings.model !== consented.model) throw new Error(t("CommitExplanation.aiSettingsChangedConfirmAgain"));
      const result = await reviewPullRequest({ client, owner, repo, number: pullNumber, headSha,
        settings, language, signal: controller.signal, consentToSend: true, providerBaseUrl: AI_PROVIDERS.find((provider) => provider.id === consented.providerId)!.baseUrl,
        binaryReviewer: { analyze: loadProgramEvidence },
        onProgress: (completed, total, phase, detail) => { if (!controller.signal.aborted) setAiProgress({ completed, total, phase, ...detail }); } });
      if (!controller.signal.aborted && aiController.current === controller) setAiResult(result);
    } catch (reason) {
      if (aiController.current === controller) {
        if (timedOut) setAiError(t("number.reviewTookTooLongPleaseTryAgainLater"));
        else if (!controller.signal.aborted) setAiError(localizeError(reason, t, t("number.aiReviewCouldNotBeCompletedPleaseTryAgain")));
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
        Alert.alert(t("analysis.setUpAIReviewFirst"), t("number.chooseAnAIProviderAndEnterYourOwnAPIKeyIn"), [
          { text: t("AiReviewSettings.cancel"), style: 'cancel' }, { text: t("analysis.openSettings"), onPress: () => router.push('/(tabs)/settings') },
        ]); return;
      }
      const provider = AI_PROVIDERS.find((item) => item.id === settings.providerId)!;
      Alert.alert(t("number.useAIToReviewTheseChanges"),
        `${t("number.thisPRSTitleDescriptionAndTextChangesWillBeSent")}\n\n${provider.name} · ${settings.model}\n${provider.baseUrl}${repository?.private ? `\n\n${t("number.thisIsAPrivateProjectConfirmYouWantToSendThese")}` : ''}\n\n${t("number.theResultIsAdvisoryYouDecideWhetherToAcceptTheChanges")}`,
        [{ text: t("AiReviewSettings.cancel"), style: 'cancel' }, { text: t("BinaryAnalysisSettings.agreeAndStartReview"), onPress: () => { void startAiReview(settings, revision, headSha); } }]);
    } catch { if (focused.current && generation.current === revision) Alert.alert(t("number.couldNotReadAISettings"), t("number.checkSettingsAndTryAgain")); }
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
        Alert.alert(t("number.changesHaveBeenUpdated"), t("number.refreshingTheRequestCheckTheChangedFilesAgain"));
        void load(true); return;
      }
      const next = filePage + 1;
      const result = await client.pullFilesPage(owner, repo, pullNumber, next, controller.signal);
      const checked = await client.pullRequest(owner, repo, pullNumber, controller.signal);
      if (controller.signal.aborted || fileController.current !== controller || generation.current !== revision || headRevision.current !== headSha) return;
      if (checked.head.sha !== headSha || checked.base.sha !== pull?.base.sha || checked.base.ref !== pull?.base.ref || checked.changed_files !== pull?.changed_files) { void load(true); return; }
      setFiles((current) => [...new Map([...current, ...result].map((item) => [item.filename, item])).values()]);
      setFilePage(next); setMoreFiles(result.length === 100);
      openedPages.current.files = next;
    } catch {
      if (!controller.signal.aborted && fileController.current === controller && generation.current === revision)
        setFileError(t("number.couldNotLoadMoreFilesPleaseRetry"));
    } finally { if (fileController.current === controller) { fileController.current = null; setLoadingFiles(false); } }
  };
  const submit = async () => {
    if (!client || !pull || !focused.current || headRevision.current !== pull.head.sha || busy || (event !== 'APPROVE' && !body.trim())) return;
    setBusy(true);
    const current = capture();
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber);
      if (!current()) return;
      if (latest.head.sha !== pull.head.sha || latest.state !== 'open') {
        Alert.alert(t("number.changesHaveBeenUpdated"), t("number.refreshAndCheckTheFilesAgainBeforeDeciding"));
        void load(true); return;
      }
      await client.createPullReview(owner, repo, pullNumber, event, body.trim(), pull.head.sha);
      setBody(''); setEvent('COMMENT');
      if (current()) { void load(true); Alert.alert(t("number.reviewSubmitted")); }
    } catch (reason) { if (current()) Alert.alert(t("number.couldNotSubmitReview"), friendlyGitHubError(reason, t)); }
    finally { setBusy(false); }
  };
  const confirmSubmit = () => {
    if (event === 'COMMENT') { void submit(); return; }
    Alert.alert(event === 'APPROVE' ? t("number.approveTheseChanges") : t("number.requestChanges"),
      t("number.yourReviewWillBePostedToGitHub"), [
        { text: t("AiReviewSettings.cancel"), style: 'cancel' },
        { text: t("number.submitReview"), onPress: () => { void submit(); } },
      ]);
  };
  const applyDecision = async () => {
    if (!client || !pull || !focused.current || headRevision.current !== pull.head.sha || !repository || !decision || busy) return;
    setBusy(true);
    const current = capture();
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber);
      if (!current()) return;
      if (latest.head.sha !== pull.head.sha || latest.base.sha !== pull.base.sha || latest.base.ref !== pull.base.ref || latest.state !== 'open') {
        Alert.alert(t("number.changesHaveBeenUpdated"), t("number.refreshAndCheckTheFilesAgainBeforeDeciding"));
        setDecision(null); void load(true); return;
      }
      if (decision === 'accept') {
        if (pull.draft || (pull.changed_files ?? files.length) > files.length) throw new Error(t("number.reviewAllChangedFilesFirst"));
        const method = repository.allow_merge_commit ? 'merge' : repository.allow_squash_merge ? 'squash' : repository.allow_rebase_merge ? 'rebase' : null;
        if (!method) throw new Error(t("number.thisProjectDoesNotAllowMergingHere"));
        if (!pull.head.sha) throw new Error(t("number.couldNotIdentifyThisRevisionRefreshAndTryAgain"));
        const result = await client.mergePullRequest(owner, repo, pullNumber, pull.head.sha, method);
        if (!result.merged) throw new Error(t("number.githubDidNotConfirmTheMergeRefreshAndCheckTheResult"));
        if (current()) Alert.alert(t("number.approvedAndMerged"));
      } else {
        if (decisionReason.trim()) { await client.createComment(owner, repo, pullNumber, decisionReason.trim()); setDecisionReason(''); }
        await client.closePullRequest(owner, repo, pullNumber);
        if (current()) Alert.alert(t("number.rejectedAndClosed"));
      }
      invalidateOpenIssues(client);
      setDecision(null); setDecisionReason(''); if (current()) void load(true);
    } catch (reason) { if (current()) Alert.alert(t("number.actionCouldNotBeCompleted"), reason instanceof GitHubError && reason.status === 409 ? t("number.theChangesJustChangedRefreshAndReviewAgain") : reason instanceof GitHubError ? friendlyGitHubError(reason, t) : localizeError(reason, t, t("project.pleaseTryAgainLater"))); }
    finally { setBusy(false); }
  };
  const confirmDecision = () => {
    Alert.alert(decision === 'accept' ? t("number.approveAndMergeTheseChanges") : t("number.rejectAndCloseThisRequest"),
      decision === 'accept' ? t("number.theseChangesWillBeSavedToYourGitHubProjectCheckThe") : t("number.thisChangeRequestWillBeClosedYourReasonWillBePosted"), [
        { text: t("AiReviewSettings.cancel"), style: 'cancel' },
        { text: t("number.confirm"), onPress: () => { void applyDecision(); } },
      ]);
  };
  if (!ready) return <Loading />;
  if (!client) return <Page><Heading title={t("project.pleaseSignIn")} /><Action title={t("discover.signInWithGitHub")} onPress={() => router.push('/login')} /></Page>;
  const isAuthor = user?.login.toLowerCase() === pull?.user?.login.toLowerCase();
  const canReview = pull?.state === 'open' && !pull.draft && !repository?.archived;
  const canManage = !!repository && !repository.archived && !!user && (repository.permissions?.push || repository.owner.login.toLowerCase() === user.login.toLowerCase());
  const choices: ReviewChoice[] = [
    { event: 'COMMENT', title: t("number.comment"), description: t("number.leaveFeedbackWithoutApproval") },
    { event: 'APPROVE', title: t("number.approve"), description: t("number.approveTheProposedChanges") },
    { event: 'REQUEST_CHANGES', title: t("number.requestChangesd5b0deec"), description: t("number.askForChangesBeforeMerging") },
  ];
  return <Page refresh={refresh} refreshing={refreshing}>
    <BackLink title={t("number.backToChangeRequests")} marginBottom={22} />
    {loading && !pull && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {pull && <>
      <Text style={{ color: pull.merged_at ? palette.blue : pull.state === 'open' ? palette.green : palette.muted, fontWeight: '800', marginBottom: 7 }}>{pull.draft ? t("PullRequestsPanel.draft") : pull.merged_at ? t("PullRequestsPanel.accepted") : pull.state === 'open' ? t("number.awaitingReview") : t("DiscussionSearch.closed")}</Text>
      <Heading title={translatedTitle} subtitle={`#${pull.number} · ${pull.user?.login || t("PullRequestsPanel.githubUser")} · ${formatDate(pull.created_at, language)}`} />
      <ProgramReviewPrompt files={files} />
      {canManage && pull.state === 'open' && <Card><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800' }}>{t("number.reviewTheseChanges")}</Text><Text style={{ color: palette.muted, marginTop: 7, marginBottom: 13 }}>{pull.draft ? t("number.theAuthorIsStillPreparingTheseChangesItCanBeMerged") : t("number.approvalMergesTheChangesRejectionClosesTheRequest")}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}><Action title={t("number.reject")} secondary disabled={busy || loading || !!error} onPress={() => setDecision('reject')} /><Action title={t("number.approveAndMerge")} disabled={busy || loading || !!error || pull.draft || (pull.changed_files ?? files.length) > files.length} onPress={() => setDecision('accept')} /></View></Card>}
      {decision && <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{decision === 'accept' ? t("number.approveAndMergeTheseChanges") : t("number.rejectAndCloseThisRequest")}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>{pull.title}</Text>{decision === 'reject' && <TextInput value={decisionReason} onChangeText={setDecisionReason} multiline placeholder={t("number.reasonForRejectionOptional")} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, minHeight: 78, padding: 10, marginTop: 12, textAlignVertical: 'top' }} />}<View style={{ marginTop: 13, gap: 8 }}><Action title={busy ? t("AiReviewSettings.working") : t("number.confirm")} disabled={busy || loading || !!error} onPress={confirmDecision} /><Action title={t("AiReviewSettings.cancel")} secondary disabled={busy || loading || !!error} onPress={() => setDecision(null)} /></View></Card>}
      <Card><View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <Text style={{ color: palette.muted, lineHeight: 21, flexShrink: 1, maxWidth: '100%' }}>{t("ForkContributionPanel.target")}: {pull.base.ref}</Text>
        <MaterialArrow name="back" color={palette.muted} size={24} />
        <Text style={{ color: palette.muted, lineHeight: 21, flexShrink: 1, maxWidth: '100%' }}>{t("ForkContributionPanel.source")}: {pull.head.label || pull.head.ref}</Text>
      </View>
        <Text style={{ color: palette.ink, fontWeight: '800', marginBottom: 8 }}>{t("number.description")}</Text>
        <TranslatableMarkdown text={pull.body || t("number.noDescriptionProvided")} isPublic={isPublic} protectedNames={names} />
      </Card>
      {showChecks && !!pull.head.sha && <PullChecksPanel ref={onChecksReady} client={client} owner={owner} repo={repo} headSha={pull.head.sha} language={language} />}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, marginBottom: 12 }}>
        <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800', flexShrink: 1 }}>{t("number.changedFiles")} · {pull.changed_files ?? files.length}</Text>
        <AiReviewButton title={t("BinaryAnalysisSettings.aiReview")} disabled={loading || !!error || busy || !!aiProgress || !!binaryProgress || !pull.head.sha || pull.state !== 'open'} onPress={() => { void prepareAiReview(); }} />
      </View>
      {files.some((file) => !file.patch && analyzableFile(file.filename) && file.status !== 'removed' && !isEmptyAddedPullFile(file)) && <Text style={{ color: palette.muted, marginBottom: 12, lineHeight: 21 }}>{t("number.aiReviewCombinesTextChangesWithDecompiledProgramEvidenceYouCan")}</Text>}
      {files.map((file) => <Card key={file.filename}>
        <Text selectable style={{ color: palette.ink, fontWeight: '800' }}>{file.filename}</Text>
        {!!file.previous_filename && <Text style={{ color: palette.muted, marginTop: 4 }}>{t("number.previously")}{file.previous_filename}</Text>}
        <Text style={{ color: palette.muted, marginTop: 5 }}>{file.status} · +{file.additions} / −{file.deletions}</Text>
        {file.patch ? <ScrollView horizontal style={{ marginTop: 12, backgroundColor: '#f3f6fb', borderRadius: 8 }}><Text selectable style={{ fontFamily: 'monospace', color: palette.ink, padding: 12, fontSize: 12, lineHeight: 19 }}>{file.patch}</Text></ScrollView> : <Text style={{ color: palette.muted, marginTop: 10 }}>{isEmptyAddedPullFile(file) ? t("number.newEmptyFile") : t("number.githubDidNotProvideATextDiffDownloadTheFileTo")}</Text>}
        <View style={{ marginTop: 12 }}><Action title={downloading === file.filename ? t("number.downloading") : file.status === 'removed' ? t("number.fileDeleted") : t("number.downloadChangedFile")} secondary disabled={loading || !!error || downloading !== null || file.status === 'removed' || !file.sha || !pull.head.sha} onPress={() => { void downloadFile(file); }} /></View>
        {analyzableFile(file.filename) && file.status !== 'removed' && !isEmptyAddedPullFile(file) && <View style={{ marginTop: 9, gap: 9 }}><Action title={binaryProgress?.file === file.filename ? t("analysis.decompiling") : t("number.decompileAndInspectProgram")} secondary disabled={loading || !!error || !file.sha || !pull.head.sha || !pull.head.repo || !frameworkRequirement(frameworkStatus, file.filename, language).ready || !!binaryProgress || !!aiProgress} onPress={() => { void inspectProgram(file); }} />
          {!frameworkRequirement(frameworkStatus, file.filename, language).ready && <><Text style={{ color: palette.muted, lineHeight: 22 }}>{frameworkRequirement(frameworkStatus, file.filename, language).message}</Text><Action secondary title={t("analysis.openSettingsToDownloadComponents")} disabled={!!binaryProgress || !!aiProgress} onPress={() => router.push('/(tabs)/settings')} /></>}
          {binaryProgress?.file === file.filename && <><Text accessibilityLiveRegion="polite" style={{ color: palette.muted, lineHeight: 21 }}>{binaryProgress.message}</Text><Action title={t("number.cancelProgramAnalysis")} secondary onPress={() => binaryController.current?.abort()} /></>}
        </View>}
        {binaryResults[file.filename]?.headSha === pull.head.sha && binaryResults[file.filename]?.fileSha === file.sha
          ? <PullBinaryEvidence key={binaryResults[file.filename].analysis.id} analysis={binaryResults[file.filename].analysis} headSha={pull.head.sha || ''} />
          : aiResult && aiResult.headSha === pull.head.sha && aiResult.binaryAnalyses?.filter((item) => item.file === file.filename && item.fileSha === file.sha).map((item) => <PullBinaryEvidence key={item.analysis.id} analysis={item.analysis} headSha={pull.head.sha || ''} />)}
      </Card>)}
      {!!binaryError && <ErrorText message={binaryError} />}
      {downloading !== null && <Action title={t("BinaryAnalysisSettings.cancelDownload")} secondary onPress={() => downloadController.current?.abort()} />}
      {!!fileError && <ErrorText message={fileError} />}
      {moreFiles && <Action title={loadingFiles ? t("project.loading") : fileError ? t("number.retryFiles") : t("number.loadMoreFiles")} secondary disabled={loading || !!error || loadingFiles} onPress={() => { void loadMoreFiles(); }} />}
      {loadingFiles && <View style={{ marginTop: 9 }}><Action title={t("number.cancelFileLoading")} secondary onPress={() => { fileController.current?.abort(); fileController.current = null; setLoadingFiles(false); }} /></View>}
      {(aiProgress || aiError || aiResult) && <Card style={{ backgroundColor: '#f8fbff', borderColor: '#dfe9f8', marginTop: 10 }}>
        <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>✦ {t("BinaryAnalysisSettings.aiReview")}</Text>
        {aiProgress && <View style={{ marginTop: 11, gap: 10 }}><Text accessibilityLiveRegion="polite" style={{ color: '#58779d' }}>{aiProgress.step === 'analyzing-program' ? t("review.analyzing", { p0: aiProgress.fileName }) : aiProgress.step === 'reviewing-program' ? t("review.reviewing", { p0: aiProgress.fileName }) : t("number.reviewingChanges")}{aiProgress.total > 1 ? ` ${aiProgress.completed} / ${aiProgress.total}` : ''}</Text><AiReviewButton title={t("number.cancelReview")} icon={false} onPress={() => aiController.current?.abort()} /></View>}
        {!!aiError && <Text style={{ color: '#bf3947', marginTop: 11 }}>{aiError}</Text>}
        {aiResult && <View style={{ marginTop: 14 }}><Text style={{ color: palette.ink, lineHeight: 22, fontWeight: '700' }}>{aiResult.summary}</Text>
          <Text style={{ color: palette.muted, marginTop: 9 }}>{t("number.reviewedOfFilesResultsAreAdvisory", { p0: aiResult.reviewedFiles, p1: aiResult.totalFiles })}</Text>
          {!!aiResult.binaryReviewedFiles && <Text style={{ color: palette.muted, marginTop: 6 }}>{t("number.programFilesWereReviewedUsingDecompiledEvidence", { p0: aiResult.binaryReviewedFiles })}</Text>}
          {aiResult.findings.map((finding, index) => <View key={`${finding.file}-${index}`} style={{ marginTop: 13, padding: 13, backgroundColor: '#fff', borderColor: palette.border, borderWidth: 1, borderRadius: 11 }}><Text style={{ color: finding.severity === 'high' ? '#bc3c47' : palette.ink, fontWeight: '800' }}>{finding.severity === 'high' ? t("number.highRisk") : finding.severity === 'medium' ? t("number.needsAttention") : t("number.suggestion")} · {finding.file}{finding.line ? `:${finding.line}` : ''}{finding.address ? ` · ${finding.address}` : ''}</Text><Text style={{ color: palette.ink, marginTop: 8, lineHeight: 21 }}>{finding.description}</Text><Text style={{ color: palette.muted, marginTop: 7, lineHeight: 21 }}>{t("number.suggestionbe7d155c")}{finding.suggestion}</Text></View>)}
          {aiResult.findings.length === 0 && <Text style={{ color: palette.muted, marginTop: 12 }}>{t("number.noSpecificIssuesWereReported")}</Text>}
          {aiResult.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, marginTop: 9, lineHeight: 19 }}>• {item}</Text>)}
        </View>}
      </Card>}
      <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 18, marginBottom: 12 }}>{t("number.discussionReplies")} · {comments.length}</Text>
      {comments.map((item) => <Card key={`comment-${item.id}`}><Text style={{ color: palette.ink, fontWeight: '800' }}>{item.user?.login || t("PullRequestsPanel.githubUser")}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>{formatDateTime(item.created_at, language)}</Text><TranslatableMarkdown text={item.body} isPublic={isPublic} protectedNames={names} /></Card>)}
      {!loadingComments && nextCommentPage === null && comments.length === 0 && <Text style={{ color: palette.muted, marginBottom: 12 }}>{t("number.noDiscussionRepliesYet")}</Text>}
      {!!commentError && <ErrorText message={commentError} />}
      {commentsCancelled && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginBottom: 10 }}>{t("number.replyLoadingCancelledYouCanRetry")}</Text>}
      {loadingComments ? <View style={{ gap: 9, marginBottom: 15 }}><Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>{t("number.loadingReplies")}</Text><Action title={t("number.cancelReplyLoading")} secondary onPress={() => { commentController.current?.abort(); commentController.current = null; setLoadingComments(false); setCommentsCancelled(true); }} /></View>
        : nextCommentPage !== null && <View style={{ marginBottom: 15 }}><Action title={commentError || commentsCancelled ? t("number.retryReplies") : t("number.loadMoreReplies")} secondary onPress={() => { void loadComments(nextCommentPage); }} /></View>}
      <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 18, marginBottom: 12 }}>{t("number.reviewHistory")} · {reviews.filter((item) => item.state !== 'PENDING').length}</Text>
      {reviews.filter((item) => item.state !== 'PENDING').map((item) => <Card key={`review-${item.id}`}><Text style={{ color: palette.ink, fontWeight: '800' }}>{item.user?.login || t("PullRequestsPanel.githubUser")} · {item.state === 'APPROVED' ? t("number.approved") : item.state === 'CHANGES_REQUESTED' ? t("number.requestedChanges") : t("number.commented")}</Text>{!!item.body && <TranslatableMarkdown text={item.body} isPublic={isPublic} protectedNames={names} />}</Card>)}
      {!loadingReviews && nextReviewPage === null && reviews.every((item) => item.state === 'PENDING') && <Text style={{ color: palette.muted, marginBottom: 12 }}>{t("number.noSubmittedReviewsYet")}</Text>}
      {!!reviewError && <ErrorText message={reviewError} />}
      {reviewsCancelled && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginBottom: 10 }}>{t("number.reviewLoadingCancelledYouCanRetry")}</Text>}
      {loadingReviews ? <View style={{ gap: 9, marginBottom: 15 }}><Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>{t("number.loadingReviews")}</Text><Action title={t("number.cancelReviewLoading")} secondary onPress={() => { reviewController.current?.abort(); reviewController.current = null; setLoadingReviews(false); setReviewsCancelled(true); }} /></View>
        : nextReviewPage !== null && <View style={{ marginBottom: 15 }}><Action title={reviewError || reviewsCancelled ? t("number.retryReviews") : t("number.loadMoreReviews")} secondary onPress={() => { void loadReviews(nextReviewPage); }} /></View>}
      {canReview && <Card style={{ marginTop: 12 }}><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{t("number.submitReviewb954ebaa")}</Text>
        {choices.filter((choice) => !isAuthor || choice.event === 'COMMENT').map((choice) => <Pressable key={choice.event} accessibilityRole="radio" accessibilityState={{ selected: event === choice.event }} onPress={() => setEvent(choice.event)} style={{ flexDirection: 'row', gap: 10, paddingVertical: 9, alignItems: 'center' }}><View style={{ width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: event === choice.event ? palette.blue : palette.border, backgroundColor: event === choice.event ? palette.blue : '#fff' }} /><View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '700' }}>{choice.title}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{choice.description}</Text></View></Pressable>)}
        <TextInput value={body} onChangeText={setBody} multiline placeholder={t("number.writeYourReview")} style={{ backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 11, minHeight: 100, padding: 12, textAlignVertical: 'top', marginTop: 12, marginBottom: 12 }} />
        <Action title={busy ? t("ForkContributionPanel.submitting") : t("number.submitReview04113737")} disabled={busy || loading || !!error || (event !== 'APPROVE' && !body.trim())} onPress={confirmSubmit} />
      </Card>}
      {pull.state === 'open' && pull.draft && <Card><Text style={{ color: palette.muted }}>{t("number.thisIsADraftFormalReviewIsAvailableWhenTheAuthor")}</Text></Card>}
    </>}
  </Page>;
}
