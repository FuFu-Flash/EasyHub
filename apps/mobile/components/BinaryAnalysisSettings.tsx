import { localizeError } from '../features/localization/error.ts';
import { useTranslation } from '@/features/localization/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { File } from 'expo-file-system';
import type { BinaryAiReviewResult, BinaryAnalysisResult } from '@easyhub/types';
import { AppAlert } from './AppAlert';
import { Card, palette } from './elements';
import { MaterialArrow } from './MaterialArrow';
import { usePreferences } from '@/features/preferences/provider';
import { AI_PROVIDERS } from '@/features/ai/review';
import { analysisEngineStatus, analysisFileInfo, installAnalysisFramework, removeAnalysisFramework, type AnalysisEngineStatus, type AnalysisFrameworkId, type AnalysisProgress, type FrameworkProgress } from '@/features/analysis/native';
import { frameworkRequirement } from '@/features/analysis/frameworks';
import { prepareProgramReview, runProgramReview, type ProgramReviewFile, type ProgramReviewPreparation } from '@/features/analysis/programReview';
import { isProgramReviewUiTest, programReviewServices } from '@/features/analysis/programReviewRuntime';
import { MAX_ANALYSIS_BYTES } from '@/features/analysis/source';
import { formatBytes } from '@/features/github/downloadProgress';
import { useProgramReviewNotice } from '@/features/analysis/useProgramReviewNotice';
import { usePageFeedback } from '@/features/workspace/usePageFeedback';
import { FeedbackNotice } from './FeedbackNotice';
import { useSuccessNotice } from '@/features/workspace/useSuccessNotice';

type Operation = 'choose' | 'prepare' | 'extracting' | 'reviewing' | 'install' | 'remove' | 'cancel';
type OperationLock = { id: number; kind: Operation };

function engineStatus(): AnalysisEngineStatus | null {
  try { return analysisEngineStatus(); } catch { return null; }
}

function requestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

function ReviewAction({ title, onPress, disabled, secondary }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={{ minHeight: 48, minWidth: 0, maxWidth: '100%', borderRadius: 12, borderWidth: 1, borderColor: secondary ? palette.border : 'transparent',
      backgroundColor: secondary ? '#fff' : disabled ? '#9dc2f6' : palette.blue, paddingHorizontal: 15, paddingVertical: 12, justifyContent: 'center', alignItems: 'center' }}>
    <Text style={{ color: secondary ? disabled ? palette.muted : palette.ink : '#fff', fontWeight: '700', fontSize: 15, textAlign: 'center', flexShrink: 1 }}>{title}</Text>
  </Pressable>;
}

function EvidenceSection({ title, children }: { title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: palette.border }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}>
      <Text style={{ flex: 1, minWidth: 0, color: palette.ink, fontWeight: '700', lineHeight: 22 }}>{title}</Text>
      <MaterialArrow name={expanded ? 'expandLess' : 'expandMore'} />
    </Pressable>
    {expanded && children}
  </View>;
}

function ProgramEvidence({ analysis }: { analysis: BinaryAnalysisResult }) {
  const t = useTranslation();
  return <EvidenceSection title={t("BinaryAnalysisSettings.extractedProgramEvidence")}>
    <Text selectable style={{ color: palette.ink, lineHeight: 23, marginBottom: 12 }}>{analysis.summary}</Text>
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: palette.ink, lineHeight: 22 }}>{t("BinaryAnalysisSettings.file")}: {analysis.fileName}</Text>
      <Text selectable style={{ color: palette.muted, lineHeight: 22 }}>{t("BinaryAnalysisSettings.size")}: {formatBytes(analysis.size)}{'\n'}{t("BinaryAnalysisSettings.format")}: {analysis.format}{'\n'}{t("BinaryAnalysisSettings.architecture")}: {analysis.architecture}{'\n'}{t("BinaryAnalysisSettings.functionsClasses")}: {analysis.functionCount}</Text>
      <Text selectable style={{ color: palette.muted, fontSize: 12, lineHeight: 19 }}>SHA-256{'\n'}{analysis.sha256}</Text>
    </View>
    {analysis.functions.length > 0 && <View style={{ marginTop: 10 }}>
      <Text style={{ color: palette.ink, fontWeight: '800', marginTop: 10 }}>{t("BinaryAnalysisSettings.functionExcerpts")}</Text>
      {analysis.functions.map((item, index) => <EvidenceSection key={`${analysis.id}:${index}`} title={`${item.name}\n${item.address}`}>
        <ScrollView horizontal style={{ backgroundColor: '#f3f6fb', borderRadius: 8 }}>
          <Text selectable style={{ color: palette.ink, fontFamily: 'monospace', fontSize: 12, lineHeight: 19, padding: 12 }}>{item.code}</Text>
        </ScrollView>
      </EvidenceSection>)}
    </View>}
    {analysis.imports.length > 0 && <EvidenceSection title={t("BinaryAnalysisSettings.imports", { p0: analysis.imports.length })}>
      {analysis.imports.map((item, index) => <Text selectable key={index} style={{ color: palette.muted, lineHeight: 21, marginBottom: 7 }}>{item}</Text>)}
    </EvidenceSection>}
    {analysis.strings.length > 0 && <EvidenceSection title={t("BinaryAnalysisSettings.textExcerpts", { p0: analysis.strings.length })}>
      {analysis.strings.map((item, index) => <Text selectable key={index} style={{ color: palette.muted, lineHeight: 21, marginBottom: 7 }}>{item}</Text>)}
    </EvidenceSection>}
    {analysis.limitations.length > 0 && <View style={{ marginTop: 16, gap: 7 }}>
      <Text style={{ color: palette.ink, fontWeight: '800' }}>{t("BinaryAnalysisSettings.extractionCoverage")}</Text>
      {analysis.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, lineHeight: 22 }}>• {item}</Text>)}
    </View>}
  </EvidenceSection>;
}

/** Local program review shares the same AI authorization and consent flow as PR review. */
export function BinaryAnalysisSettings({ onOpenComponents }: { onOpenComponents?: () => void } = {}) {
  const { language } = usePreferences();
  const t = useTranslation();
  const { programReview } = useLocalSearchParams<{ programReview?: string }>();
  const { noticesEnabled, setNoticesEnabled } = useProgramReviewNotice();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(engineStatus);
  const [componentsExpanded, setComponentsExpanded] = useState(false);
  const [frameworkProgress, setFrameworkProgress] = useState<FrameworkProgress | null>(null);
  const [installingComponent, setInstallingComponent] = useState<AnalysisFrameworkId | null>(null);
  const [selected, setSelected] = useState<ProgramReviewFile | null>(null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [analysis, setAnalysis] = useState<BinaryAnalysisResult | null>(null);
  const [review, setReview] = useState<BinaryAiReviewResult | null>(null);
  const { value: error, set: setError } = usePageFeedback('');
  const { value: notice, set: setNotice, dismiss: dismissNotice } = useSuccessNotice();
  const mounted = useRef(true);
  const focused = useRef(false);
  const focusedLanguage = useRef(language);
  const generation = useRef(0);
  const selectedRef = useRef<ProgramReviewFile | null>(null);
  const busyRef = useRef<OperationLock | null>(null);
  const active = useRef<AbortController | null>(null);
  const installingComponentRef = useRef<AnalysisFrameworkId | null>(null);
  const invalidate = useCallback(() => { generation.current++; }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; invalidate(); active.current?.abort(); };
  }, [invalidate]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    setStatus(engineStatus());
    if (focusedLanguage.current !== language) {
      setError(''); setNotice('');
    }
    focusedLanguage.current = language;
    return () => {
      focused.current = false;
      invalidate();
      if (active.current) {
        active.current.abort();
        if (busyRef.current) busyRef.current.kind = 'cancel';
        if (mounted.current) setBusy('cancel');
      }
    };
  }, [invalidate, language, setError, setNotice]));
  useFocusEffect(useCallback(() => {
    if (programReview !== '1') return;
    setExpanded(true); setComponentsExpanded(true);
    onOpenComponents?.();
    router.setParams({ programReview: undefined });
  }, [onOpenComponents, programReview]));

  const current = (id: number): boolean => mounted.current && focused.current && focusedLanguage.current === language && generation.current === id;
  const begin = (kind: Operation): number | null => {
    if (!focused.current || busyRef.current || active.current) return null;
    const id = ++generation.current;
    busyRef.current = { id, kind };
    setBusy(kind); setError(''); setNotice('');
    return id;
  };
  const finish = (id: number): void => {
    if (busyRef.current?.id !== id) return;
    busyRef.current = null;
    if (mounted.current) { setBusy(null); setProgress(null); setFrameworkProgress(null); }
  };
  const install = async (component: AnalysisFrameworkId): Promise<void> => {
    const item = status?.components?.find((value) => value.id === component);
    if (!item?.supported || item.installed) return;
    const id = begin('install');
    if (id === null) return;
    const controller = new AbortController(); active.current = controller;
    const installRequestId = requestId();
    installingComponentRef.current = component; setInstallingComponent(component);
    setComponentsExpanded(true);
    setFrameworkProgress({ requestId: installRequestId, component, phase: 'downloading', completed: 0, total: item.downloadBytes, message: '', unit: 'bytes' });
    try {
      const value = await installAnalysisFramework({ requestId: installRequestId, component, language }, controller.signal, (event) => {
        if (current(id) && !controller.signal.aborted && event.component === component) setFrameworkProgress(event);
      });
      if (current(id) && !controller.signal.aborted) {
        setStatus(value); setNotice(t("BinaryAnalysisSettings.componentInstalledReviewIsReady"));
      }
    } catch (cause) {
      if (mounted.current && focused.current && focusedLanguage.current === language && controller.signal.aborted) setNotice(t("BinaryAnalysisSettings.downloadCanceledYouCanRetry"));
      else if (current(id)) setError(localizeError(cause, t, t("BinaryAnalysisSettings.componentDownloadDidNotCompletePleaseRetry")));
    } finally {
      if (active.current === controller) active.current = null;
      installingComponentRef.current = null;
      if (mounted.current) setInstallingComponent(null);
      if (mounted.current) setStatus(engineStatus());
      finish(id);
    }
  };
  const remove = async (component: AnalysisFrameworkId): Promise<void> => {
    const id = begin('remove');
    if (id === null) return;
    try {
      const value = await removeAnalysisFramework(component, language);
      if (current(id)) { setStatus(value); setNotice(t("BinaryAnalysisSettings.componentRemovedDownloadItAgainWhenNeeded")); }
    } catch (cause) {
      if (current(id)) setError(localizeError(cause, t, t("BinaryAnalysisSettings.couldNotRemoveTheComponentPleaseRetry")));
    } finally { if (mounted.current) setStatus(engineStatus()); finish(id); }
  };
  const checkStatus = (): void => {
    if (busyRef.current || active.current) return;
    generation.current++;
    setError(''); setNotice('');
    try {
      const value = analysisEngineStatus();
      setStatus(value);
      if (!value) throw new Error(t("BinaryAnalysisSettings.thisBuildDoesNotIncludeProgramReviewComponents"));
      setNotice(t("BinaryAnalysisSettings.componentStatusRefreshed"));
    } catch (cause) {
      setError(localizeError(cause, t, t("BinaryAnalysisSettings.couldNotCheckComponentsPleaseRetry")));
    }
  };
  const chooseFile = async (): Promise<void> => {
    const id = begin('choose');
    if (id === null) return;
    try {
      const choice = await File.pickFileAsync({ multipleFiles: false, mimeTypes: ['*/*'] });
      if (choice.canceled || !current(id)) return;
      const info = await analysisFileInfo(choice.result.uri);
      if (!current(id)) return;
      if (info.size !== null && info.size > (status?.maxBytes ?? MAX_ANALYSIS_BYTES)) {
        throw new Error(t("BinaryAnalysisSettings.theFileExceedsChooseASmallerFile", { p0: formatBytes(status?.maxBytes ?? MAX_ANALYSIS_BYTES) }));
      }
      const file = { uri: choice.result.uri, ...info };
      selectedRef.current = file;
      setSelected(file); setAnalysis(null); setReview(null);
    } catch (cause) {
      if (current(id)) setError(localizeError(cause, t, t("BinaryAnalysisSettings.couldNotSelectTheFilePleaseRetry")));
    } finally { finish(id); }
  };
  const startReview = async (prepared: ProgramReviewPreparation, confirmationId: number, file: ProgramReviewFile): Promise<void> => {
    if (!current(confirmationId) || selectedRef.current !== file || busyRef.current || active.current) return;
    const id = begin('extracting');
    if (id === null) return;
    const controller = new AbortController();
    active.current = controller;
    setAnalysis(null); setReview(null); setProgress(null);
    try {
      const requirement = frameworkRequirement(analysisEngineStatus(), file.name, language);
      if (!requirement.ready) throw new Error(requirement.message);
      const result = await runProgramReview({
        requestId: requestId(), prepared, consentToSend: true, language, signal: controller.signal,
        onProgress: (value) => { if (current(id) && !controller.signal.aborted) setProgress(value); },
        onStage: (stage) => {
          if (current(id) && !controller.signal.aborted) { if (busyRef.current) busyRef.current.kind = stage; setBusy(stage); if (stage === 'reviewing') setProgress(null); }
        },
        onAnalysis: (value) => { if (current(id) && !controller.signal.aborted) setAnalysis(value); },
      }, programReviewServices);
      if (current(id) && !controller.signal.aborted) {
        setAnalysis(result.analysis); setReview(result.review);
      }
    } catch (cause) {
      if (mounted.current && focused.current && focusedLanguage.current === language && controller.signal.aborted) setNotice(t("BinaryAnalysisSettings.canceled"));
      else if (current(id)) setError(localizeError(cause, t, t("BinaryAnalysisSettings.aiReviewCouldNotBeCompletedCheckTheFileAndComponents")));
    } finally {
      if (active.current === controller) active.current = null;
      finish(id);
    }
  };
  const prepareReview = async (): Promise<void> => {
    const file = selectedRef.current;
    if (!file) return;
    const id = begin('prepare');
    if (id === null) return;
    try {
      const requirement = frameworkRequirement(analysisEngineStatus(), file.name, language);
      if (!requirement.ready) { setComponentsExpanded(true); throw new Error(requirement.message); }
      const prepared = await prepareProgramReview(file, language, programReviewServices);
      if (!current(id) || selectedRef.current !== file) return;
      const provider = AI_PROVIDERS.find((item) => item.id === prepared.settings.providerId)!;
      AppAlert.alert(t("BinaryAnalysisSettings.useAIToReviewThisProgramFile"),
        `${t("BinaryAnalysisSettings.afterConfirmationProgramContentIsExtractedOnThisDeviceTheFile")}\n\n${t("BinaryAnalysisSettings.provider")}: ${provider.name}\n${t("BinaryAnalysisSettings.serviceAddress")}: ${prepared.providerBaseUrl}\n${t("AiReviewSettings.modelName")}: ${prepared.settings.model}\n${t("BinaryAnalysisSettings.file")}: ${file.name}\n\n${t("BinaryAnalysisSettings.confirmThatYouWantToShareThisExtractedContentYourProvider")}`,
        [{ text: t("AiReviewSettings.cancel"), style: 'cancel', onPress: () => { if (current(id)) generation.current++; } },
          { text: t("BinaryAnalysisSettings.agreeAndStartReview"), onPress: () => { void startReview(prepared, id, file); } }]);
    } catch (cause) {
      if (current(id)) setError(localizeError(cause, t, t("BinaryAnalysisSettings.setUpAIAccessAboveFirstChooseAProviderAndSave")));
    } finally { finish(id); }
  };
  const cancel = (): void => {
    if (!active.current || active.current.signal.aborted) return;
    generation.current++;
    if (busyRef.current) busyRef.current.kind = 'cancel';
    setBusy('cancel'); setProgress(null); setError('');
    if (!installingComponentRef.current) setFrameworkProgress(null);
    active.current.abort();
  };

  const ready = !!(status?.javaAvailable || status?.nativeAvailable);
  const selectedRequirement = selected ? frameworkRequirement(status, selected.name, language) : null;
  const summary = busy === 'cancel' ? t("BinaryAnalysisSettings.canceling")
    : busy === 'install' ? t("BinaryAnalysisSettings.downloadingReviewComponents")
    : busy === 'remove' ? t("BinaryAnalysisSettings.removingComponent")
    : busy === 'extracting' ? t("BinaryAnalysisSettings.extractingProgramContent")
    : busy === 'reviewing' ? t("BinaryAnalysisSettings.reviewingWithAI")
    : status?.javaAvailable && status.nativeAvailable ? t("BinaryAnalysisSettings.readyReviewALocalProgramFile")
    : ready ? t("BinaryAnalysisSettings.someComponentsInstalledManageComponents")
    : status?.components?.some((item) => item.supported) ? t("BinaryAnalysisSettings.optionalDownloadProgramReviewComponents")
    : t("BinaryAnalysisSettings.componentsUnavailableViewDetails");
  const progressDetail = progress && progress.total > 0 ? progress.unit === 'bytes'
    ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total)}` : `${progress.completed} / ${progress.total}` : '';
  const frameworkProgressDetail = frameworkProgress && frameworkProgress.total > 0 ? frameworkProgress.unit === 'bytes'
    ? `${formatBytes(frameworkProgress.completed)} / ${formatBytes(frameworkProgress.total)}` : `${frameworkProgress.completed} / ${frameworkProgress.total}` : '';
  const frameworkPhaseText = busy === 'cancel' ? t("BinaryAnalysisSettings.canceling")
    : frameworkProgress?.phase === 'verifying' ? t("BinaryAnalysisSettings.verifyingComponent")
    : frameworkProgress?.phase === 'installing' ? t("BinaryAnalysisSettings.installingComponent")
    : t("BinaryAnalysisSettings.downloadingComponent");
  return <Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("BinaryAnalysisSettings.programFileReview")}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{summary}</Text>
      </View>
      <MaterialArrow name={expanded ? 'expandLess' : 'expandMore'} />
    </Pressable>
    {expanded && <View style={{ marginTop: 15 }}>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: noticesEnabled }} onPress={() => setNoticesEnabled(!noticesEnabled)}
        style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, marginBottom: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: palette.ink, fontWeight: '700', lineHeight: 22 }}>{t("BinaryAnalysisSettings.componentInstallationReminders")}</Text>
          <Text style={{ color: palette.muted, marginTop: 5, lineHeight: 21 }}>{t("BinaryAnalysisSettings.showAReminderWhenAPullRequestNeedsAMissingComponent")}</Text></View>
        <Text style={{ color: noticesEnabled ? palette.blue : palette.muted, fontWeight: '700' }}>{noticesEnabled ? t("BinaryAnalysisSettings.on") : t("BinaryAnalysisSettings.off")}</Text>
      </Pressable>
      <Text style={{ color: palette.muted, lineHeight: 22 }}>{t("BinaryAnalysisSettings.usesTheSameAIProviderAsChangeRequestsAfterConfirmationProgram")}</Text>
      {isProgramReviewUiTest && <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 19, marginTop: 8 }}>{t("BinaryAnalysisSettings.uiTestingAIUsesALocalSimulatedResponse")}</Text>}
      <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#f3f6fb' }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: componentsExpanded }} onPress={() => setComponentsExpanded((value) => !value)}
          style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: palette.ink, fontWeight: '800' }}>{t("BinaryAnalysisSettings.manageReviewComponents")}</Text>
            <Text style={{ color: palette.muted, lineHeight: 21, marginTop: 5 }}>{t("BinaryAnalysisSettings.downloadFromTheProjectRepositoryWhenNeededInstallOrRemoveEach")}</Text></View>
          <MaterialArrow name={componentsExpanded ? 'expandLess' : 'expandMore'} />
        </Pressable>
        {componentsExpanded && <View style={{ marginTop: 10, gap: 14 }}>
          {(status?.components ?? []).map((component) => <View key={component.id} style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 13, gap: 9 }}>
            <Text selectable style={{ color: palette.ink, fontWeight: '800', lineHeight: 22 }}>{component.id === 'java' ? 'Java / Dalvik · JADX' : t("BinaryAnalysisSettings.nativeProgramsRadare2R2ghidra")}{'\n'}{component.version}</Text>
            <Text accessibilityLiveRegion={installingComponent === component.id ? 'polite' : 'none'} style={{ color: component.supported && component.installed ? palette.green : palette.muted, lineHeight: 22 }}>{installingComponent === component.id ? frameworkPhaseText : !component.supported ? t("BinaryAnalysisSettings.notSupportedOnThisDevice") : component.installed ? t("BinaryAnalysisSettings.installed") : t("BinaryAnalysisSettings.notInstalled")}</Text>
            <Text style={{ color: palette.muted, lineHeight: 22 }}>{installingComponent === component.id
              ? frameworkProgressDetail || t("BinaryAnalysisSettings.preparing")
              : `${t("BinaryAnalysisSettings.downloadSize")}: ${formatBytes(component.downloadBytes)}${component.installed ? `\n${t("BinaryAnalysisSettings.storageUsed")}: ${formatBytes(component.installedBytes)}` : ''}`}</Text>
            {installingComponent === component.id ? <ReviewAction secondary disabled={busy === 'cancel'} title={busy === 'cancel' ? t("BinaryAnalysisSettings.canceling") : t("BinaryAnalysisSettings.cancelDownload")} onPress={cancel} />
              : (component.supported || component.installed) && <ReviewAction secondary={component.installed} disabled={!!busy} title={component.installed
              ? component.id === 'java' ? t("BinaryAnalysisSettings.removeJavaDalvik") : t("BinaryAnalysisSettings.removeNativeComponent")
              : component.id === 'java' ? t("BinaryAnalysisSettings.downloadJavaDalvik") : t("BinaryAnalysisSettings.downloadNativeComponent")}
              onPress={() => { if (component.installed) { void remove(component.id); } else { void install(component.id); } }} />}
          </View>)}
          {!status && <Text style={{ color: palette.muted, lineHeight: 22 }}>{t("BinaryAnalysisSettings.couldNotReadComponentStatusCheckTheInstalledAppVersion")}</Text>}
          <ReviewAction secondary title={t("BinaryAnalysisSettings.checkComponents")} disabled={!!busy} onPress={checkStatus} />
        </View>}
      </View>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 14 }}>APK · DEX · JAR · CLASS{'\n'}EXE · DLL · SO · ELF · Mach-O</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 7 }}>{t("BinaryAnalysisSettings.filesUpToJavaInputAndExpandedBytecodeUpToExtracted", { p0: formatBytes(status?.maxBytes ?? MAX_ANALYSIS_BYTES), p1: formatBytes(status?.maxJavaBytes ?? 64 * 1024 * 1024) })}</Text>
      <View style={{ marginTop: 16, paddingTop: 15, borderTopWidth: 1, borderTopColor: palette.border, gap: 10 }}>
        {selected ? <>
          <Text selectable style={{ color: palette.ink, fontWeight: '800', lineHeight: 23 }}>{selected.name}</Text>
          <Text style={{ color: palette.muted }}>{selected.size === null ? t("BinaryAnalysisSettings.sizeVerifiedWhenTheFileIsRead") : formatBytes(selected.size)}</Text>
        </> : <Text style={{ color: palette.muted, lineHeight: 22 }}>{t("BinaryAnalysisSettings.selectAProgramFileAfterConfirmationItsContentIsExtractedAnd")}</Text>}
        <ReviewAction secondary title={busy === 'choose' ? t("BinaryAnalysisSettings.choosing") : selected ? t("BinaryAnalysisSettings.changeFile") : t("BinaryAnalysisSettings.selectLocalFile")} disabled={!!busy || !status} onPress={() => { void chooseFile(); }} />
        {selected && !selectedRequirement?.ready && <Text style={{ color: palette.muted, lineHeight: 22 }}>{selectedRequirement?.message}</Text>}
        {selected && !selectedRequirement?.ready && <ReviewAction secondary title={t("BinaryAnalysisSettings.manageRequiredComponents")} disabled={!!busy} onPress={() => setComponentsExpanded(true)} />}
        {selected && <ReviewAction title={busy === 'prepare' ? t("BinaryAnalysisSettings.loadingAISettings") : review ? t("BinaryAnalysisSettings.reviewAgain") : t("BinaryAnalysisSettings.aiReview")} disabled={!!busy || !selectedRequirement?.ready} onPress={() => { void prepareReview(); }} />}
        {selected && <Text style={{ color: palette.muted, lineHeight: 21 }}>{t("BinaryAnalysisSettings.theSelectedFileIsReadWithoutRunningTheProgram")}</Text>}
      </View>
      {!installingComponent && (busy === 'extracting' || busy === 'reviewing' || busy === 'cancel') && <View accessibilityLiveRegion="polite" style={{ marginTop: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={palette.blue} />
          <Text style={{ color: palette.muted, lineHeight: 22, flex: 1, minWidth: 0 }}>{busy === 'cancel' ? t("BinaryAnalysisSettings.canceling") : busy === 'reviewing' ? t("BinaryAnalysisSettings.reviewingWithAI") : progress?.phase === 'preparing' ? t("analysis.preparingFile") : progress?.phase === 'complete' ? t("analysis.decompilationComplete") : t("BinaryAnalysisSettings.extractingProgramContent")}{progressDetail ? `\n${progressDetail}` : ''}</Text>
        </View>
        <ReviewAction secondary title={busy === 'cancel' ? t("BinaryAnalysisSettings.canceling") : t("AiReviewSettings.cancel")} disabled={busy === 'cancel'} onPress={cancel} />
      </View>}
      {!!error && <Text accessibilityRole="alert" style={{ color: '#bf3947', lineHeight: 22, marginTop: 15 }}>{error}</Text>}
      {review && review.analysisId === analysis?.id && <View style={{ marginTop: 19, paddingTop: 17, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t("BinaryAnalysisSettings.aiReviewResults")}</Text>
        <Text selectable style={{ color: palette.ink, lineHeight: 23, marginTop: 11 }}>{review.summary}</Text>
        {review.findings.map((finding, index) => <View key={index} style={{ marginTop: 16, gap: 8 }}>
          <Text style={{ color: finding.severity === 'high' ? '#bf3947' : palette.ink, fontWeight: '800', lineHeight: 22 }}>{finding.severity === 'high' ? t("BinaryAnalysisSettings.highPriority") : finding.severity === 'medium' ? t("BinaryAnalysisSettings.worthChecking") : t("BinaryAnalysisSettings.suggestion")}</Text>
          {!!finding.address && <Text selectable style={{ color: palette.muted, fontFamily: 'monospace', lineHeight: 20 }}>{finding.address}</Text>}
          <Text selectable style={{ color: palette.ink, lineHeight: 22 }}>{finding.description}</Text>
          {!!finding.suggestion && <Text selectable style={{ color: palette.muted, lineHeight: 22 }}>{finding.suggestion}</Text>}
        </View>)}
        {review.findings.length === 0 && <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 12 }}>{t("BinaryAnalysisSettings.thisReviewDidNotReportSpecificIssues")}</Text>}
        {review.limitations.length > 0 && <View style={{ marginTop: 15, gap: 7 }}>
          <Text style={{ color: palette.ink, fontWeight: '800' }}>{t("BinaryAnalysisSettings.reviewCoverage")}</Text>
          {review.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, lineHeight: 22 }}>• {item}</Text>)}
        </View>}
      </View>}
      {analysis && <ProgramEvidence key={analysis.id} analysis={analysis} />}
    </View>}
    {notice && <FeedbackNotice key={notice.id} notice={notice} onDismiss={dismissNotice} />}
  </Card>;
}
