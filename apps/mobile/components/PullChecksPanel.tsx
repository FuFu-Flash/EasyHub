import { useTranslation } from '@/features/localization/react';
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
  const t = useTranslation(language);
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
    passed: t("PullChecksPanel.passed"), failed: t("PullChecksPanel.failed"), pending: t("PullChecksPanel.pendingOrRunning"),
    skipped: t("PullChecksPanel.skipped"), neutral: t("PullChecksPanel.neutral"), unknown: t("PullChecksPanel.unknown"),
  };
  const summaryLabel = error || unavailable ? t("PullChecksPanel.someChecksCouldNotBeVerified")
    : summary.outcome === 'partial' ? t("PullChecksPanel.checkResultsAreNotFullyLoaded")
      : summary.outcome === 'none' ? t("PullChecksPanel.noChecksWereReportedForTheseChanges")
        : summary.outcome === 'failed' ? t("PullChecksPanel.someChecksFailed")
          : summary.outcome === 'pending' ? t("PullChecksPanel.someChecksArePendingOrRunning")
            : summary.outcome === 'passed' ? t("PullChecksPanel.allReportedChecksPassed")
              : t("PullChecksPanel.reviewEachCheckResult");
  const visibleRows = showAll ? summary.rows : summary.rows.slice(0, 5);
  const color = (outcome: CheckOutcome) => outcome === 'passed' ? palette.green : outcome === 'failed' ? '#bf3947' : palette.muted;
  const openDetails = async (url: string) => {
    setLinkError(false);
    try { await Linking.openURL(url); }
    catch { setLinkError(true); }
  };

  return <Card>
    <Text accessibilityRole="header" style={{ color: palette.ink, fontSize: 19, fontWeight: '800' }}>{t("PullChecksPanel.buildAndTests")}</Text>
    <Text accessibilityLiveRegion="polite" style={{ color: summary.outcome === 'passed' ? palette.green : palette.muted, marginTop: 8 }}>{summaryLabel}</Text>
    <View style={{ marginTop: 14 }}><Action title={t("PullChecksPanel.refreshChecks")} secondary disabled={busy} onPress={() => { void load(1, 1, true); }} /></View>
    {error && <Text accessibilityRole="alert" style={{ color: '#bf3947', marginTop: 12 }}>{t("PullChecksPanel.theChecksForTheseChangesCouldNotBeVerifiedRefreshThe")}</Text>}
    {[{ source: sources.runs, label: t("PullChecksPanel.buildAndTests") }, { source: sources.statuses, label: t("PullChecksPanel.otherChecks") }].filter(({ source }) => source.error).map(({ source, label }) =>
      <Text accessibilityRole="alert" key={label} style={{ color: '#bf3947', marginTop: 12 }}>{label}: {source.error === 'forbidden'
        ? t("PullChecksPanel.githubDidNotAllowThisReadAccessPermissionOrALater")
        : t("PullChecksPanel.couldNotLoadTheseResultsTheDisplayedResultsMayBeIncomplete")}</Text>)}
    {summary.rows.length > 0 && <View style={{ gap: 7, marginTop: 14 }}>{(['failed', 'pending', 'passed', 'skipped', 'neutral', 'unknown'] as const).filter((kind) => summary.counts[kind] > 0).map((kind) =>
      <Text key={kind} style={{ color: color(kind) }}>{labels[kind]} · {summary.counts[kind]}</Text>)}</View>}
    <View style={{ marginTop: 14, gap: 12 }}>{visibleRows.map((row) => <View key={row.key} style={{ borderTopWidth: 1, borderColor: palette.border, paddingTop: 12, minWidth: 0 }}>
      <Text selectable style={{ color: palette.ink, fontWeight: '700' }}>{row.name}</Text>
      {!!row.description && <Text selectable style={{ color: palette.muted, marginTop: 5 }}>{row.description}</Text>}
      <Text style={{ color: color(row.outcome), marginTop: 7 }}>{labels[row.outcome]}</Text>
      {row.url && <Pressable accessibilityRole="link" accessibilityLabel={`${t("PullChecksPanel.viewLogs")}: ${row.name}`} onPress={() => { void openDetails(row.url!); }} style={{ alignSelf: 'flex-start', maxWidth: '100%', paddingVertical: 12, minHeight: 48, minWidth: 48 }}><DirectionLabel title={t("PullChecksPanel.viewLogs")} name="external" /></Pressable>}
    </View>)}</View>
    {linkError && <Text accessibilityRole="alert" style={{ color: '#bf3947', marginTop: 12 }}>{t("PullChecksPanel.couldNotOpenCheckDetailsPleaseTryAgain")}</Text>}
    {summary.rows.length > 5 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAll }} onPress={() => setShowAll((value) => !value)} style={{ paddingVertical: 12, minHeight: 44 }}><Text style={{ color: palette.blue }}>{showAll ? t("PullChecksPanel.showFewerChecks") : t("PullChecksPanel.showAllChecks", { p0: summary.rows.length })}</Text></Pressable>}
    {busy && <View style={{ marginTop: 14, gap: 8 }}><ActivityIndicator color={palette.blue} /><Text accessibilityLiveRegion="polite" style={{ color: palette.muted }}>{t("PullChecksPanel.loadingCheckResults")}</Text></View>}
    {(sources.runs.nextPage !== null || sources.statuses.nextPage !== null) && <View style={{ marginTop: 14 }}><Action secondary disabled={busy} title={unavailable ? t("PullChecksPanel.retryUnavailableChecks") : t("PullChecksPanel.loadMoreChecks")} onPress={() => { void load(sources.runs.nextPage, sources.statuses.nextPage); }} /></View>}
    <Text style={{ color: palette.muted, marginTop: 14 }}>{t("PullChecksPanel.theseAreTheResultsReportedForTheCurrentChangesGitHubProject")}</Text>
  </Card>;
}
