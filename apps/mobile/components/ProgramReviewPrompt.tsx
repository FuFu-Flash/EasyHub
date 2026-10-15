import { useTranslation } from '@/features/localization/react';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { GitHubPullFile } from '@easyhub/github';
import { Action, Card, palette } from './elements';

import { analysisEngineStatus } from '@/features/analysis/native';
import { missingProgramReviewComponents } from '@/features/analysis/programReviewNotice';
import { useProgramReviewNotice } from '@/features/analysis/useProgramReviewNotice';

function engineStatus() { try { return analysisEngineStatus(); } catch { return null; } }

export function ProgramReviewPrompt({ files }: { files: GitHubPullFile[] }) {
  const t = useTranslation();
  const { noticesEnabled, setNoticesEnabled } = useProgramReviewNotice();
  const [status, setStatus] = useState(engineStatus);
  useFocusEffect(useCallback(() => { setStatus(engineStatus()); }, []));
  const missing = missingProgramReviewComponents(files, status?.components ?? []);
  if (!noticesEnabled || !missing.length) return null;
  return <Card>
    <Text style={{ color: palette.ink, fontWeight: '800', lineHeight: 23 }}>{t("ProgramReviewPrompt.thisPullRequestIncludesProgramFiles")}</Text>
    <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 8 }}>{t("ProgramReviewPrompt.installTheRequiredReviewComponentsToExtractEvidenceOnThisDevice")}</Text>
    <Text style={{ color: palette.muted, lineHeight: 22, marginTop: 8 }}>{missing.map((item) => item.id === 'java' ? 'Java / Dalvik · JADX' : 'radare2 / r2ghidra').join('\n')}</Text>
    <View style={{ gap: 10, marginTop: 14 }}>
      <Action title={t("ProgramReviewPrompt.installReviewComponents")} onPress={() => router.push({ pathname: '/(tabs)/settings', params: { programReview: '1' } })} />
      <Action secondary title={t("ProgramReviewPrompt.doNotShowComponentReminders")} onPress={() => setNoticesEnabled(false)} />
    </View>
  </Card>;
}
