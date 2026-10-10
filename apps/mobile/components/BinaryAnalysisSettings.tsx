import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
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
  const { t } = usePreferences();
  return <EvidenceSection title={t('程序文件提取证据', 'Extracted program evidence')}>
    <Text selectable style={{ color: palette.ink, lineHeight: 23, marginBottom: 12 }}>{analysis.summary}</Text>
    <View style={{ gap: 7 }}>
      <Text selectable style={{ color: palette.ink, lineHeight: 22 }}>{t('文件', 'File')}: {analysis.fileName}</Text>
      <Text selectable style={{ color: palette.muted, lineHeight: 22 }}>{t('大小', 'Size')}: {formatBytes(analysis.size)}{'\n'}{t('格式', 'Format')}: {analysis.format}{'\n'}{t('架构', 'Architecture')}: {analysis.architecture}{'\n'}{t('函数 / 类', 'Functions / classes')}: {analysis.functionCount}</Text>
      <Text selectable style={{ color: palette.muted, fontSize: 12, lineHeight: 19 }}>SHA-256{'\n'}{analysis.sha256}</Text>
    </View>
    {analysis.functions.length > 0 && <View style={{ marginTop: 10 }}>
      <Text style={{ color: palette.ink, fontWeight: '800', marginTop: 10 }}>{t('函数片段', 'Function excerpts')}</Text>
      {analysis.functions.map((item, index) => <EvidenceSection key={`${analysis.id}:${index}`} title={`${item.name}\n${item.address}`}>
        <ScrollView horizontal style={{ backgroundColor: '#f3f6fb', borderRadius: 8 }}>
          <Text selectable style={{ color: palette.ink, fontFamily: 'monospace', fontSize: 12, lineHeight: 19, padding: 12 }}>{item.code}</Text>
        </ScrollView>
      </EvidenceSection>)}
    </View>}
    {analysis.imports.length > 0 && <EvidenceSection title={t(`导入项 (${analysis.imports.length})`, `Imports (${analysis.imports.length})`)}>
      {analysis.imports.map((item, index) => <Text selectable key={index} style={{ color: palette.muted, lineHeight: 21, marginBottom: 7 }}>{item}</Text>)}
    </EvidenceSection>}
    {analysis.strings.length > 0 && <EvidenceSection title={t(`文本片段 (${analysis.strings.length})`, `Text excerpts (${analysis.strings.length})`)}>
      {analysis.strings.map((item, index) => <Text selectable key={index} style={{ color: palette.muted, lineHeight: 21, marginBottom: 7 }}>{item}</Text>)}
    </EvidenceSection>}
    {analysis.limitations.length > 0 && <View style={{ marginTop: 16, gap: 7 }}>
      <Text style={{ color: palette.ink, fontWeight: '800' }}>{t('提取范围', 'Extraction coverage')}</Text>
      {analysis.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, lineHeight: 22 }}>• {item}</Text>)}
    </View>}
  </EvidenceSection>;
}

/** Local program review shares the same AI authorization and consent flow as PR review. */
export function BinaryAnalysisSettings() {
  const { language, t } = usePreferences();
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
      setAnalysis(null); setReview(null); setError(''); setNotice('');
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
  }, [invalidate, language]));

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
        setStatus(value); setNotice(t('组件已安装，可以开始审查。', 'Component installed. Review is ready.'));
      }
    } catch (cause) {
      if (mounted.current && focused.current && focusedLanguage.current === language && controller.signal.aborted) setNotice(t('下载已取消，可以重试。', 'Download canceled. You can retry.'));
      else if (current(id)) setError(cause instanceof Error ? cause.message : t('组件下载未完成，请重试。', 'Component download did not complete. Please retry.'));
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
      if (current(id)) { setStatus(value); setNotice(t('组件已移除，需要时可重新下载。', 'Component removed. Download it again when needed.')); }
    } catch (cause) {
      if (current(id)) setError(cause instanceof Error ? cause.message : t('无法移除组件，请重试。', 'Could not remove the component. Please retry.'));
    } finally { if (mounted.current) setStatus(engineStatus()); finish(id); }
  };
  const checkStatus = (): void => {
    if (busyRef.current || active.current) return;
    generation.current++;
    setError(''); setNotice('');
    try {
      const value = analysisEngineStatus();
      setStatus(value);
      if (!value) throw new Error(t('此安装包未包含程序文件审查组件。', 'This build does not include program review components.'));
      setNotice(t('组件状态已更新。', 'Component status refreshed.'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('无法检查组件，请重试。', 'Could not check components. Please retry.'));
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
        throw new Error(t(`文件超过 ${formatBytes(status?.maxBytes ?? MAX_ANALYSIS_BYTES)}，请选择更小的文件。`, `The file exceeds ${formatBytes(status?.maxBytes ?? MAX_ANALYSIS_BYTES)}. Choose a smaller file.`));
      }
      const file = { uri: choice.result.uri, ...info };
      selectedRef.current = file;
      setSelected(file); setAnalysis(null); setReview(null);
    } catch (cause) {
      if (current(id)) setError(cause instanceof Error ? cause.message : t('无法选择文件，请重试。', 'Could not select the file. Please retry.'));
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
      if (mounted.current && focused.current && focusedLanguage.current === language && controller.signal.aborted) setNotice(t('已取消。', 'Canceled.'));
      else if (current(id)) setError(cause instanceof Error ? cause.message : t('AI 审查未能完成，请检查文件和组件后重试。', 'AI review could not be completed. Check the file and components, then retry.'));
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
      AppAlert.alert(t('使用 AI 审查这个程序文件？', 'Use AI to review this program file?'),
        `${t('确认后，将先在这台设备上提取程序内容，再向你的 AI 服务发送文件名、格式与架构、分析摘要，以及提取的函数代码、导入项和文本片段。', 'After confirmation, program content is extracted on this device. The file name, format, architecture, analysis summary, and extracted function code, imports, and text excerpts are then sent to your AI service.')}\n\n${t('服务商', 'Provider')}: ${provider.name}\n${t('服务地址', 'Service address')}: ${prepared.providerBaseUrl}\n${t('模型名称', 'Model name')}: ${prepared.settings.model}\n${t('文件', 'File')}: ${file.name}\n\n${t('请确认你愿意分享这些提取内容。服务商可能收费，审查结果供你进一步检查程序时参考。', 'Confirm that you want to share this extracted content. Your provider may charge for this request. Use the review to guide your own inspection.')}`,
        [{ text: t('取消', 'Cancel'), style: 'cancel', onPress: () => { if (current(id)) generation.current++; } },
          { text: t('同意并开始审查', 'Agree and start review'), onPress: () => { void startReview(prepared, id, file); } }]);
    } catch (cause) {
      if (current(id)) setError(cause instanceof Error ? cause.message : t('请先在上方设置 AI 授权，选择服务商并保存自己的 API Key。', 'Set up AI access above first. Choose a provider and save your own API key.'));
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
  const summary = busy === 'cancel' ? t('正在取消…', 'Canceling…')
    : busy === 'install' ? t('正在下载审查组件…', 'Downloading review components…')
    : busy === 'remove' ? t('正在移除组件…', 'Removing component…')
    : busy === 'extracting' ? t('正在提取程序内容…', 'Extracting program content…')
    : busy === 'reviewing' ? t('正在 AI 审查…', 'Reviewing with AI…')
    : status?.javaAvailable && status.nativeAvailable ? t('已就绪 · 审查本地程序文件', 'Ready · review a local program file')
    : ready ? t('部分组件已安装 · 点击管理', 'Some components installed · manage components')
    : status?.components?.some((item) => item.supported) ? t('可选 · 下载程序文件审查组件', 'Optional · download program review components')
    : t('组件不可用 · 点击查看', 'Components unavailable · view details');
  const progressDetail = progress && progress.total > 0 ? progress.unit === 'bytes'
    ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total)}` : `${progress.completed} / ${progress.total}` : '';
  const frameworkProgressDetail = frameworkProgress && frameworkProgress.total > 0 ? frameworkProgress.unit === 'bytes'
    ? `${formatBytes(frameworkProgress.completed)} / ${formatBytes(frameworkProgress.total)}` : `${frameworkProgress.completed} / ${frameworkProgress.total}` : '';
  const frameworkPhaseText = busy === 'cancel' ? t('正在取消…', 'Canceling…')
    : frameworkProgress?.phase === 'verifying' ? t('正在校验组件…', 'Verifying component…')
    : frameworkProgress?.phase === 'installing' ? t('正在安装组件…', 'Installing component…')
    : t('正在下载组件…', 'Downloading component…');
  return <Card>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
      style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('程序文件审查', 'Program file review')}</Text>
        <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginTop: 6, lineHeight: 20 }}>{summary}</Text>
      </View>
      <MaterialArrow name={expanded ? 'expandLess' : 'expandMore'} />
    </Pressable>
    {expanded && <View style={{ marginTop: 15 }}>
      <Text style={{ color: palette.muted, lineHeight: 22 }}>{t('与改进请求使用同一个 AI 服务。确认后自动提取程序内容并完成审查，提取证据收在审查结果中。', 'Uses the same AI provider as change requests. After confirmation, program content is extracted and reviewed, with the evidence included in the review results.')}</Text>
      {isProgramReviewUiTest && <Text style={{ color: palette.muted, fontSize: 12, lineHeight: 19, marginTop: 8 }}>{t('界面测试：AI 使用本地模拟响应', 'UI testing: AI uses a local simulated response')}</Text>}
      <View style={{ marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: '#f3f6fb' }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: componentsExpanded }} onPress={() => setComponentsExpanded((value) => !value)}
          style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: palette.ink, fontWeight: '800' }}>{t('管理审查组件', 'Manage review components')}</Text>
            <Text style={{ color: palette.muted, lineHeight: 21, marginTop: 5 }}>{t('从项目仓库按需下载，可分别安装或移除。', 'Download from the project repository when needed. Install or remove each component separately.')}</Text></View>
          <MaterialArrow name={componentsExpanded ? 'expandLess' : 'expandMore'} />
        </Pressable>
        {componentsExpanded && <View style={{ marginTop: 10, gap: 14 }}>
          {(status?.components ?? []).map((component) => <View key={component.id} style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 13, gap: 9 }}>
            <Text selectable style={{ color: palette.ink, fontWeight: '800', lineHeight: 22 }}>{component.id === 'java' ? 'Java / Dalvik · JADX' : t('原生程序 · radare2 / r2ghidra', 'Native programs · radare2 / r2ghidra')}{'\n'}{component.version}</Text>
            <Text accessibilityLiveRegion={installingComponent === component.id ? 'polite' : 'none'} style={{ color: component.supported && component.installed ? palette.green : palette.muted, lineHeight: 22 }}>{installingComponent === component.id ? frameworkPhaseText : !component.supported ? t('此设备不支持', 'Not supported on this device') : component.installed ? t('已安装', 'Installed') : t('未安装', 'Not installed')}</Text>
            <Text style={{ color: palette.muted, lineHeight: 22 }}>{installingComponent === component.id
              ? frameworkProgressDetail || t('正在准备…', 'Preparing…')
              : `${t('下载大小', 'Download size')}: ${formatBytes(component.downloadBytes)}${component.installed ? `\n${t('占用空间', 'Storage used')}: ${formatBytes(component.installedBytes)}` : ''}`}</Text>
            {installingComponent === component.id ? <ReviewAction secondary disabled={busy === 'cancel'} title={busy === 'cancel' ? t('正在取消…', 'Canceling…') : t('取消下载', 'Cancel download')} onPress={cancel} />
              : (component.supported || component.installed) && <ReviewAction secondary={component.installed} disabled={!!busy} title={component.installed
              ? component.id === 'java' ? t('移除 Java / Dalvik', 'Remove Java / Dalvik') : t('移除原生组件', 'Remove native component')
              : component.id === 'java' ? t('下载 Java / Dalvik', 'Download Java / Dalvik') : t('下载原生组件', 'Download native component')}
              onPress={() => { if (component.installed) { void remove(component.id); } else { void install(component.id); } }} />}
          </View>)}
          {!status && <Text style={{ color: palette.muted, lineHeight: 22 }}>{t('无法读取组件状态，请检查当前安装版本。', 'Could not read component status. Check the installed app version.')}</Text>}
          <ReviewAction secondary title={t('检查组件', 'Check components')} disabled={!!busy} onPress={checkStatus} />
        </View>}
      </View>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 14 }}>APK · DEX · JAR · CLASS{'\n'}EXE · DLL · SO · ELF · Mach-O</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 7 }}>{t(`文件上限 ${formatBytes(status?.maxBytes ?? MAX_ANALYSIS_BYTES)}；Java 输入及展开字节码上限 ${formatBytes(status?.maxJavaBytes ?? 64 * 1024 * 1024)}。提取代码是抽样证据，可能不完整。`, `Files up to ${formatBytes(status?.maxBytes ?? MAX_ANALYSIS_BYTES)}; Java input and expanded bytecode up to ${formatBytes(status?.maxJavaBytes ?? 64 * 1024 * 1024)}. Extracted code is sampled and may be incomplete.`)}</Text>
      <View style={{ marginTop: 16, paddingTop: 15, borderTopWidth: 1, borderTopColor: palette.border, gap: 10 }}>
        {selected ? <>
          <Text selectable style={{ color: palette.ink, fontWeight: '800', lineHeight: 23 }}>{selected.name}</Text>
          <Text style={{ color: palette.muted }}>{selected.size === null ? t('大小由读取文件时核验', 'Size verified when the file is read') : formatBytes(selected.size)}</Text>
        </> : <Text style={{ color: palette.muted, lineHeight: 22 }}>{t('选择要审查的程序文件，确认后自动提取内容并进行 AI 审查。', 'Select a program file. After confirmation, its content is extracted and reviewed with AI.')}</Text>}
        <ReviewAction secondary title={busy === 'choose' ? t('正在选择…', 'Choosing…') : selected ? t('更换文件', 'Change file') : t('选择本地文件', 'Select local file')} disabled={!!busy || !status} onPress={() => { void chooseFile(); }} />
        {selected && !selectedRequirement?.ready && <Text style={{ color: palette.muted, lineHeight: 22 }}>{selectedRequirement?.message}</Text>}
        {selected && !selectedRequirement?.ready && <ReviewAction secondary title={t('管理所需组件', 'Manage required components')} disabled={!!busy} onPress={() => setComponentsExpanded(true)} />}
        {selected && <ReviewAction title={busy === 'prepare' ? t('正在读取 AI 设置…', 'Loading AI settings…') : review ? t('重新审查', 'Review again') : t('AI 审查', 'AI review')} disabled={!!busy || !selectedRequirement?.ready} onPress={() => { void prepareReview(); }} />}
        {selected && <Text style={{ color: palette.muted, lineHeight: 21 }}>{t('只读取所选文件，不会运行该程序。', 'The selected file is read without running the program.')}</Text>}
      </View>
      {!installingComponent && (busy === 'extracting' || busy === 'reviewing' || busy === 'cancel') && <View accessibilityLiveRegion="polite" style={{ marginTop: 16, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <ActivityIndicator color={palette.blue} />
          <Text style={{ color: palette.muted, lineHeight: 22, flex: 1, minWidth: 0 }}>{busy === 'cancel' ? t('正在取消…', 'Canceling…') : busy === 'reviewing' ? t('正在 AI 审查…', 'Reviewing with AI…') : progress?.message || t('正在提取程序内容…', 'Extracting program content…')}{progressDetail ? `\n${progressDetail}` : ''}</Text>
        </View>
        <ReviewAction secondary title={busy === 'cancel' ? t('正在取消…', 'Canceling…') : t('取消', 'Cancel')} disabled={busy === 'cancel'} onPress={cancel} />
      </View>}
      {!!error && <Text accessibilityRole="alert" style={{ color: '#bf3947', lineHeight: 22, marginTop: 15 }}>{error}</Text>}
      {!!notice && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, lineHeight: 22, marginTop: 15 }}>{notice}</Text>}
      {review && review.analysisId === analysis?.id && <View style={{ marginTop: 19, paddingTop: 17, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('AI 审查结果', 'AI review results')}</Text>
        <Text selectable style={{ color: palette.ink, lineHeight: 23, marginTop: 11 }}>{review.summary}</Text>
        {review.findings.map((finding, index) => <View key={index} style={{ marginTop: 16, gap: 8 }}>
          <Text style={{ color: finding.severity === 'high' ? '#bf3947' : palette.ink, fontWeight: '800', lineHeight: 22 }}>{finding.severity === 'high' ? t('重点关注', 'High priority') : finding.severity === 'medium' ? t('建议检查', 'Worth checking') : t('改进建议', 'Suggestion')}</Text>
          {!!finding.address && <Text selectable style={{ color: palette.muted, fontFamily: 'monospace', lineHeight: 20 }}>{finding.address}</Text>}
          <Text selectable style={{ color: palette.ink, lineHeight: 22 }}>{finding.description}</Text>
          {!!finding.suggestion && <Text selectable style={{ color: palette.muted, lineHeight: 22 }}>{finding.suggestion}</Text>}
        </View>)}
        {review.findings.length === 0 && <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 12 }}>{t('本次审查没有提出具体问题。', 'This review did not report specific issues.')}</Text>}
        {review.limitations.length > 0 && <View style={{ marginTop: 15, gap: 7 }}>
          <Text style={{ color: palette.ink, fontWeight: '800' }}>{t('本次审查范围', 'Review coverage')}</Text>
          {review.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, lineHeight: 22 }}>• {item}</Text>)}
        </View>}
      </View>}
      {analysis && <ProgramEvidence key={analysis.id} analysis={analysis} />}
    </View>}
  </Card>;
}
