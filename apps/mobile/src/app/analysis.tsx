import { localizeError } from '../../features/localization/error.ts';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BinaryAnalysisResult, BinaryAiReviewResult } from '@easyhub/types';
import { Action, BackLink, Card, ErrorText, Heading, Page, palette } from '@/components/elements';
import { AppAlert as Alert } from '@/components/AppAlert';
import { usePreferences } from '@/features/preferences/provider';
import { useSession } from '@/features/auth/session';
import { analyzeFile, analysisEngineStatus, analysisFileInfo, type AnalysisEngineStatus, type AnalysisProgress } from '@/features/analysis/native';
import { frameworkRequirement } from '@/features/analysis/frameworks';
import { analyzeGithubFile } from '@/features/analysis/download';
import { MAX_ANALYSIS_BYTES, parseAnalysisSource, type AnalysisSource } from '@/features/analysis/source';
import { formatAnalysisReport } from '@/features/analysis/report';
import { formatBytes } from '@/features/github/downloadProgress';
import { AI_PROVIDERS, reviewBinaryEvidence } from '@/features/ai/review';
import { loadAiSettings } from '@/features/ai/settings';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';

type RemoteSource = Exclude<AnalysisSource, { kind: 'local' }>;
function requestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (c) => {
    const value = Math.floor(Math.random() * 16);
    return (c === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

export default function Analysis() {
  const params = useLocalSearchParams();
  const t = useTranslation();
  let source: RemoteSource | null = null;
  let invalid = '';
  try { source = parseAnalysisSource(params); } catch (reason) { invalid = localizeError(reason, t, 'Invalid file source.'); }
  return invalid ? <Page><Heading title="EasyHub" /><ErrorText message={invalid} /><BackLink title={t("analysis.back")} /></Page>
    : <AnalysisPage key={JSON.stringify(source)} source={source} />;
}

function AnalysisPage({ source }: { source: RemoteSource | null }) {
  const { language } = usePreferences();
  const t = useTranslation();
  const { client } = useSession();
  const [status, setStatus] = useState<AnalysisEngineStatus | null>(() => analysisEngineStatus());
  const [selected, setSelected] = useState<{ uri: string; name: string; size: number | null } | null>(null);
  const [result, setResult] = useState<BinaryAnalysisResult | null>(null);
  const [aiResult, setAiResult] = useState<BinaryAiReviewResult | null>(null);
  const [busy, setBusy] = useState<'picking' | 'analysis' | 'ai' | 'sharing' | null>(null);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const { value: error, set: setError, capture } = usePageFeedback('');
  const { value: notice, set: setNotice } = usePageFeedback('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const focused = useRef(false);
  const consentVersion = useRef(0);
  const preparingAi = useRef(false);
  const resultRef = useRef<BinaryAnalysisResult | null>(null);
  const busyRef = useRef(busy);
  const picking = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  useFocusEffect(useCallback(() => { focused.current = true; setStatus(analysisEngineStatus()); return () => { focused.current = false; consentVersion.current++; active.current?.abort(); }; }, []));

  const pick = async () => {
    if (busy || picking.current) return;
    consentVersion.current++;
    const isCurrent = capture();
    picking.current = true; setBusy('picking'); setError(''); setNotice('');
    try {
      const choice = await File.pickFileAsync({ multipleFiles: false, mimeTypes: ['*/*'] });
      if (choice.canceled || !mounted.current || !isCurrent()) return;
      const info = await analysisFileInfo(choice.result.uri);
      if (info.size !== null && info.size > MAX_ANALYSIS_BYTES) throw new Error(t("analysis.theFileExceeds128MBChooseASmallerFile"));
      if (mounted.current && isCurrent()) { setSelected({ uri: choice.result.uri, ...info }); resultRef.current = null; setResult(null); setAiResult(null); setExpanded(null); }
    } catch (reason) { if (mounted.current && isCurrent()) setError(localizeError(reason, t, t("analysis.couldNotReadThisFile"))); }
    finally { picking.current = false; if (mounted.current) setBusy(null); }
  };

  const start = async () => {
    if (active.current || busy || (!source && !selected)) return;
    if (source && !client) { router.push('/login'); return; }
    const isCurrent = capture();
    consentVersion.current++; resultRef.current = null;
    const controller = new AbortController(); active.current = controller;
    setBusy('analysis'); setStopping(false); setError(''); setNotice(''); setResult(null); setAiResult(null); setExpanded(null); setProgress(null);
    const id = requestId();
    const onProgress = (value: AnalysisProgress) => { if (mounted.current && isCurrent() && !controller.signal.aborted) setProgress(value); };
    try {
      const name = source?.kind === 'release' ? source.name : source?.kind === 'pull' ? source.path : selected!.name;
      const requirement = frameworkRequirement(analysisEngineStatus(), name, language);
      if (!requirement.ready) throw new Error(requirement.message);
      const analysis = source && client
        ? await analyzeGithubFile({ source, client, requestId: id, language, signal: controller.signal, onProgress })
        : await analyzeFile({ requestId: id, uri: selected!.uri, name: selected!.name, language }, controller.signal, onProgress);
      if (mounted.current && isCurrent() && !controller.signal.aborted) { resultRef.current = analysis; setResult(analysis); setNotice(t("analysis.onDeviceDecompilationComplete")); }
    } catch (reason) {
      if (mounted.current && isCurrent()) {
        if (controller.signal.aborted) setNotice(t("analysis.analysisCancelledYouCanStartAgain"));
        else setError(localizeError(reason, t, t("analysis.decompilationFailedTryAgain")));
      }
    } finally { if (active.current === controller) active.current = null; if (mounted.current) { setBusy(null); setStopping(false); setProgress(null); } }
  };

  const prepareAi = async () => {
    if (!result || busy || active.current || preparingAi.current || !focused.current) return;
    preparingAi.current = true;
    const isCurrent = capture();
    const evidence = result;
    const version = ++consentVersion.current;
    const valid = () => mounted.current && focused.current && isCurrent() && consentVersion.current === version && resultRef.current?.id === evidence.id && !active.current && !picking.current && !busyRef.current;
    try {
      const settings = await loadAiSettings();
      if (!valid()) return;
      if (!settings) {
        Alert.alert(t("analysis.setUpAIReviewFirst"), t("analysis.chooseAProviderAndSaveYourOwnAPIKey"), [
          { text: t("AiReviewSettings.cancel"), style: 'cancel' }, { text: t("analysis.openSettings"), onPress: () => { if (valid()) router.push('/(tabs)/settings'); } },
        ]); return;
      }
      const provider = AI_PROVIDERS.find((item) => item.id === settings.providerId)!;
      Alert.alert(t("analysis.sendDecompiledEvidenceForAIReview"),
        `${t("analysis.fileNameSHA256SampledCodeImportsAndStringsWillBe")}\n\n${provider.name} · ${settings.model}\n${provider.baseUrl}\n\n${evidence.fileName}\n${evidence.sha256}`,
        [{ text: t("AiReviewSettings.cancel"), style: 'cancel' }, { text: t("analysis.agreeAndReview"), onPress: () => { void (async () => {
          if (!valid()) return;
          const controller = new AbortController(); active.current = controller; setBusy('ai'); setStopping(false); setError(''); setAiResult(null); setNotice('');
          try {
            const current = await loadAiSettings();
            if (!focused.current || !isCurrent() || consentVersion.current !== version || resultRef.current?.id !== evidence.id || controller.signal.aborted) return;
            if (!current || current.providerId !== settings.providerId || current.model !== settings.model) throw new Error(t("CommitExplanation.aiSettingsChangedConfirmAgain"));
            const review = await reviewBinaryEvidence({ analysis: evidence, settings: current, language, signal: controller.signal, consentToSend: true, providerBaseUrl: provider.baseUrl });
            if (mounted.current && isCurrent() && !controller.signal.aborted && resultRef.current?.id === evidence.id && review.analysisId === evidence.id) setAiResult(review);
          } catch (reason) { if (mounted.current && isCurrent()) { if (controller.signal.aborted) setNotice(t("analysis.aiReviewCancelled")); else setError(localizeError(reason, t, t("analysis.aiReviewFailed"))); } }
          finally { if (active.current === controller) active.current = null; if (mounted.current) { setBusy(null); setStopping(false); } }
        })(); } }]);
    } catch { if (valid()) setError(t("analysis.couldNotReadAISettingsTryAgain")); }
    finally { preparingAi.current = false; }
  };

  const share = async () => {
    if (!result || busy) return;
    const isCurrent = capture();
    setBusy('sharing'); setError('');
    const folder = new Directory(Paths.cache, 'easyhub-analysis-reports');
    const report = new File(folder, `easyhub-analysis-${result.id}.md`);
    let shared = false;
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error(t("analysis.fileSharingIsUnavailableOnThisDevice"));
      if (!isCurrent()) return;
      folder.create({ intermediates: true, idempotent: true });
      for (const previous of folder.list()) {
        if (previous instanceof File && /^easyhub-analysis-[a-f0-9-]{36}\.md$/iu.test(previous.name) && previous.modificationTime !== null && Date.now() - previous.modificationTime > 86_400_000) previous.delete();
      }
      report.write(formatAnalysisReport(result, aiResult));
      await Sharing.shareAsync(report.uri, { mimeType: 'text/markdown', dialogTitle: t("analysis.shareDecompilationReport") });
      shared = true;
    } catch (reason) { if (mounted.current && isCurrent()) setError(localizeError(reason, t, t("analysis.couldNotShareTheReport"))); }
    finally { try { if (!shared && report.exists) report.delete(); } catch { /* Preserve the sharing error. */ } if (mounted.current) setBusy(null); }
  };
  const fileName = source?.kind === 'release' ? source.name : source?.kind === 'pull' ? source.path : selected?.name;
  const requirement = frameworkRequirement(status, fileName || '', language);
  return <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: palette.background }}><Page>
    <BackLink title={t("analysis.back")} marginBottom={22} />
    <Heading title={t("analysis.programDecompiler")} subtitle={t("analysis.inspectProgramsAndRecoveredCodeOnThisDevice")} />
    <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t("analysis.supportedFiles")}</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 8 }}>APK · DEX · JAR · CLASS{ '\n' }EXE · DLL · SO · ELF · Mach-O</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 10 }}>{t("analysis.filesUpTo128MBJavaInputAndExpandedBytecodeUp")}</Text>
      <Text style={{ color: palette.muted, marginTop: 10 }}>{status?.javaAvailable ? `JADX ${status.javaVersion} · ${t("BinaryAnalysisSettings.installed")}` : t("analysis.javaDalvikIsNotInstalledOrNotSupportedOnThisDevice")}{ '\n' }{status?.nativeAvailable ? `radare2 / r2ghidra ${status.nativeVersion} · ${t("BinaryAnalysisSettings.installed")}` : t("analysis.nativeComponentIsNotInstalledOrNotSupportedOnThisDevice")}</Text>
      {!requirement.ready && <View style={{ marginTop: 13, gap: 10 }}><Text style={{ color: palette.muted, lineHeight: 22 }}>{requirement.message}</Text><Action secondary title={t("analysis.openSettingsToDownloadComponents")} disabled={!!busy} onPress={() => router.push({ pathname: '/(tabs)/settings', params: { programReview: '1' } })} /></View>}
    </Card>
    <Card>{source && <Text style={{ color: palette.muted, marginBottom: 8 }}>{source.owner}/{source.repo}{source.kind === 'pull' ? ` · #${source.number}` : ''}</Text>}
      <Text selectable style={{ color: palette.ink, fontWeight: '800', lineHeight: 23 }}>{fileName || t("analysis.chooseAFileToAnalyze")}</Text>
      {selected?.size !== null && selected?.size !== undefined && <Text style={{ color: palette.muted, marginTop: 6 }}>{formatBytes(selected.size)}</Text>}
      <View style={{ gap: 10, marginTop: 15 }}>
        {!source && <Action secondary title={busy === 'picking' ? t("BinaryAnalysisSettings.choosing") : t("analysis.chooseFile")} disabled={!!busy} onPress={() => { void pick(); }} />}
        <Action title={busy === 'analysis' ? t("analysis.decompiling") : source ? t("analysis.downloadAndDecompile") : t("analysis.startDecompilation")} disabled={!!busy || (!source && !selected) || !requirement.ready} onPress={() => { void start(); }} />
        {(busy === 'analysis' || busy === 'ai') && <Action secondary title={stopping ? t("analysis.stopping") : t("AiReviewSettings.cancel")} disabled={stopping} onPress={() => { setStopping(true); active.current?.abort(); }} />}
      </View>
      {progress && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginTop: 12, lineHeight: 22 }}>{progress.phase === 'preparing' ? t("analysis.preparingFile") : progress.phase === 'complete' ? t("analysis.decompilationComplete") : t("analysis.decompiling")}{progress.unit === 'bytes' ? `\n${formatBytes(progress.completed)}${progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}` : progress.total > 0 ? `\n${progress.completed} / ${progress.total}` : ''}</Text>}
      {busy === 'ai' && <Text style={{ color: palette.muted, marginTop: 12 }}>{t("analysis.aiIsReviewingTheDecompiledEvidence")}</Text>}
    </Card>
    {!!error && <ErrorText message={error} />}{!!notice && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginBottom: 15 }}>{notice}</Text>}
    {result && <>
      <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("analysis.analysisResult")}</Text>
        <Text selectable style={{ color: palette.ink, marginTop: 10, lineHeight: 22 }}>{result.fileName}{ '\n' }{result.format} · {result.architecture} · {formatBytes(result.size)}</Text>
        <Text selectable style={{ color: palette.muted, fontSize: 12, marginTop: 10, lineHeight: 19 }}>SHA-256{ '\n' }{result.sha256}</Text>
        <Text style={{ color: palette.ink, marginTop: 12, lineHeight: 23 }}>{result.summary}</Text>
        <Text style={{ color: palette.muted, marginTop: 9, lineHeight: 22 }}>{t("BinaryAnalysisSettings.functionsClasses")}: {result.functionCount} · {t("PullBinaryEvidence.recovered")}: {result.functions.length}{ '\n' }{t("PullBinaryEvidence.imports")}: {result.imports.length} · {t("PullBinaryEvidence.strings")}: {result.strings.length}</Text>
        {result.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, marginTop: 9, lineHeight: 22 }}>• {item}</Text>)}
        <View style={{ gap: 10, marginTop: 15 }}><Action title={t("analysis.aiReviewOfDecompiledEvidence")} disabled={!!busy} onPress={() => { void prepareAi(); }} /><Action secondary title={t("analysis.shareReport")} disabled={!!busy} onPress={() => { void share(); }} /></View>
      </Card>
      {result.functions.map((item, index) => <Card key={`${item.address}-${index}`}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === item.address }} onPress={() => setExpanded((current) => current === item.address ? null : item.address)}>
          <Text style={{ color: palette.ink, fontWeight: '800', lineHeight: 23 }}>{item.name}</Text><Text selectable style={{ color: palette.muted, marginTop: 5 }}>{item.address}</Text>
          <Text style={{ color: palette.blue, marginTop: 10 }}>{expanded === item.address ? t("PullBinaryEvidence.collapseCode") : t("PullBinaryEvidence.viewRecoveredCode")}</Text>
        </Pressable>
        {expanded === item.address && <ScrollView horizontal style={{ marginTop: 12, backgroundColor: '#f3f6fb', borderRadius: 8 }}><Text selectable style={{ fontFamily: 'monospace', color: palette.ink, padding: 12, fontSize: 12, lineHeight: 19 }}>{item.code}</Text></ScrollView>}
      </Card>)}
      <Card><Action secondary title={showEvidence ? t("analysis.hideImportsAndStrings") : t("analysis.viewImportsAndStrings")} onPress={() => setShowEvidence((value) => !value)} />
        {showEvidence && <><Text style={{ color: palette.ink, fontWeight: '800', marginTop: 15 }}>{t("PullBinaryEvidence.imports")}</Text>{result.imports.map((item, index) => <Text selectable key={`i${index}`} style={{ color: palette.muted, marginTop: 7 }}>{item}</Text>)}<Text style={{ color: palette.ink, fontWeight: '800', marginTop: 15 }}>{t("PullBinaryEvidence.strings")}</Text>{result.strings.map((item, index) => <Text selectable key={`s${index}`} style={{ color: palette.muted, marginTop: 7 }}>{item}</Text>)}</>}
      </Card>
    </>}
    {aiResult?.analysisId === result?.id && aiResult && <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("analysis.aiReviewResult")}</Text><Text style={{ color: palette.ink, marginTop: 12, lineHeight: 23 }}>{aiResult.summary}</Text>
      {aiResult.findings.map((item, index) => <View key={index} style={{ marginTop: 14 }}><Text style={{ color: item.severity === 'high' ? '#bf3947' : palette.ink, fontWeight: '800' }}>{item.severity}{item.address ? ` · ${item.address}` : ''}</Text><Text style={{ color: palette.ink, marginTop: 8, lineHeight: 22 }}>{item.description}</Text><Text style={{ color: palette.muted, marginTop: 7, lineHeight: 22 }}>{item.suggestion}</Text></View>)}
      {aiResult.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, marginTop: 10, lineHeight: 22 }}>• {item}</Text>)}
    </Card>}
  </Page></SafeAreaView>;
}
