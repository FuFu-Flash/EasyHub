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

type RemoteSource = Exclude<AnalysisSource, { kind: 'local' }>;
function requestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, (c) => {
    const value = Math.floor(Math.random() * 16);
    return (c === 'x' ? value : (value & 3) | 8).toString(16);
  });
}

export default function Analysis() {
  const params = useLocalSearchParams();
  const { t } = usePreferences();
  let source: RemoteSource | null = null;
  let invalid = '';
  try { source = parseAnalysisSource(params); } catch (reason) { invalid = reason instanceof Error ? reason.message : 'Invalid file source.'; }
  return invalid ? <Page><Heading title="EasyHub" /><ErrorText message={invalid} /><BackLink title={t('返回', 'Back')} /></Page>
    : <AnalysisPage key={JSON.stringify(source)} source={source} />;
}

function AnalysisPage({ source }: { source: RemoteSource | null }) {
  const { t, language } = usePreferences();
  const { client } = useSession();
  const [status, setStatus] = useState<AnalysisEngineStatus | null>(() => analysisEngineStatus());
  const [selected, setSelected] = useState<{ uri: string; name: string; size: number | null } | null>(null);
  const [result, setResult] = useState<BinaryAnalysisResult | null>(null);
  const [aiResult, setAiResult] = useState<BinaryAiReviewResult | null>(null);
  const [busy, setBusy] = useState<'picking' | 'analysis' | 'ai' | 'sharing' | null>(null);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
    picking.current = true; setBusy('picking'); setError(''); setNotice('');
    try {
      const choice = await File.pickFileAsync({ multipleFiles: false, mimeTypes: ['*/*'] });
      if (choice.canceled || !mounted.current) return;
      const info = await analysisFileInfo(choice.result.uri);
      if (info.size !== null && info.size > MAX_ANALYSIS_BYTES) throw new Error(t('文件超过 128 MB，请选择更小的文件。', 'The file exceeds 128 MB. Choose a smaller file.'));
      if (mounted.current) { setSelected({ uri: choice.result.uri, ...info }); resultRef.current = null; setResult(null); setAiResult(null); setExpanded(null); }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : t('无法读取这个文件。', 'Could not read this file.')); }
    finally { picking.current = false; if (mounted.current) setBusy(null); }
  };

  const start = async () => {
    if (active.current || busy || (!source && !selected)) return;
    if (source && !client) { router.push('/login'); return; }
    consentVersion.current++; resultRef.current = null;
    const controller = new AbortController(); active.current = controller;
    setBusy('analysis'); setStopping(false); setError(''); setNotice(''); setResult(null); setAiResult(null); setExpanded(null); setProgress(null);
    const id = requestId();
    const onProgress = (value: AnalysisProgress) => { if (mounted.current && !controller.signal.aborted) setProgress(value); };
    try {
      const name = source?.kind === 'release' ? source.name : source?.kind === 'pull' ? source.path : selected!.name;
      const requirement = frameworkRequirement(analysisEngineStatus(), name, language);
      if (!requirement.ready) throw new Error(requirement.message);
      const analysis = source && client
        ? await analyzeGithubFile({ source, client, requestId: id, language, signal: controller.signal, onProgress })
        : await analyzeFile({ requestId: id, uri: selected!.uri, name: selected!.name, language }, controller.signal, onProgress);
      if (mounted.current && !controller.signal.aborted) { resultRef.current = analysis; setResult(analysis); setNotice(t('本机反编译完成。', 'On-device decompilation complete.')); }
    } catch (reason) {
      if (mounted.current) {
        if (controller.signal.aborted) setNotice(t('分析已取消，可以重新开始。', 'Analysis cancelled. You can start again.'));
        else setError(reason instanceof Error ? reason.message : t('反编译失败，请重试。', 'Decompilation failed. Try again.'));
      }
    } finally { if (active.current === controller) active.current = null; if (mounted.current) { setBusy(null); setStopping(false); setProgress(null); } }
  };

  const prepareAi = async () => {
    if (!result || busy || active.current || preparingAi.current || !focused.current) return;
    preparingAi.current = true;
    const evidence = result;
    const version = ++consentVersion.current;
    const valid = () => mounted.current && focused.current && consentVersion.current === version && resultRef.current?.id === evidence.id && !active.current && !picking.current && !busyRef.current;
    try {
      const settings = await loadAiSettings();
      if (!valid()) return;
      if (!settings) {
        Alert.alert(t('请先设置 AI 审查', 'Set up AI review first'), t('选择服务商并保存你自己的 API Key。', 'Choose a provider and save your own API key.'), [
          { text: t('取消', 'Cancel'), style: 'cancel' }, { text: t('打开设置', 'Open Settings'), onPress: () => router.push('/(tabs)/settings') },
        ]); return;
      }
      const provider = AI_PROVIDERS.find((item) => item.id === settings.providerId)!;
      Alert.alert(t('发送反编译证据进行 AI 审查？', 'Send decompiled evidence for AI review?'),
        `${t('将发送文件名、SHA-256、抽样代码、导入符号和字符串。这可能包含私有代码或敏感内容，请确认你愿意发送。', 'File name, SHA-256, sampled code, imports and strings will be sent. These may contain private code or sensitive content. Confirm you want to send them.')}\n\n${provider.name} · ${settings.model}\n${provider.baseUrl}\n\n${evidence.fileName}\n${evidence.sha256}`,
        [{ text: t('取消', 'Cancel'), style: 'cancel' }, { text: t('同意并审查', 'Agree and review'), onPress: () => { void (async () => {
          if (!valid()) return;
          const controller = new AbortController(); active.current = controller; setBusy('ai'); setStopping(false); setError(''); setAiResult(null); setNotice('');
          try {
            const current = await loadAiSettings();
            if (!focused.current || consentVersion.current !== version || resultRef.current?.id !== evidence.id || controller.signal.aborted) return;
            if (!current || current.providerId !== settings.providerId || current.model !== settings.model) throw new Error(t('AI 设置已变化，请重新确认。', 'AI settings changed. Confirm again.'));
            const review = await reviewBinaryEvidence({ analysis: evidence, settings: current, language, signal: controller.signal, consentToSend: true, providerBaseUrl: provider.baseUrl });
            if (mounted.current && !controller.signal.aborted && resultRef.current?.id === evidence.id && review.analysisId === evidence.id) setAiResult(review);
          } catch (reason) { if (mounted.current) { if (controller.signal.aborted) setNotice(t('AI 审查已取消。', 'AI review cancelled.')); else setError(reason instanceof Error ? reason.message : t('AI 审查失败。', 'AI review failed.')); } }
          finally { if (active.current === controller) active.current = null; if (mounted.current) { setBusy(null); setStopping(false); } }
        })(); } }]);
    } catch { if (valid()) setError(t('无法读取 AI 设置，请重试。', 'Could not read AI settings. Try again.')); }
    finally { preparingAi.current = false; }
  };

  const share = async () => {
    if (!result || busy) return;
    setBusy('sharing'); setError('');
    const folder = new Directory(Paths.cache, 'easyhub-analysis-reports');
    const report = new File(folder, `easyhub-analysis-${result.id}.md`);
    let shared = false;
    try {
      if (!await Sharing.isAvailableAsync()) throw new Error(t('这台设备无法分享文件。', 'File sharing is unavailable on this device.'));
      folder.create({ intermediates: true, idempotent: true });
      for (const previous of folder.list()) {
        if (previous instanceof File && /^easyhub-analysis-[a-f0-9-]{36}\.md$/iu.test(previous.name) && previous.modificationTime !== null && Date.now() - previous.modificationTime > 86_400_000) previous.delete();
      }
      report.write(formatAnalysisReport(result, aiResult));
      await Sharing.shareAsync(report.uri, { mimeType: 'text/markdown', dialogTitle: t('分享反编译报告', 'Share decompilation report') });
      shared = true;
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : t('无法分享报告。', 'Could not share the report.')); }
    finally { try { if (!shared && report.exists) report.delete(); } catch { /* Preserve the sharing error. */ } if (mounted.current) setBusy(null); }
  };
  const fileName = source?.kind === 'release' ? source.name : source?.kind === 'pull' ? source.path : selected?.name;
  const requirement = frameworkRequirement(status, fileName || '', language);
  return <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: palette.background }}><Page>
    <BackLink title={t('返回', 'Back')} marginBottom={22} />
    <Heading title={t('程序反编译', 'Program decompiler')} subtitle={t('在这台设备上读取程序，查看恢复的代码与证据。', 'Inspect programs and recovered code on this device.')} />
    <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 17 }}>{t('支持的文件', 'Supported files')}</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 8 }}>APK · DEX · JAR · CLASS{ '\n' }EXE · DLL · SO · ELF · Mach-O</Text>
      <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 10 }}>{t('文件上限 128 MB；Java 输入及展开字节码上限 64 MB。恢复代码是抽样证据，可能不完整。AI 审查需要单独确认。', 'Files up to 128 MB; Java input and expanded bytecode up to 64 MB. Recovered code is sampled and may be incomplete. AI review requires separate consent.')}</Text>
      <Text style={{ color: palette.muted, marginTop: 10 }}>{status?.javaAvailable ? `JADX ${status.javaVersion} · ${t('已安装', 'Installed')}` : t('Java / Dalvik 组件未安装或此设备不支持', 'Java / Dalvik is not installed or not supported on this device')}{ '\n' }{status?.nativeAvailable ? `radare2 / r2ghidra ${status.nativeVersion} · ${t('已安装', 'Installed')}` : t('原生组件未安装或此设备不支持', 'Native component is not installed or not supported on this device')}</Text>
      {!requirement.ready && <View style={{ marginTop: 13, gap: 10 }}><Text style={{ color: palette.muted, lineHeight: 22 }}>{requirement.message}</Text><Action secondary title={t('打开设置下载组件', 'Open Settings to download components')} disabled={!!busy} onPress={() => router.push('/(tabs)/settings')} /></View>}
    </Card>
    <Card>{source && <Text style={{ color: palette.muted, marginBottom: 8 }}>{source.owner}/{source.repo}{source.kind === 'pull' ? ` · #${source.number}` : ''}</Text>}
      <Text selectable style={{ color: palette.ink, fontWeight: '800', lineHeight: 23 }}>{fileName || t('选择要分析的文件', 'Choose a file to analyze')}</Text>
      {selected?.size !== null && selected?.size !== undefined && <Text style={{ color: palette.muted, marginTop: 6 }}>{formatBytes(selected.size)}</Text>}
      <View style={{ gap: 10, marginTop: 15 }}>
        {!source && <Action secondary title={busy === 'picking' ? t('正在选择…', 'Choosing…') : t('选择文件', 'Choose file')} disabled={!!busy} onPress={() => { void pick(); }} />}
        <Action title={busy === 'analysis' ? t('正在反编译…', 'Decompiling…') : source ? t('下载并反编译', 'Download and decompile') : t('开始反编译', 'Start decompilation')} disabled={!!busy || (!source && !selected) || !requirement.ready} onPress={() => { void start(); }} />
        {(busy === 'analysis' || busy === 'ai') && <Action secondary title={stopping ? t('正在停止…', 'Stopping…') : t('取消', 'Cancel')} disabled={stopping} onPress={() => { setStopping(true); active.current?.abort(); }} />}
      </View>
      {progress && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginTop: 12, lineHeight: 22 }}>{progress.message}{progress.unit === 'bytes' ? `\n${formatBytes(progress.completed)}${progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''}` : progress.total > 0 ? `\n${progress.completed} / ${progress.total}` : ''}</Text>}
      {busy === 'ai' && <Text style={{ color: palette.muted, marginTop: 12 }}>{t('AI 正在审查反编译证据…', 'AI is reviewing the decompiled evidence…')}</Text>}
    </Card>
    {!!error && <ErrorText message={error} />}{!!notice && <Text accessibilityLiveRegion="polite" style={{ color: palette.muted, marginBottom: 15 }}>{notice}</Text>}
    {result && <>
      <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('分析结果', 'Analysis result')}</Text>
        <Text selectable style={{ color: palette.ink, marginTop: 10, lineHeight: 22 }}>{result.fileName}{ '\n' }{result.format} · {result.architecture} · {formatBytes(result.size)}</Text>
        <Text selectable style={{ color: palette.muted, fontSize: 12, marginTop: 10, lineHeight: 19 }}>SHA-256{ '\n' }{result.sha256}</Text>
        <Text style={{ color: palette.ink, marginTop: 12, lineHeight: 23 }}>{result.summary}</Text>
        <Text style={{ color: palette.muted, marginTop: 9, lineHeight: 22 }}>{t('函数 / 类', 'Functions / classes')}: {result.functionCount} · {t('已恢复', 'Recovered')}: {result.functions.length}{ '\n' }{t('导入符号', 'Imports')}: {result.imports.length} · {t('字符串', 'Strings')}: {result.strings.length}</Text>
        {result.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, marginTop: 9, lineHeight: 22 }}>• {item}</Text>)}
        <View style={{ gap: 10, marginTop: 15 }}><Action title={t('AI 审查反编译证据', 'AI review of decompiled evidence')} disabled={!!busy} onPress={() => { void prepareAi(); }} /><Action secondary title={t('分享报告', 'Share report')} disabled={!!busy} onPress={() => { void share(); }} /></View>
      </Card>
      {result.functions.map((item, index) => <Card key={`${item.address}-${index}`}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === item.address }} onPress={() => setExpanded((current) => current === item.address ? null : item.address)}>
          <Text style={{ color: palette.ink, fontWeight: '800', lineHeight: 23 }}>{item.name}</Text><Text selectable style={{ color: palette.muted, marginTop: 5 }}>{item.address}</Text>
          <Text style={{ color: palette.blue, marginTop: 10 }}>{expanded === item.address ? t('收起代码', 'Collapse code') : t('查看恢复代码', 'View recovered code')}</Text>
        </Pressable>
        {expanded === item.address && <ScrollView horizontal style={{ marginTop: 12, backgroundColor: '#f3f6fb', borderRadius: 8 }}><Text selectable style={{ fontFamily: 'monospace', color: palette.ink, padding: 12, fontSize: 12, lineHeight: 19 }}>{item.code}</Text></ScrollView>}
      </Card>)}
      <Card><Action secondary title={showEvidence ? t('收起导入与字符串', 'Hide imports and strings') : t('查看导入与字符串', 'View imports and strings')} onPress={() => setShowEvidence((value) => !value)} />
        {showEvidence && <><Text style={{ color: palette.ink, fontWeight: '800', marginTop: 15 }}>{t('导入符号', 'Imports')}</Text>{result.imports.map((item, index) => <Text selectable key={`i${index}`} style={{ color: palette.muted, marginTop: 7 }}>{item}</Text>)}<Text style={{ color: palette.ink, fontWeight: '800', marginTop: 15 }}>{t('字符串', 'Strings')}</Text>{result.strings.map((item, index) => <Text selectable key={`s${index}`} style={{ color: palette.muted, marginTop: 7 }}>{item}</Text>)}</>}
      </Card>
    </>}
    {aiResult?.analysisId === result?.id && aiResult && <Card><Text style={{ color: palette.ink, fontWeight: '800', fontSize: 18 }}>{t('AI 审查结果', 'AI review result')}</Text><Text style={{ color: palette.ink, marginTop: 12, lineHeight: 23 }}>{aiResult.summary}</Text>
      {aiResult.findings.map((item, index) => <View key={index} style={{ marginTop: 14 }}><Text style={{ color: item.severity === 'high' ? '#bf3947' : palette.ink, fontWeight: '800' }}>{item.severity}{item.address ? ` · ${item.address}` : ''}</Text><Text style={{ color: palette.ink, marginTop: 8, lineHeight: 22 }}>{item.description}</Text><Text style={{ color: palette.muted, marginTop: 7, lineHeight: 22 }}>{item.suggestion}</Text></View>)}
      {aiResult.limitations.map((item, index) => <Text key={index} style={{ color: palette.muted, marginTop: 10, lineHeight: 22 }}>• {item}</Text>)}
    </Card>}
  </Page></SafeAreaView>;
}
