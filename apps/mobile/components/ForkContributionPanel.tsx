import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import type { GitHubForkComparison, GitHubPullRequest, GitHubRepo } from '@easyhub/github';
import { useSession } from '@/features/auth/session';

import { canContributeFork, canForkRepository, createRepositoryFork, findExistingFork, isValidContributionBranch, isValidRepositoryName, loadForkComparison, repositoryErrorMessage, submitForkContribution, waitForForkReady, type ForkContributionBranches } from '@/features/github/repositoryOperations';
import { Action, Card, ErrorText, Loading, palette } from './elements';
import { MaterialArrow } from './MaterialArrow';
import type { RefreshHandle } from '@/features/github/usePullRefresh';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { themed } from '@/features/theme/theme';

const fieldStyle = { borderWidth: 1, borderRadius: 12, padding: 13, get borderColor() { return palette.border; }, get color() { return palette.ink; }, get backgroundColor() { return themed('#fff'); } };

interface ForkContributionProps {
  ref?: Ref<RefreshHandle>;
  repo: GitHubRepo;
  publicMode?: boolean;
  active?: boolean;
  onOpenFork: (fork: GitHubRepo) => void;
  onBrowseOriginal: (owner: string, name: string) => void;
  onOpenRequest: (owner: string, name: string, number: number) => void;
}
export function ForkContributionPanel({ ref, ...props }: ForkContributionProps) {
  return <ForkContributionContent ref={ref} key={`${props.repo.id}/${props.repo.full_name}/${!!props.publicMode}`} {...props} />;
}
function ForkContributionContent({ repo, publicMode = false, active = true, onOpenFork, onBrowseOriginal, onOpenRequest, ref }: ForkContributionProps) {
  const { client, user } = useSession();
  const t = useTranslation();
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
  const { value: error, set: setError, capture } = usePageFeedback('', active);
  const visible = useRef(active);
  useLayoutEffect(() => { visible.current = active; }, [active]);
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
    if (!visible.current || !focused.current) return Promise.resolve();
    if (writeTask.current) return writeTask.current.then(() => refreshRead(branches));
    if (!client || !login || !focused.current) return Promise.resolve();
    if (readTask.current) return readTask.current;
    const source = latestRepo.current;
    const own = canContributeFork(source, login, publicMode);
    const allowed = canForkRepository(source, login);
    const selected = branches ?? (initialized.current || branchesChanged.current ? { ...selectedBranches.current } : undefined);
    const current = ++generation.current;
    const controller = new AbortController(); readRequest.current = controller;
    const active = () => visible.current && focused.current && !controller.signal.aborted && readRequest.current === controller && current === generation.current;
    setChecking(true); setError('');
    const task = (async () => {
      try {
        if (own) {
          const result = await loadForkComparison(client, source, publicMode, selected, controller.signal);
          if (active()) {
            setDetail(result.fork); setComparison(result.comparison); setCheckedBranches(result.branches);
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
  }, [client, login, publicMode, t, setError]);
  useImperativeHandle(ref, () => ({ refresh: () => refresh() }), [refresh]);
  useFocusEffect(useCallback(() => {
    focused.current = active;
    if (active) void refresh();
    else { cancelReads(); setChecking(false); }
    return () => { focused.current = false; cancelReads(); setChecking(false); };
  }, [refresh, cancelReads, active]));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelReads(); operation.current?.abort(); };
  }, [cancelReads]);

  const changeBranch = (kind: 'head' | 'base', value: string) => {
    if (!visible.current || !focused.current || mutating.current) return;
    cancelReads(); branchesChanged.current = true;
    selectedBranches.current = { ...selectedBranches.current, [kind === 'head' ? 'headBranch' : 'baseBranch']: value };
    if (kind === 'head') setHeadBranch(value); else setBaseBranch(value);
    setComparison(null); setCheckedBranches(null); setCreated(null); setError(''); setChecking(false);
  };
  const validBranches = isValidContributionBranch(headBranch) && isValidContributionBranch(baseBranch);

  const create = () => {
    if (!visible.current || !focused.current || !client || !user || mutating.current || busy || checking || !forkAllowed || !isValidRepositoryName(name)) return;
    mutating.current = true;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError('');
    const currentVisit = capture();
    const task = (async () => { try {
      const result = pendingFork
        ? { fork: await waitForForkReady(client, pendingFork, repo, user.login, controller.signal), ready: true }
        : await createRepositoryFork(client, repo, name, controller.signal);
      if (!mounted.current || controller.signal.aborted || operation.current !== controller) return;
      if (result.fork && result.ready) { setPendingFork(null); setExisting(result.fork); if (currentVisit()) onOpenFork(result.fork); }
      else if (result.fork) setPendingFork(result.fork);
    } catch (cause) { if (mounted.current && currentVisit() && !controller.signal.aborted && operation.current === controller) setError(repositoryErrorMessage(cause, t)); }
    finally { mutating.current = false; if (operation.current === controller) { operation.current = null; if (mounted.current) setBusy(false); } } })()
      .finally(() => { if (writeTask.current === task) writeTask.current = null; });
    writeTask.current = task;
    return task;
  };

  const submit = () => {
    if (!visible.current || !focused.current || !client || mutating.current || busy || checking || !ownFork || !title.trim() || !comparison?.ahead_by || !checkedBranches || checkedBranches.headBranch !== headBranch || checkedBranches.baseBranch !== baseBranch) return;
    mutating.current = true;
    setBusy(true); setError('');
    const currentVisit = capture();
    const task = (async () => { try {
      const request = await submitForkContribution(client, detail, title, body, publicMode, checkedBranches);
      if (mounted.current) setCreated(request);
    } catch (cause) { if (mounted.current && currentVisit()) setError(repositoryErrorMessage(cause, t)); }
    finally { mutating.current = false; if (mounted.current) setBusy(false); } })()
      .finally(() => { if (writeTask.current === task) writeTask.current = null; });
    writeTask.current = task;
    return task;
  };

  const parent = detail.parent;
  const activeRequest = created ?? comparison?.openRequest;
  return <View>
    <Card>
      <Text style={{ fontSize: 21, fontWeight: '800', color: palette.ink }}>{t("ForkContributionPanel.forksAndContributions")}</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginVertical: 12 }}>{t("ForkContributionPanel.copyAPublicProjectIntoYourAccountThenSubmitChangesAlready")}</Text>
      {parent && <View style={{ gap: 10, marginBottom: 15 }}>
        <Text style={{ color: palette.muted }}>{t("ForkContributionPanel.originalProject")}</Text>
        <Action title={parent.full_name} secondary onPress={() => onBrowseOriginal(parent.owner.login, parent.name)} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 }}><MaterialArrow name="down" color={palette.ink} /><Text style={{ color: palette.ink, fontWeight: '700', flexShrink: 1, minWidth: 0 }}>{detail.full_name}</Text></View>
        <Text style={{ color: palette.muted, lineHeight: 20 }}>{t("ForkContributionPanel.source")}: {detail.owner.login}:{headBranch}{'\n'}{t("ForkContributionPanel.target")}: {parent.owner.login}:{baseBranch}</Text>
      </View>}
      {checking && <Loading />}
      {ownFork && <View style={{ gap: 12 }}>
        <Text style={{ color: palette.ink, fontWeight: '700' }}>{t("ForkContributionPanel.sourceBranch")}</Text>
        <TextInput placeholderTextColor={palette.muted} accessibilityLabel={t("ForkContributionPanel.sourceBranch")} value={headBranch} onChangeText={(value) => changeBranch('head', value)} autoCapitalize="none" autoCorrect={false} maxLength={255} editable={!busy && !checking} style={fieldStyle} />
        <Text style={{ color: palette.ink, fontWeight: '700' }}>{t("ForkContributionPanel.targetBranch")}</Text>
        <TextInput placeholderTextColor={palette.muted} accessibilityLabel={t("ForkContributionPanel.targetBranch")} value={baseBranch} onChangeText={(value) => changeBranch('base', value)} autoCapitalize="none" autoCorrect={false} maxLength={255} editable={!busy && !checking} style={fieldStyle} />
        <Text style={{ color: palette.muted, lineHeight: 22 }}>{validBranches
          ? t("ForkContributionPanel.enterBranchNamesAlreadyOnGitHubThenCompareTheChangesBetween")
          : t("ForkContributionPanel.enterValidSourceAndTargetBranchNames")}</Text>
        <Action title={checking ? t("ForkContributionPanel.checking") : t("ForkContributionPanel.compareBranches")} secondary disabled={busy || checking || !validBranches} onPress={() => { void refresh({ headBranch, baseBranch }); }} />
      </View>}
      {ownFork && comparison && <View style={{ gap: 12, marginTop: 15 }}>
        <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '700' }}>{t("ForkContributionPanel.commitsAhead", { p0: comparison.ahead_by })}</Text>
        <Text style={{ color: palette.muted }}>{t("ForkContributionPanel.commitsBehindChangedFiles", { p0: comparison.behind_by, p1: comparison.files?.length ?? 0 })}</Text>
        {comparison.files?.slice(0, 8).map((file) => <View key={file.filename} style={{ borderTopWidth: 1, borderColor: palette.border, paddingTop: 10 }}><Text style={{ color: palette.ink }}>{file.filename}</Text><Text style={{ color: palette.muted, marginTop: 4 }}>+{file.additions} / −{file.deletions}</Text></View>)}
        {activeRequest ? <>
          <Text style={{ color: palette.green }}>{created ? t("ForkContributionPanel.contributionSubmitted") : t("ForkContributionPanel.anExistingContributionIsWaitingForReview")}</Text>
          <Action title={`#${activeRequest.number} ${activeRequest.title}`} secondary onPress={() => onOpenRequest(parent!.owner.login, parent!.name, activeRequest.number)} />
          <Action title={t("ForkContributionPanel.viewOnGitHub")} secondary onPress={() => { void Linking.openURL(activeRequest.html_url); }} />
        </> : comparison.ahead_by === 0 ? <Text style={{ color: palette.muted, lineHeight: 22 }}>{t("ForkContributionPanel.thereAreNoChangesToSubmitUpdateYourForkOnGitHub")}</Text> : <>
          <Text style={{ color: palette.ink, fontWeight: '700' }}>{t("ForkContributionPanel.contributionTitle")}</Text>
          <TextInput placeholderTextColor={palette.muted} accessibilityLabel={t("ForkContributionPanel.contributionTitle")} placeholder={t("ForkContributionPanel.describeYourChangesInOneSentence")} value={title} onChangeText={setTitle} maxLength={256} editable={!busy} style={fieldStyle} />
          <Text style={{ color: palette.ink, fontWeight: '700' }}>{t("ForkContributionPanel.description")}</Text>
          <TextInput placeholderTextColor={palette.muted} accessibilityLabel={t("ForkContributionPanel.contributionDescription")} placeholder={t("ForkContributionPanel.explainWhyYouMadeTheseChanges")} value={body} onChangeText={setBody} maxLength={65536} multiline editable={!busy} style={[fieldStyle, { minHeight: 120, textAlignVertical: 'top' }]} />
          <Action title={busy ? t("ForkContributionPanel.submitting") : t("ForkContributionPanel.submitContribution")} disabled={busy || checking || !!error || !title.trim()} onPress={() => { void submit(); }} />
        </>}
      </View>}
      {!ownFork && forkAllowed && <View style={{ gap: 12 }}>
        {existing ? <><Text style={{ color: palette.ink }}>{t("ForkContributionPanel.youAlreadyHaveARelatedFork")}: {existing.full_name}</Text><Action title={t("ForkContributionPanel.openFork")} onPress={() => onOpenFork(existing)} /></> : pendingFork ? <>
          <Text style={{ color: palette.muted, lineHeight: 22 }}>{t("ForkContributionPanel.githubIsPreparingCheckAgainShortlyOrLookInMyProjects", { p0: pendingFork.full_name })}</Text>
          <Action title={busy ? t("ForkContributionPanel.checking") : t("ForkContributionPanel.checkForkReadiness")} disabled={busy || checking} onPress={() => { void create(); }} />
        </> : <>
          <Text style={{ color: palette.ink, fontWeight: '700' }}>{t("ForkContributionPanel.forkName")}</Text>
          <TextInput placeholderTextColor={palette.muted} accessibilityLabel={t("ForkContributionPanel.forkName")} value={name} onChangeText={setName} autoCapitalize="none" autoCorrect={false} maxLength={100} editable={!busy} style={fieldStyle} />
          <Text style={{ color: palette.muted }}>{user?.login}/{name} · {t("ForkContributionPanel.copiesOnlyTheDefaultBranch")}</Text>
          <Action title={busy ? t("ForkContributionPanel.creatingFork") : t("ForkContributionPanel.createFork")} disabled={busy || checking || !!error || !isValidRepositoryName(name)} onPress={() => { void create(); }} />
        </>}
      </View>}
      {!checking && !ownFork && !forkAllowed && <Text style={{ color: palette.muted, lineHeight: 22 }}>{publicMode && repo.owner.login.toLowerCase() === user?.login.toLowerCase() ? t("ForkContributionPanel.openYourForkFromMyProjectsToSubmitAContribution") : repo.archived ? t("ForkContributionPanel.thisProjectIsArchivedForkingAndContributionsAreUnavailable") : t("ForkContributionPanel.thisProjectDoesNotNeedOrAllowAForkRightNow")}</Text>}
    </Card>
    {!!error && <ErrorText message={error} onRetry={() => { void refresh(ownFork ? { headBranch, baseBranch } : undefined); }} />}
  </View>;
}
