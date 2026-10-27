import { useTranslation } from '@/features/localization/react';
import { Text, View } from 'react-native';
import Markdown, { type MarkdownProps } from 'react-native-markdown-display';

import { useTranslatedContent } from '@/features/translation/useTranslatedContent';
import { palette } from './elements';
import { markdownStyle } from './markdownStyle';

export function TranslatableMarkdown({ text, isPublic, protectedNames = [], style }: {
  text: string; isPublic: boolean; protectedNames?: string[]; style?: MarkdownProps['style'];
}) {
  const t = useTranslation();
  const { value, busy } = useTranslatedContent(text, protectedNames, isPublic, 'markdown');
  return <View><Markdown style={style || markdownStyle()}>{value}</Markdown>
    {busy && <Text style={{ color: palette.muted, fontSize: 12, marginTop: 5 }}>{t("TranslatableMarkdown.translatingSections")}</Text>}
  </View>;
}
