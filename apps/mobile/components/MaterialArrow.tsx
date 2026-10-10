import { I18nManager, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { materialArrowPaths, type MaterialArrowName } from './materialArrowPaths';

export type { MaterialArrowName } from './materialArrowPaths';

/** Decorative Google Material Symbols; the containing control supplies its label. */
export function MaterialArrow({ name, size = 24, color = '#77869d' }: { name: MaterialArrowName; size?: number; color?: string }) {
  const mirror = I18nManager.isRTL && (name === 'back' || name === 'forward' || name === 'chevron');
  return <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size, flexShrink: 0, transform: mirror ? [{ scaleX: -1 }] : undefined }}>
    <Svg width={size} height={size} viewBox="0 -960 960 960" accessible={false}>
      <Path d={materialArrowPaths[name]} fill={color} />
    </Svg>
  </View>;
}
