import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AppAlert as Alert } from '@/components/AppAlert';
import { AiReviewButton } from '@/components/AiReviewButton';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import Markdown from 'react-native-markdown-display';
import { GitHubError, friendlyGitHubError, type GitHubComment, type GitHubPullFile, type GitHubPullRequest, type GitHubPullReview, type GitHubRepo, type GitHubReviewEvent } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { invalidateOpenIssues } from '@/features/github/openIssues';
import { AI_PROVIDERS, reviewPullRequest, type AiReviewResult } from '@/features/ai/review';
import { loadAiSettings } from '@/features/ai/settings';
import { Action, Card, ErrorText, Heading, Loading, Page, palette } from '@/components/elements';

type ReviewChoice = { event: GitHubReviewEvent; title: string; description: string };
export default function PullRequestDetail() {
  const { owner, repo, number } = useLocalSearchParams<{ owner: string; repo: string; number: string }>();
  const { client, ready, user } = useSession();
  const { t, language } = usePreferences();
  const [pull, setPull] = useState<GitHubPullRequest | null>(null);
  const [repository, setRepository] = useState<GitHubRepo | null>(null);
  const [files, setFiles] = useState<GitHubPullFile[]>([]);
  const [filePage, setFilePage] = useState(1);
  const [moreFiles, setMoreFiles] = useState(false);
  const [reviews, setReviews] = useState<GitHubPullReview[]>([]);
  const [comments, setComments] = useState<GitHubComment[]>([]);
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<GitHubReviewEvent>('COMMENT');
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<AiReviewResult | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiProgress, setAiProgress] = useState<{ completed: number; total: number } | null>(null);
  const aiController = useRef<AbortController | null>(null);
  const pullNumber = Number(number);
  useEffect(() => () => { aiController.current?.abort(); }, []);
  const refresh = useCallback(() => {
    if (!client || !Number.isInteger(pullNumber) || pullNumber < 1) return;
    let active = true;
    setLoading(true);
    Promise.all([
      client.repo(owner, repo), client.pullRequest(owner, repo, pullNumber), client.pullFilesPage(owner, repo, pullNumber),
      client.pullReviews(owner, repo, pullNumber), client.comments(owner, repo, pullNumber),
    ]).then(([source, details, changed, submitted, discussion]) => {
      if (!active) return;
      setRepository(source);
      setPull(details); setFiles(changed); setFilePage(1); setMoreFiles(changed.length === 100);
      setAiResult((current) => current?.headSha === details.head.sha ? current : null);
      setReviews(submitted); setComments(discussion); setError('');
    }).catch(() => { if (active) setError(t('合并请求暂时无法加载，请重试。', 'Could not load this pull request. Please try again.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, owner, repo, pullNumber, t]);
  useFocusEffect(refresh);
  useFocusEffect(useCallback(() => () => { aiController.current?.abort(); }, []));
  const startAiReview = async () => {
    if (!client || !pull || aiController.current) return;
    const controller = new AbortController();
    aiController.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 120_000);
    setAiError(''); setAiResult(null); setAiProgress({ completed: 0, total: 1 });
    try {
      const settings = await loadAiSettings();
      if (!settings) throw new Error(t('请先在设置中配置 AI 服务。', 'Set up an AI service in Settings first.'));
      const result = await reviewPullRequest({ client, owner, repo, number: pullNumber, headSha: pull.head.sha || '',
        settings, language, signal: controller.signal,
        onProgress: (completed, total) => { if (!controller.signal.aborted) setAiProgress({ completed, total }); } });
      if (!controller.signal.aborted) setAiResult(result);
    } catch (reason) {
      if (timedOut) setAiError(t('审查等待时间较长，请稍后重试。', 'Review took too long. Please try again later.'));
      else if (!controller.signal.aborted) setAiError(reason instanceof Error ? reason.message : t('AI 审查暂时无法完成，请重试。', 'AI review could not be completed. Please try again.'));
    } finally { clearTimeout(timeout); if (aiController.current === controller) aiController.current = null; setAiProgress(null); }
  };
  const prepareAiReview = async () => {
    if (!pull || aiController.current) return;
    try {
      const settings = await loadAiSettings();
      if (!settings) {
        Alert.alert(t('请先设置 AI 审查', 'Set up AI review first'), t('在设置中选择 AI 服务商并填写你自己的 API Key。', 'Choose an AI provider and enter your own API key in Settings.'), [
          { text: t('取消', 'Cancel'), style: 'cancel' }, { text: t('打开设置', 'Open Settings'), onPress: () => router.push('/(tabs)/settings') },
        ]); return;
      }
      const provider = AI_PROVIDERS.find((item) => item.id === settings.providerId)!;
      Alert.alert(t('使用 AI 审查这次改进？', 'Use AI to review these changes?'),
        `${t('将向你配置的 AI 服务发送这次改进的标题、描述、文件名和修改内容。', 'The title, description, file names, and changes will be sent to your configured AI service.')}\n\n${provider.name} · ${settings.model}\n${provider.baseUrl}${repository?.private ? `\n\n${t('这是私有项目，请确认你愿意发送本次修改。', 'This is a private project. Confirm you want to send these changes.')}` : ''}\n\n${t('结果仅供参考，是否采纳由你决定。', 'The result is advisory. You decide whether to accept the changes.')}`,
        [{ text: t('取消', 'Cancel'), style: 'cancel' }, { text: t('同意并开始审查', 'Agree and start review'), onPress: () => { void startAiReview(); } }]);
    } catch { Alert.alert(t('无法读取 AI 设置', 'Could not read AI settings'), t('请检查设置后重试。', 'Check Settings and try again.')); }
  };
  const loadMoreFiles = async () => {
    if (!client || busy) return;
    setBusy(true);
    try {
      const next = filePage + 1;
      const result = await client.pullFilesPage(owner, repo, pullNumber, next);
      setFiles((current) => [...current, ...result]); setFilePage(next); setMoreFiles(result.length === 100);
    } catch { Alert.alert(t('加载失败', 'Could not load more'), t('请稍后重试。', 'Please try again later.')); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!client || !pull || busy || (event !== 'APPROVE' && !body.trim())) return;
    setBusy(true);
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber);
      if (latest.head.sha !== pull.head.sha || latest.state !== 'open') {
        Alert.alert(t('修改内容已更新', 'Changes have been updated'), t('请刷新并重新检查文件后再决定。', 'Refresh and check the files again before deciding.'));
        refresh(); return;
      }
      await client.createPullReview(owner, repo, pullNumber, event, body.trim(), pull.head.sha);
      setBody(''); setEvent('COMMENT'); refresh();
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
    if (!client || !pull || !repository || !decision || busy) return;
    setBusy(true);
    try {
      const latest = await client.pullRequest(owner, repo, pullNumber);
      if (latest.head.sha !== pull.head.sha || latest.base.sha !== pull.base.sha || latest.base.ref !== pull.base.ref || latest.state !== 'open') {
        Alert.alert(t('修改内容已更新', 'Changes have been updated'), t('请刷新并重新检查文件后再决定。', 'Refresh and check the files again before deciding.'));
        setDecision(null); refresh(); return;
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
      setDecision(null); setDecisionReason(''); refresh();
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
  const canReview = pull?.state === 'open' && !pull.draft;
  const canManage = !!repository && !!user && (repository.permissions?.push || repository.owner.login.toLowerCase() === user.login.toLowerCase());
  const choices: ReviewChoice[] = [
    { event: 'COMMENT', title: t('发表意见', 'Comment'), description: t('留下审查意见，不表态同意与否。', 'Leave feedback without approval.') },
    { event: 'APPROVE', title: t('同意修改', 'Approve'), description: t('确认你已看过这次修改。', 'Approve the proposed changes.') },
    { event: 'REQUEST_CHANGES', title: t('请求修改', 'Request changes'), description: t('说明哪些地方需要调整。', 'Ask for changes before merging.') },
  ];
  return <Page refresh={refresh}>
    <Text onPress={() => router.back()} style={{ color: palette.blue, marginBottom: 22 }}>← {t('返回改进请求', 'Back to change requests')}</Text>
    {loading && <Loading />}{!!error && <ErrorText message={error} onRetry={refresh} />}
    {!loading && pull && <>
      <Text style={{ color: pull.merged_at ? palette.blue : pull.state === 'open' ? palette.green : palette.muted, fontWeight: '800', marginBottom: 7 }}>{pull.draft ? t('草稿', 'Draft') : pull.merged_at ? t('已采纳', 'Accepted') : pull.state === 'open' ? t('待审阅', 'Awaiting review') : t('已关闭', 'Closed')}</Text>
      <Heading title={pull.title} subtitle={`#${pull.number} · ${pull.user?.login || t('GitHub 用户', 'GitHub user')} · ${new Date(pull.created_at).toLocaleDateString()}`} />
      {canManage && pull.state === 'open' && <Card><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800' }}>{t('审阅这次改进', 'Review these changes')}</Text><Text style={{ color: palette.muted, marginTop: 7, marginBottom: 13 }}>{pull.draft ? t('作者还在准备这次改进，完成后才能批准合入。', 'The author is still preparing these changes. It can be merged when ready.') : t('批准会将修改合入项目，拒绝会关闭这次请求。', 'Approval merges the changes; rejection closes the request.')}</Text><View style={{ flexDirection: 'row', gap: 9 }}><Action title={t('拒绝', 'Reject')} secondary disabled={busy} onPress={() => setDecision('reject')} /><Action title={t('批准并合入', 'Approve and merge')} disabled={busy || pull.draft || (pull.changed_files ?? files.length) > files.length} onPress={() => setDecision('accept')} /></View></Card>}
      {decision && <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{decision === 'accept' ? t('批准并合入这次改进？', 'Approve and merge these changes?') : t('拒绝并关闭这次请求？', 'Reject and close this request?')}</Text><Text style={{ color: palette.muted, marginTop: 7 }}>{pull.title}</Text>{decision === 'reject' && <TextInput value={decisionReason} onChangeText={setDecisionReason} multiline placeholder={t('拒绝原因（选填）', 'Reason for rejection (optional)')} style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, minHeight: 78, padding: 10, marginTop: 12, textAlignVertical: 'top' }} />}<View style={{ marginTop: 13, gap: 8 }}><Action title={busy ? t('正在处理…', 'Working…') : t('确认', 'Confirm')} disabled={busy} onPress={confirmDecision} /><Action title={t('取消', 'Cancel')} secondary disabled={busy} onPress={() => setDecision(null)} /></View></Card>}
      <Card><Text style={{ color: palette.muted, marginBottom: 12 }}>{t('目标', 'Target')}: {pull.base.ref}  ←  {pull.head.label || pull.head.ref}</Text>
        <Text style={{ color: palette.ink, fontWeight: '800', marginBottom: 8 }}>{t('修改说明', 'Description')}</Text>
        <Markdown style={{ body: { color: palette.ink, fontSize: 14, lineHeight: 22 }, link: { color: palette.blue } }}>{pull.body || t('没有填写说明。', 'No description provided.')}</Markdown>
      </Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, marginBottom: 12 }}>
        <Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800', flexShrink: 1 }}>{t('修改的文件', 'Changed files')} · {pull.changed_files ?? files.length}</Text>
        <AiReviewButton title={t('AI 审查', 'AI review')} disabled={loading || busy || !!aiProgress || !pull.head.sha || pull.state !== 'open'} onPress={() => { void prepareAiReview(); }} />
      </View>
      {files.map((file) => <Card key={file.filename}>
        <Text style={{ color: palette.ink, fontWeight: '800' }}>{file.filename}</Text>
        <Text style={{ color: palette.muted, marginTop: 5 }}>+{file.additions} / −{file.deletions}</Text>
      </Card>)}
      {moreFiles && <Action title={busy ? t('正在加载…', 'Loading…') : t('加载更多文件', 'Load more files')} secondary disabled={busy} onPress={() => { void loadMoreFiles(); }} />}
      {(aiProgress || aiError || aiResult) && <Card style={{ backgroundColor: '#f8fbff', borderColor: '#dfe9f8', marginTop: 10 }}>
        <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '800' }}>✦ {t('AI 审查', 'AI review')}</Text>
        {aiProgress && <View style={{ marginTop: 11, gap: 10 }}><Text style={{ color: '#58779d' }}>{t('正在审查修改…', 'Reviewing changes…')}{aiProgress.total > 1 ? ` ${aiProgress.completed} / ${aiProgress.total}` : ''}</Text><AiReviewButton title={t('取消审查', 'Cancel review')} icon={false} onPress={() => aiController.current?.abort()} /></View>}
        {!!aiError && <Text style={{ color: '#bf3947', marginTop: 11 }}>{aiError}</Text>}
        {aiResult && <View style={{ marginTop: 14 }}><Text style={{ color: palette.ink, lineHeight: 22, fontWeight: '700' }}>{aiResult.summary}</Text>
          <Text style={{ color: palette.muted, marginTop: 9 }}>{t(`已审查 ${aiResult.reviewedFiles} / ${aiResult.totalFiles} 个文件。结果仅供参考。`, `Reviewed ${aiResult.reviewedFiles} of ${aiResult.totalFiles} files. Results are advisory.`)}</Text>
          {aiResult.findings.map((finding, index) => <View key={`${finding.file}-${index}`} style={{ marginTop: 13, padding: 13, backgroundColor: '#fff', borderColor: palette.border, borderWidth: 1, borderRadius: 11 }}><Text style={{ color: finding.severity === 'high' ? '#bc3c47' : palette.ink, fontWeight: '800' }}>{finding.severity === 'high' ? t('高风险', 'High risk') : finding.severity === 'medium' ? t('需要留意', 'Needs attention') : t('建议', 'Suggestion')} · {finding.file}{finding.line ? `:${finding.line}` : ''}</Text><Text style={{ color: palette.ink, marginTop: 8, lineHeight: 21 }}>{finding.description}</Text><Text style={{ color: palette.muted, marginTop: 7, lineHeight: 21 }}>{t('建议：', 'Suggestion: ')}{finding.suggestion}</Text></View>)}
          {aiResult.findings.length === 0 && <Text style={{ color: palette.muted, marginTop: 12 }}>{t('本次审查没有提出具体问题。', 'No specific issues were reported.')}</Text>}
          {aiResult.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, marginTop: 9, lineHeight: 19 }}>• {item}</Text>)}
        </View>}
      </Card>}
      <Text style={{ color: palette.ink, fontSize: 19, fontWeight: '800', marginTop: 18, marginBottom: 12 }}>{t('讨论与审查', 'Discussion and reviews')}</Text>
      {comments.map((item) => <Card key={`comment-${item.id}`}><Text style={{ color: palette.ink, fontWeight: '800' }}>{item.user?.login || t('GitHub 用户', 'GitHub user')}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 4 }}>{new Date(item.created_at).toLocaleString()}</Text><Markdown style={{ body: { color: palette.ink, lineHeight: 21, marginTop: 9 }, link: { color: palette.blue } }}>{item.body}</Markdown></Card>)}
      {reviews.filter((item) => item.state !== 'PENDING').map((item) => <Card key={`review-${item.id}`}><Text style={{ color: palette.ink, fontWeight: '800' }}>{item.user?.login || t('GitHub 用户', 'GitHub user')} · {item.state === 'APPROVED' ? t('已同意', 'Approved') : item.state === 'CHANGES_REQUESTED' ? t('请求修改', 'Requested changes') : t('发表意见', 'Commented')}</Text>{!!item.body && <Markdown style={{ body: { color: palette.ink, lineHeight: 21, marginTop: 9 }, link: { color: palette.blue } }}>{item.body}</Markdown>}</Card>)}
      {canReview && <Card style={{ marginTop: 12 }}><Text style={{ color: palette.ink, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{t('提交审查意见', 'Submit review')}</Text>
        {choices.filter((choice) => !isAuthor || choice.event === 'COMMENT').map((choice) => <Pressable key={choice.event} accessibilityRole="radio" accessibilityState={{ selected: event === choice.event }} onPress={() => setEvent(choice.event)} style={{ flexDirection: 'row', gap: 10, paddingVertical: 9, alignItems: 'center' }}><View style={{ width: 19, height: 19, borderRadius: 10, borderWidth: 2, borderColor: event === choice.event ? palette.blue : palette.border, backgroundColor: event === choice.event ? palette.blue : '#fff' }} /><View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontWeight: '700' }}>{choice.title}</Text><Text style={{ color: palette.muted, fontSize: 12, marginTop: 3 }}>{choice.description}</Text></View></Pressable>)}
        <TextInput value={body} onChangeText={setBody} multiline placeholder={t('写下你的审查意见…', 'Write your review…')} style={{ backgroundColor: palette.background, borderWidth: 1, borderColor: palette.border, borderRadius: 11, minHeight: 100, padding: 12, textAlignVertical: 'top', marginTop: 12, marginBottom: 12 }} />
        <Action title={busy ? t('正在提交…', 'Submitting…') : t('提交审查', 'Submit review')} disabled={busy || (event !== 'APPROVE' && !body.trim())} onPress={confirmSubmit} />
      </Card>}
      {pull.state === 'open' && pull.draft && <Card><Text style={{ color: palette.muted }}>{t('这是草稿，作者准备好后才能正式审查。', 'This is a draft. Formal review is available when the author marks it ready.')}</Text></Card>}
    </>}
  </Page>;
}
