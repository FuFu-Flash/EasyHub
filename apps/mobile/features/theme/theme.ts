export type ThemePreference = "system" | "light" | "dark";
export type Theme = Exclude<ThemePreference, "system">;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemScheme: string | null | undefined): Theme {
  return preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
}

/** The desktop's shared palette (tokens.css), light and dark values under the same names. */
export const lightTokens = {
  primary: "#2369de",
  primaryHover: "#1756bf",
  primarySoft: "#eaf3ff",
  ink: "#1d1d1b",
  inkSoft: "#3d3d39",
  muted: "#62625d",
  faint: "#8a8a84",
  surface: "#ffffff",
  surfaceSubtle: "#fafaf8",
  surfaceBg: "#f6f6f4",
  surfaceSunken: "#ececea",
  line: "#e3e3df",
  lineStrong: "#d4d4cf",
  linePrimary: "#90b8ff",
  danger: "#c53347",
  dangerSoft: "#fff0f1",
  dangerLine: "#f3c6c9",
  success: "#208a4d",
  successSoft: "#eaf8ef",
  successLine: "#b8eaca",
  warning: "#8f4a00",
  warningSoft: "#fdf3e3",
  warningLine: "#efd9b4",
  accent: "#7655e8",
  accentSoft: "#f0e8ff",
  onPrimary: "#ffffff",
  heroGlow: "#3b82d9",
  leaf: "#72c546",
  amber: "#dc8a13",
  scrim: "#1d2420",
};
export type ColorToken = keyof typeof lightTokens;
export const darkTokens: Record<ColorToken, string> = {
  primary: "#3f84ee",
  primaryHover: "#5a97f2",
  primarySoft: "#1b2a42",
  ink: "#ecece9",
  inkSoft: "#d6d6d1",
  muted: "#a5a59f",
  faint: "#7e7e78",
  surface: "#1e1e1c",
  surfaceSubtle: "#242422",
  surfaceBg: "#161615",
  surfaceSunken: "#2c2c2a",
  line: "#31312f",
  lineStrong: "#43433f",
  linePrimary: "#3a64a8",
  danger: "#e5534b",
  dangerSoft: "#3a1c1c",
  dangerLine: "#6e2c2a",
  success: "#4cc27a",
  successSoft: "#15301f",
  successLine: "#2a5e3d",
  warning: "#e3a34f",
  warningSoft: "#33260f",
  warningLine: "#5f4620",
  accent: "#a28bff",
  accentSoft: "#2a2142",
  onPrimary: "#ffffff",
  heroGlow: "#6aa3f5",
  leaf: "#72c546",
  amber: "#e8a33a",
  scrim: "#000000",
};
const tokensFor = (theme: Theme): Record<ColorToken, string> => (theme === "dark" ? darkTokens : lightTokens);
const paletteFor = (theme: Theme) => {
  const t = tokensFor(theme);
  return { ink: t.ink, muted: t.muted, blue: t.primary, border: t.line, green: t.success, background: t.surfaceBg };
};

/** Colours every screen reads while rendering; the root layout swaps them and remounts the screens when the theme changes. */
export const palette = paletteFor("light");

/** Text and icons that sit on a solid accent colour stay white in both themes. */
export const onAccent = lightTokens.onPrimary;

function toHsl(hex: string): [number, number, number] {
  const n =
    hex.length === 4
      ? [...hex.slice(1)].map((c) => parseInt(c + c, 16))
      : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b] = n.map((v) => v / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2,
    d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const pageBackgrounds = new Set(["#f5f8fd", "#f5f8fe"]);
// Fills that read as code blocks or quiet wells, and hairlines that would vanish if treated as subtle surfaces.
const fixedTokens: Record<string, ColorToken> = {
  "#f1f4f9": "surfaceSunken",
  "#f3f6fb": "surfaceSunken",
  "#edf2f8": "line",
};
const tokenCache = new Map<string, ColorToken>();
/** Names the palette colour a light-theme hex plays: surface, line, text level, or a state colour. */
export function tokenFor(hex: string): ColorToken {
  const key = hex.toLowerCase();
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const [h, s, l] = toHsl(key);
  let token: ColorToken;
  if (key === "#fff" || key === "#ffffff") token = "surface";
  else if (fixedTokens[key]) token = fixedTokens[key];
  else if (pageBackgrounds.has(key)) token = "surfaceBg";
  else if (s >= 0.3 && (h < 15 || h >= 335)) token = l >= 0.95 ? "dangerSoft" : l >= 0.8 ? "dangerLine" : "danger";
  else if (s >= 0.3 && h >= 15 && h < 65) token = l >= 0.9 ? "warningSoft" : l >= 0.8 ? "warningLine" : "warning";
  else if (s >= 0.3 && h >= 90 && h < 175) token = l >= 0.9 ? "successSoft" : l >= 0.75 ? "successLine" : "success";
  else if (s >= 0.3 && h >= 255 && h < 335) token = "accent";
  else if (l >= 0.98) token = "surfaceSubtle";
  else if (s >= 0.8 && h >= 175 && h < 255 && l >= 0.9) token = "primarySoft";
  else if (l >= 0.95) token = "surfaceSubtle";
  else if (l >= 0.9) token = "line";
  else if (s >= 0.5 && h >= 175 && h < 255 && l >= 0.7) token = "linePrimary";
  else if (s >= 0.5 && h >= 175 && h < 255 && l >= 0.45) token = "primary";
  else if (s >= 0.5 && h >= 175 && h < 255 && l >= 0.3) token = "primaryHover";
  else if (l >= 0.95) token = "surfaceSubtle";
  else if (l >= 0.9) token = "line";
  else if (l >= 0.8) token = "lineStrong";
  else if (l < 0.2) token = "ink";
  else if (l < 0.43) token = "inkSoft";
  else if (l < 0.58) token = "muted";
  else token = "faint";
  tokenCache.set(key, token);
  return token;
}

/** Resolves a light-theme hex to the palette colour for the given theme; alpha colours are left alone. */
export function resolveColor(hex: string, theme: Theme): string {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.test(hex) ? tokensFor(theme)[tokenFor(hex)] : hex;
}
export const darkColor = (hex: string): string => resolveColor(hex, "dark");

let current: Theme = "light";
export function currentTheme(): Theme {
  return current;
}

export function applyTheme(theme: Theme): void {
  current = theme;
  Object.assign(palette, paletteFor(theme));
}

/** Backdrop behind dialogs and panels, drawn from the palette's scrim colour. */
export function scrim(): string {
  return `${tokensFor(current).scrim}75`;
}

/** Wraps a legacy light-theme hex so it becomes the matching palette colour of the active theme. */
export function themed(hex: string): string {
  return resolveColor(hex, current);
}

/** Builds a style sheet once per theme; the sheet is looked up on each access so a theme switch is picked up on the next render. */
export function themedStyles<T extends object>(factory: () => T): T {
  let built: T | undefined;
  let builtFor: Theme | undefined;
  return new Proxy({} as T, {
    get(_target, key) {
      if (!built || builtFor !== current) {
        built = factory();
        builtFor = current;
      }
      return built[key as keyof T];
    },
  });
}
