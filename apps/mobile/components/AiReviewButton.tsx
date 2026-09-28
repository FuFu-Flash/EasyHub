import { Pressable, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export function AiReviewButton({ title, onPress, disabled, icon = true }: { title: string; onPress: () => void; disabled?: boolean; icon?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: '#fff', borderColor: '#dce4f1', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, opacity: disabled ? 0.55 : 1 }}>
    {icon && <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#587392" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <Path d="m19 17 .8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8L19 17ZM4 2l.6 1.4L6 4l-1.4.6L4 6l-.6-1.4L2 4l1.4-.6L4 2Z" />
    </Svg>}
    <Text style={{ color: '#263852', fontSize: 14, fontWeight: '700' }}>{title}</Text>
  </Pressable>;
}
