export type ThemePreference = 'system' | 'light' | 'dark';
export type Theme = Exclude<ThemePreference, 'system'>;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemScheme: string | null | undefined): Theme {
  return preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
}

/** Colours every screen reads while rendering; the root layout swaps them and remounts the screens when the theme changes. */
export const palette = { ink: '#18263e', muted: '#77869d', blue: '#2477ed', border: '#e3eaf4', green: '#1da86a', background: '#f5f8fd' };
const darkPalette = { ink: '#e6edf7', muted: '#9aaac0', blue: '#4a8df5', border: '#2a3a4e', green: '#3ec88a', background: '#0d141d' };
const lightPalette = { ...palette };

/** Text and icons that sit on a solid accent colour stay white in both themes. */
export const onAccent = '#ffffff';

// The light-theme screens use many one-off hex values; these hand-tuned pairs keep the main layers distinct in dark mode.
const darkOverrides: Record<string, string> = {
  '#fff': '#162131', '#ffffff': '#162131',
  '#f5f8fd': '#0d141d', '#f5f8fe': '#0d141d',
  '#f3f6fb': '#1b2838', '#f7faff': '#1b2838', '#f6f8fc': '#1b2838', '#f8fbff': '#1b2838', '#f0f6ff': '#1b2838',
  '#e3eaf4': '#2a3a4e', '#e3ecf8': '#2a3a4e', '#e2eaf5': '#2a3a4e', '#e7edf6': '#2a3a4e', '#edf2f8': '#223246',
  '#18263e': '#e6edf7', '#172238': '#e6edf7', '#18314d': '#e6edf7',
  '#77869d': '#9aaac0', '#2477ed': '#4a8df5', '#2674e7': '#3b7ff0', '#166ee7': '#3b7ff0', '#2578e8': '#5b9bff', '#2676e8': '#5b9bff',
  '#bf3947': '#ff8a96', '#1da86a': '#3ec88a',
};

function toHsl(hex: string): [number, number, number] {
  const n = hex.length === 4 ? [...hex.slice(1)].map((c) => parseInt(c + c, 16)) : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b] = n.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (k: number) => Math.round(255 * (l - a * Math.max(-1, Math.min((k + h / 30) % 12 - 3, 9 - (k + h / 30) % 12, 1))));
  return `#${[channel(0), channel(8), channel(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const generated = new Map<string, string>();
/** Dark counterpart of a light-theme hex: pale tints become deep tints, dark text becomes light, mid tones brighten. */
export function darkColor(hex: string): string {
  const key = hex.toLowerCase();
  const fixed = darkOverrides[key];
  if (fixed) return fixed;
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/u.test(key)) return hex;
  const cached = generated.get(key);
  if (cached) return cached;
  const [h, s, l] = toHsl(key);
  const result = l >= 0.9 ? fromHsl(h, Math.min(s, 0.4), 0.18)
    : l >= 0.78 ? fromHsl(h, Math.min(s, 0.4), 0.24)
      : l > 0.36 ? fromHsl(h, Math.min(s, 0.85), Math.min(0.78, l + 0.14))
        : fromHsl(h, Math.min(s, 0.3), Math.min(0.92, 1 - l * 0.8));
  generated.set(key, result);
  return result;
}

let current: Theme = 'light';
export function currentTheme(): Theme { return current; }

export function applyTheme(theme: Theme): void {
  current = theme;
  Object.assign(palette, theme === 'dark' ? darkPalette : lightPalette);
}

/** Wraps a light-theme hex so it follows the active theme; alpha colours are left alone. */
export function themed(hex: string): string {
  return current === 'dark' ? darkColor(hex) : hex;
}

/** Builds a style sheet once per theme; the sheet is looked up on each access so a theme switch is picked up on the next render. */
export function themedStyles<T extends object>(factory: () => T): T {
  let built: T | undefined;
  let builtFor: Theme | undefined;
  return new Proxy({} as T, {
    get(_target, key) {
      if (!built || builtFor !== current) { built = factory(); builtFor = current; }
      return built[key as keyof T];
    },
  });
}
