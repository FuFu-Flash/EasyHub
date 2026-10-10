import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { BinaryAnalysisResult } from '@easyhub/types';
import { Action, palette } from './elements';
import { usePreferences } from '@/features/preferences/provider';
import { formatBytes } from '@/features/github/downloadProgress';

/** Evidence stays next to the changed PR file it describes. */
export function PullBinaryEvidence({ analysis, headSha }: { analysis: BinaryAnalysisResult; headSha: string }) {
  const { t } = usePreferences();
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  return <View style={{ marginTop: 14, gap: 10 }}>
    <Text style={{ color: palette.ink, fontWeight: '800' }}>{t('程序审查证据', 'Program review evidence')}</Text>
    <Text selectable style={{ color: palette.muted, lineHeight: 21 }}>{analysis.format} · {analysis.architecture} · {formatBytes(analysis.size)}{'\n'}PR head: {headSha.slice(0, 12)}</Text>
    <Text selectable style={{ color: palette.muted, fontSize: 12, lineHeight: 19 }}>SHA-256{'\n'}{analysis.sha256}</Text>
    <Text style={{ color: palette.ink, lineHeight: 22 }}>{analysis.summary}</Text>
    <Text style={{ color: palette.muted, lineHeight: 21 }}>{t('函数 / 类', 'Functions / classes')}: {analysis.functionCount} · {t('已恢复', 'Recovered')}: {analysis.functions.length}</Text>
    <Action secondary title={visible ? t('收起程序证据', 'Hide program evidence') : t('查看程序证据', 'View program evidence')} onPress={() => setVisible((value) => !value)} />
    {visible && <>
      {analysis.functions.map((item, index) => <View key={`${item.address}-${index}`} style={{ paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.border }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === index }} onPress={() => setExpanded((value) => value === index ? null : index)}>
          <Text style={{ color: palette.ink, fontWeight: '800', lineHeight: 22 }}>{item.name}</Text>
          <Text selectable style={{ color: palette.muted, marginTop: 5, lineHeight: 19 }}>{item.address}</Text>
          <Text style={{ color: palette.blue, marginTop: 8 }}>{expanded === index ? t('收起代码', 'Collapse code') : t('查看恢复代码', 'View recovered code')}</Text>
        </Pressable>
        {expanded === index && <ScrollView horizontal style={{ marginTop: 10, backgroundColor: '#f3f6fb', borderRadius: 8 }}><Text selectable style={{ color: palette.ink, fontFamily: 'monospace', fontSize: 12, lineHeight: 19, padding: 12 }}>{item.code}</Text></ScrollView>}
      </View>)}
      <Text style={{ color: palette.ink, fontWeight: '800', marginTop: 8 }}>{t('导入符号', 'Imports')}</Text>
      {analysis.imports.map((item, index) => <Text selectable key={`i-${index}`} style={{ color: palette.muted, lineHeight: 20 }}>{item}</Text>)}
      <Text style={{ color: palette.ink, fontWeight: '800' }}>{t('字符串', 'Strings')}</Text>
      {analysis.strings.map((item, index) => <Text selectable key={`s-${index}`} style={{ color: palette.muted, lineHeight: 20 }}>{item}</Text>)}
      {analysis.limitations.map((item, index) => <Text key={`l-${index}`} style={{ color: palette.muted, lineHeight: 20 }}>• {item}</Text>)}
    </>}
  </View>;
}
