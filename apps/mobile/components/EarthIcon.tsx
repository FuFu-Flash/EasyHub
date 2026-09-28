import Svg, { Circle, Path } from 'react-native-svg';

// Same Lucide Globe2/Earth paths used by the Windows app (lucide-react 0.468.0).
export function EarthIcon({ size = 22, color = '#60718b' }: { size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" />
    <Path d="M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17" />
    <Path d="M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" />
    <Circle cx="12" cy="12" r="10" />
  </Svg>;
}
