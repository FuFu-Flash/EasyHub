import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import type { GitHubForkComparison, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';
import { usePreferences } from '@/features/preferences/provider';
import { canContributeFork, canForkRepository, createRepositoryFork, findExistingFork, isValidContributionBranch, isValidRepositoryName, loadForkComparison, repositoryErrorMessage, submitForkContribution, waitForForkReady, type ForkContributionBranches } from '@/features/github/repositoryOperations';
import { Action, Card, ErrorText, Loading, palette } from './elements';
import { MaterialArrow } from './MaterialArrow';
import type { RefreshHandle } from '@/features/github/usePullRefresh';

const fieldStyle = { borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 13, color: palette.ink, backgroundColor: '#fff' } as const;

interface ForkContributionProps {
  ref?: Ref<RefreshHandle>;
  repo: GitHubRepo;
  publicMode?: boolean;
  onOpenFork: (fork: GitHubRepo) => void;
  onBrowseOriginal: (owner: string, name: string) => void;
  onOpenRequest: (owner: string, name: string, number: number) => void;
}
export function ForkContributionPanel({ ref, ...props }: ForkContributionProps) {
  return <ForkContributionContent ref={ref} key={`${props.repo.id}/${props.repo.full_name}/${!!props.publicMode}`} {...props} />;
}
function ForkContributionContent({ repo, publicMode = false, onOpenFork, onBrowseOriginal, onOpenRequest, ref }: ForkContributionProps) {
  const { client, user } = useSession();
  const { t } = usePreferences();
  const [detail, setDetail] = useState(repo);
  const [existing, setExisting] = useState<GitHubRepo | null>(null);
  const [pendingFork, setPendingFork] = useState<GitHubRepo | null>(null);
  const [comparison, setComparison] = useState<GitHubForkComparison | null>(null);
  const [headBranch, setHeadBranch] = useState(repo.default_branch);
  const [baseBranch, setBaseBranch] = useState(repo.parent?.default_branch ?? '');
  const [checkedBranches, setCheckedBranches] = useState<ForkContributionBranches | null>(null);
  const [created, setCreated] = useState<GitHubPullRequest | null>(null);
  const [name, setName] = useState(repo.name);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const latestRepo = useRef(repo);
  const selectedBranches = useRef({ headBranch: repo.default_branch, baseBranch: repo.parent?.default_branch ?? '' });
  const initialized = useRef(false);
  const branchesChanged = useRef(false);
  const readRequest = useRef<AbortController | null>(null);
  const readTask = useRef<Promise<void> | null>(null);
  const writeTask = useRef<Promise<void> | null>(null);
  const focused = useRef(false);
  const mounted = useRef(true);
  const operation = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const login = user?.login;
  const ownFork = canContributeFork(repo, user?.login, publicMode);
  const forkAllowed = canForkRepository(repo, user?.login);

  useEffect(() => { latestRepo.current = repo; }, [repo]);
  const cancelReads = useCallback(() => {
    generation.current++;
    readRequest.current?.abort(); readRequest.current = null; readTask.current = null;
  }, []);
  const refresh = useCallback(function refreshRead(branches?: ForkContributionBranches): Promise<void> {
    // A data refresh cannot cancel or invalidate a fork creation or contribution already being sent.
    if (writeTask.current) return writeTask.current.then(() => refreshRead(branches));
    if (!client || !login || !focused.current) return Promise.resolve();
    if (readTask.current) return readTask.current;
    const source = latestRepo.current;
    const own = canContributeFork(source, login, publicMode);
    const allowed = canForkRepository(source, login);
    const selected = branches ?? (initialized.current || branchesChanged.current ? { ...selectedBranches.current } : undefined);
    const current = ++generation.current;
    const controller = new AbortController(); readRequest.current = controller;
    const active = () => focused.current && !controller.signal.aborted && readRequest.current === controller && current === generation.current;
    setChecking(true); setError('');
    const task = (async () => {
      try {
        if (own) {
          const result = await loadForkComparison(client, source, publicMode, selected, controller.signal);
          if (active()) {
            setDetail(result.fork); setComparison(result.comparison); setCheckedBranches(result.branches); setCreated(null);
            if (!selected) {
              selectedBranches.current = result.branches;
              setHeadBranch(result.branches.headBranch); setBaseBranch(result.branches.baseBranch);
            }
            initialized.current = true;
          }
        } else if (allowed) {
          const fork = await findExistingFork(client, source, login, controller.signal);
          if (active()) { setExisting(fork); setDetail(source); }
        }
      } catch (cause) { if (active()) setError(repositoryErrorMessage(cause, t)); }
      finally {
        if (active()) { readRequest.current = null; setChecking(false); }
      }
    })().finally(() => { if (readTask.current === task) readTask.current = null; });
    readTask.current = task;
    return task;
  }, [client, login, publicMode, t]);
  useImperativeHandle(ref, () => ({ refresh: () => refresh() }), [refresh]);
  useFocusEffect(useCallback(() => {
    focused.current = true; void refresh();
    return () => { focused.current = false; cancelReads(); };
  }, [refresh, cancelReads]));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelReads(); operation.current?.abort(); };
  }, [cancelReads]);

  const changeBranch = (kind: 'head' | 'base', value: string) => {
    if (mutating.current) return;
    cancelReads(); branchesChanged.current = true;
    selectedBranches.current = { ...selectedBranches.current, [kind === 'head' ? 'headBranch' : 'baseBranch']: value };
    if (kind === 'head') setHeadBranch(value); else setBaseBranch(value);
    setComparison(null); setCheckedBranches(null); setCreated(null); setError(''); setChecking(false);
  };
  const validBranches = isValidContributionBranch(headBranch) && isValidContributionBranch(baseBranch);

  const create = () => {
    if (!client || !user || mutating.current || busy || checking || !forkAllowed || !isValidRepositoryName(name)) return;
    mutating.current = true;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError('');
    const task = (async () => { try {
      const result = pendingFork
        ? { fork: await waitForForkReady(client, pendingFork, repo, user.login, controller.signal), ready: true }
        : await createRepositoryFork(client, repo, name, controller.signal);
      if (!mounted.current || controller.signal.aborted || operation.current !== controller) return;
      if (result.fork && result.ready) { setPendingFork(null); setExisting(result.fork); if (focused.current) onOpenFork(result.fork); }
      else if (result.fork) setPendingFork(result.fork);
    } catch (cause) { if (mounted.current && !controller.signal.aborted && operation.current === controller) setError(repositoryErrorMessage(cause, t)); }
    finally { mutating.current = false; if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false); } } })()
      .finally(() => { if (writeTask.current === task) writeTask.current = null; });
    writeTask.current = task;
    return task;
  };

  const submit = () => {
    if (!client || mutating.current || busy || checking || !ownFork || !title.trim() || !comparison?.ahead_by || !checkedBranches || checkedBranches.headBranch !== headBranch || checkedBranches.baseBranch !== baseBranch) return;
    mutating.current = true;
    setBusy(true); setError('');
    const task = (async () => { try {
      const request = await submitForkContribution(client, detail, title, body, publicMode, checkedBranches);
      if (mounted.current) setCreated(request);
    } catch (cause) { if (mounted.current) setError(repositoryErrorMessage(cause, t)); }
    finally { mutating.current = false; if (mounted.current) setBusy(false); } })()
      .finally(() => { if (writeTask.current === task) writeTask.current = null; });
    writeTask.current = task;
    return task;
  };

  const parent = detail.parent;
  const activeRequest = created ?? comparison?.openRequest;
  return <View>
    <Card>
      <Text style={{ fontSize: 21, fontWeight: '800', color: palette.ink }}>{t('仓库副本与提交改进', 'Forks and contributions')}</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginVertical: 12 }}>{t('把公开项目复制到自己的账号，再把 GitHub 上已有的改动交给原项目作者审阅。', 'Copy a public project into your account, then submit changes already on GitHub to the original author for review.')}</Text>
      {parent && <View style={{ gap: 10, marginBottom: 15 }}>
        <Text style={{ color: palette.muted }}>{t('原项目', 'Original project')}</Text>
        <Action title={parent.full_name} secondary onPress={() => onBrowseOriginal(parent.owner.login, parent.name)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}><MaterialArrow name="down" color={palette.ink} /><Text style={{ color: palette.ink, fontWeight: '700', flexShrink: 1, minWidth: 0 }}>{detail.full_name}</Text></View>
        <Text style={{ color: palette.muted, lineHeight: 20 }}>{t('来源', 'Source')}: {detail.owner.login}:{headBranch}{'\n'}{t('目标', 'Target')}: {parent.owner.login}:{baseBranch}</Text>
      </View>}
      {checking && <Loading />}
      {ownFork && <View style={{ gap: 12 }}>
        <Text style={{ color: palette.ink, fontWeight: '700' }}>{t('来源分支', 'Source branch')}</Text>
        <TextInput accessibilityLabel={t('来源分支', 'Source branch')} value={headBranch} onChangeText={(value) => changeBranch('head', value)} autoCapitalize="none" autoCorrect={false} maxLength={255} editable={!busy && !checking} style={fieldStyle} />
        <Text style={{ color: palette.ink, fontWeight: '700' }}>{t('目标分支', 'Target branch')}</Text>
        <TextInput accessibilityLabel={t('目标分支', 'Target branch')} value={baseBranch} onChangeText={(value) => changeBranch('base', value)} autoCapitalize="none" autoCorrect={false} maxLength={255} editable={!busy && !checking} style={fieldStyle} />
        <Text style={{ color: palette.muted, lineHeight: 22 }}>{validBranches
          ? t('填写 GitHub 上已有的分支名称，然后检查这些分支之间的改动。', 'Enter branch names already on GitHub, then compare the changes between them.')
          : t('请输入有效的来源分支和目标分支名称。', 'Enter valid source and target branch names.')}</Text>
        <Action title={checking ? t('正在检查…', 'Checking…') : t('检查分支改动', 'Compare branches')} secondary disabled={busy || checking || !validBranches} onPress={() => { void refresh({ headBranch, baseBranch }); }} />
      </View>}
      {ownFork && comparison && <View style={{ gap: 12, marginTop: 15 }}>
        <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '700' }}>{t(`${comparison.ahead_by} 次待提交的更新`, `${comparison.ahead_by} commits ahead`)}</Text>
        <Text style={{ color: palette.muted }}>{t(`${comparison.behind_by} 次落后于原项目 · ${comparison.files?.length ?? 0} 个文件不同`, `${comparison.behind_by} commits behind · ${comparison.files?.length ?? 0} changed files`)}</Text>
        {comparison.files?.slice(0, 8).map((file) => <View key={file.filename} style={{ borderTopWidth: 1, borderColor: palette.border, paddingTop: 10 }}><Text style={{ color: palette.ink }}>{file.filename}</Text><Text style={{ color: palette.muted, marginTop: 4 }}>+{file.additions} / −{file.deletions}</Text></View>)}
        {activeRequest ? <>
          <Text style={{ color: palette.green }}>{created ? t('改进请求已提交。', 'Contribution submitted.') : t('已有改进请求等待原项目审阅。', 'An existing contribution is waiting for review.')}</Text>
          <Action title={`#${activeRequest.number} ${activeRequest.title}`} secondary onPress={() => onOpenRequest(parent!.owner.login, parent!.name, activeRequest.number)} />
          <Action title={t('在 GitHub 查看', 'View on GitHub')} secondary onPress={() => { void Linking.openURL(activeRequest.html_url); }} />
        </> : comparison.ahead_by === 0 ? <Text style={{ color: palette.muted, lineHeight: 22 }}>{t('还没有可提交的改进。请先在 GitHub 更新仓库副本，再刷新检查。', 'There are no changes to submit. Update your fork on GitHub, then refresh this comparison.')}</Text> : <>
          <Text style={{ color: palette.ink, fontWeight: '700' }}>{t('改进标题', 'Contribution title')}</Text>
          <TextInput accessibilityLabel={t('改进标题', 'Contribution title')} placeholder={t('一句话说明改了什么', 'Describe your changes in one sentence')} value={title} onChangeText={setTitle} maxLength={256} editable={!busy} style={fieldStyle} />
          <Text style={{ color: palette.ink, fontWeight: '700' }}>{t('详细描述', 'Description')}</Text>
          <TextInput accessibilityLabel={t('改进描述', 'Contribution description')} placeholder={t('说明修改的原因和效果', 'Explain why you made these changes')} value={body} onChangeText={setBody} maxLength={65536} multiline editable={!busy} style={[fieldStyle, { minHeight: 120, textAlignVertical: 'top' }]} />
          <Action title={busy ? t('正在提交…', 'Submitting…') : t('向原项目提交改进', 'Submit contribution')} disabled={busy || checking || !!error || !title.trim()} onPress={() => { void submit(); }} />
        </>}
      </View>}
      {!ownFork && forkAllowed && <View style={{ gap: 12 }}>
        {existing ? <><Text style={{ color: palette.ink }}>{t('已经有一个关联副本', 'You already have a related fork')}: {existing.full_name}</Text><Action title={t('打开仓库副本', 'Open fork')} onPress={() => onOpenFork(existing)} /></> : pendingFork ? <>
          <Text style={{ color: palette.muted, lineHeight: 22 }}>{t(`GitHub 正在准备 ${pendingFork.full_name}。可稍后检查，也可以在“我的项目”中查看。`, `GitHub is preparing ${pendingFork.full_name}. Check again shortly or look in My projects.`)}</Text>
          <Action title={busy ? t('正在检查…', 'Checking…') : t('检查副本是否就绪', 'Check fork readiness')} disabled={busy || checking} onPress={() => { void create(); }} />
        </> : <>
          <Text style={{ color: palette.ink, fontWeight: '700' }}>{t('副本名称', 'Fork name')}</Text>
          <TextInput accessibilityLabel={t('副本名称', 'Fork name')} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} maxLength={100} editable={!busy} style={fieldStyle} />
          <Text style={{ color: palette.muted }}>{user?.login}/{name} · {t('仅复制主要版本', 'Copies only the default branch')}</Text>
          <Action title={busy ? t('正在创建仓库副本…', 'Creating fork…') : t('创建仓库副本', 'Create fork')} disabled={busy || checking || !!error || !isValidRepositoryName(name)} onPress={() => { void create(); }} />
        </>}
      </View>}
      {!checking && !ownFork && !forkAllowed && <Text style={{ color: palette.muted, lineHeight: 22 }}>{publicMode && repo.owner.login.toLowerCase() === user?.login.toLowerCase() ? t('在“我的项目”中打开副本后，可以提交改进。', 'Open your fork from My projects to submit a contribution.') : repo.archived ? t('项目已存档，暂时不能创建副本或提交改进。', 'This project is archived. Forking and contributions are unavailable.') : t('这个项目当前不需要或不允许创建副本。', 'This project does not need or allow a fork right now.')}</Text>}
    </Card>
    {!!error && <ErrorText message={error} onRetry={() => { void refresh(ownFork ? { headBranch, baseBranch } : undefined); }} />}
  </View>;
}
