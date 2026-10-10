import { Text, View } from 'react-native';
import Markdown, { type MarkdownProps } from 'react-native-markdown-display';
import { usePreferences } from '@/features/preferences/provider';
import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { palette } from './elements';

export function TranslatableMarkdown({ text, isPublic, protectedNames = [], style }: {
  text: string; isPublic: boolean; protectedNames?: string[]; style?: MarkdownProps['style'];
}) {
  const { t } = usePreferences();
  const { value, busy } = useTranslatedContent(text, protectedNames, isPublic, 'markdown');
  return <View><Markdown style={style || { body: { color: palette.ink, fontSize: 14, lineHeight: 22 }, link: { color: palette.blue } }}>{value}</Markdown>
    {busy && <Text style={{ color: palette.muted, fontSize: 12, marginTop: 5 }}>{t('正在分段翻译…', 'Translating sections…')}</Text>}
  </View>;
}
