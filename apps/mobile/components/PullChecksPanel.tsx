import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { emptyCheckSources, loadPullChecksPage, mergeCheckSources, summarizeChecks, type CheckOutcome, type PullChecksClient } from '@/features/github/pullChecks';
import { useFocusEffect } from 'expo-router';
import type { RefreshHandle } from '@/features/github/usePullRefresh';
import { Action, Card, DirectionLabel, palette } from './elements';

export interface PullChecksHandle extends RefreshHandle { headSha: string; cancel(): void }

export interface PullChecksPanelProps {
  ref?: Ref<PullChecksHandle>;
  client: PullChecksClient;
  owner: string;
  repo: string;
  headSha: string;
  language: 'zh' | 'en';
}

// A new revision gets its own state; an old request cannot paint the new PR.
export function PullChecksPanel(props: PullChecksPanelProps) {
  return <RevisionChecks key={`${props.owner}/${props.repo}:${props.headSha}`} {...props} />;
}

function RevisionChecks({ client, owner, repo, headSha, language, ref }: PullChecksPanelProps) {
  const [sources, setSources] = useState(emptyCheckSources);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const job = useRef<AbortController | null>(null);
  const task = useRef<Promise<void> | null>(null);
  const t = (zh: string, en: string) => language === 'en' ? en : zh;
  const cancel = useCallback(() => { job.current?.abort(); job.current = null; task.current = null; }, []);
  const load = useCallback((checkPage: number | null, statusPage: number | null, reset = false) => {
    if (task.current) return task.current;
    const controller = new AbortController(); job.current = controller;
    setBusy(true); setError(false);
    const current = loadPullChecksPage(client, owner, repo, headSha, checkPage, statusPage, controller.signal)
      .then((result) => {
        if (job.current !== controller || controller.signal.aborted) return;
        setSources((previous) => {
          const empty = emptyCheckSources();
          return mergeCheckSources(reset ? {
            runs: result.checkRuns?.state === 'available' ? empty.runs : previous.runs,
            statuses: result.statuses?.state === 'available' ? empty.statuses : previous.statuses,
          } : previous, result);
        });
      }).catch(() => {
        if (job.current === controller && !controller.signal.aborted) setError(true);
      }).finally(() => {
        if (job.current === controller) { job.current = null; setBusy(false); }
        if (task.current === current) task.current = null;
      });
    task.current = current;
    return current;
  }, [client, owner, repo, headSha]);
  useImperativeHandle(ref, () => ({ headSha, refresh: () => load(1, 1, true), cancel }), [headSha, load, cancel]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(1, 1, true); });
    return () => { active = false; cancel(); };
  }, [load, cancel]);
  useFocusEffect(useCallback(() => cancel, [cancel]));

  const summary = summarizeChecks(sources, busy || error);
  const unavailable = sources.runs.error || sources.statuses.error;
  const labels: Record<CheckOutcome, string> = {
    passed: t('已通过', 'Passed'), failed: t('未通过', 'Failed'), pending: t('等待或运行中', 'Pending or running'),
    skipped: t('已跳过', 'Skipped'), neutral: t('未报告通过或失败', 'Neutral'), unknown: t('结果未知', 'Unknown'),
  };
  const summaryLabel = error || unavailable ? t('部分检查暂时无法确认', 'Some checks could not be verified')
    : summary.outcome === 'partial' ? t('检查结果尚未完整载入', 'Check results are not fully loaded')
      : summary.outcome === 'none' ? t('当前修改没有报告检查结果', 'No checks were reported for these changes')
        : summary.outcome === 'failed' ? t('有检查未通过', 'Some checks failed')
          : summary.outcome === 'pending' ? t('仍有检查等待或正在运行', 'Some checks are pending or running')
            : summary.outcome === 'passed' ? t('已报告的检查均已通过', 'All reported checks passed')
              : t('请查看各项检查结果', 'Review each check result');
  const visibleRows = showAll ? summary.rows : summary.rows.slice(0, 5);
  const color = (outcome: CheckOutcome) => outcome === 'passed' ? palette.green : outcome === 'failed' ? '#bf3947' : palette.muted;
  const openDetails = async (url: string) => {
    setLinkError(false);
    try { await Linking.openURL(url); }
    catch { setLinkError(true); }
  };

  return <Card>
    <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 19, fontWeight: '800' }}>{t('构建与测试', 'Build and tests')}</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: summary.outcome === 'passed' ? palette.green : palette.muted, marginTop: 8 }}>{summaryLabel}</Text>
    <View style={{ marginTop: 14 }}><Action title={t('刷新检查', 'Refresh checks')} secondary disabled={busy} onPress={() => { void load(1, 1, true); }} /></View>
    {error && <Text accessibilityRole="alert" style={{ color: '#bf3947', marginTop: 12 }}>{t('暂时无法确认这次修改的检查结果。请刷新检查；如果修改已更新，请返回后重新打开。', 'The checks for these changes could not be verified. Refresh the checks, or reopen the request if its changes have been updated.')}</Text>}
    {[{ source: sources.runs, label: t('构建与测试', 'Build and tests') }, { source: sources.statuses, label: t('其他检查', 'Other checks') }].filter(({ source }) => source.error).map(({ source, label }) =>
      <Text accessibilityRole="alert" key={label} style={{ color: '#bf3947', marginTop: 12 }}>{label}: {source.error === 'forbidden'
        ? t('GitHub 暂未允许读取，可能需要访问权限或稍后重试。', 'GitHub did not allow this read. Access permission or a later retry may be needed.')
        : t('暂时无法读取，已有结果不代表全部结果。', 'Could not load these results. The displayed results may be incomplete.')}</Text>)}
    {summary.rows.length > 0 && <View style={{ gap: 7, marginTop: 14 }}>{(['failed', 'pending', 'passed', 'skipped', 'neutral', 'unknown'] as const).filter((kind) => summary.counts[kind] > 0).map((kind) =>
      <Text key={kind} style={{ color: color(kind) }}>{labels[kind]} · {summary.counts[kind]}</Text>)}</View>}
    <View style={{ marginTop: 14, gap: 12 }}>{visibleRows.map((row) => <View key={row.key} style={{ borderTopWidth: 1, borderColor: palette.border, paddingTop: 12, minWidth: 0 }}>
      <Text selectable style={{ color: palette.ink, fontWeight: '700' }}>{row.name}</Text>
      {!!row.description && <Text selectable style={{ color: palette.muted, marginTop: 5 }}>{row.description}</Text>}
      <Text style={{ color: color(row.outcome), marginTop: 7 }}>{labels[row.outcome]}</Text>
      {row.url && <Pressable accessibilityRole="link" accessibilityLabel={`${t('查看日志', 'View logs')}: ${row.name}`} onPress={() => { void openDetails(row.url!); }} style={{ alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 12, minHeight: 48, minWidth: 48 }}><DirectionLabel title={t('查看日志', 'View logs')} name="external" /></Pressable>}
    </View>)}</View>
    {linkError && <Text accessibilityRole="alert" style={{ color: '#bf3947', marginTop: 12 }}>{t('无法打开检查详情，请稍后重试。', 'Could not open check details. Please try again.')}</Text>}
    {summary.rows.length > 5 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAll }} onPress={() => setShowAll((value) => !value)} style={{ paddingVertical: 12, minHeight: 44 }}><Text style={{ color: palette.blue }}>{showAll ? t('收起检查', 'Show fewer checks') : t(`查看全部检查（${summary.rows.length}）`, `Show all checks (${summary.rows.length})`)}</Text></Pressable>}
    {busy && <View style={{ marginTop: 14, gap: 8 }}><ActivityIndicator color={palette.blue} /><Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>{t('正在获取检查结果…', 'Loading check results…')}</Text></View>}
    {(sources.runs.nextPage !== null || sources.statuses.nextPage !== null) && <View style={{ marginTop: 14 }}><Action secondary disabled={busy} title={unavailable ? t('重试未读取的检查', 'Retry unavailable checks') : t('加载更多检查', 'Load more checks')} onPress={() => { void load(sources.runs.nextPage, sources.statuses.nextPage); }} /></View>}
    <Text style={{ color: palette.muted, marginTop: 14 }}>{t('这里只展示当前修改已报告的结果。是否可以合入，仍由 GitHub 的项目规则判断。', 'These are the results reported for the current changes. GitHub project rules still decide whether they can be merged.')}</Text>
  </Card>;
}
