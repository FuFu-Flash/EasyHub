import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(root, 'tokens.css'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
const definitions = new Map<string, string>(
  [...tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!]),
);

describe('desktop style contract', () => {
  it('has one rule entry and one token file, with no component override sheets', () => {
    expect(
      readdirSync(root, { recursive: true })
        .filter((file) => String(file).endsWith('.css'))
        .sort(),
    ).toEqual(['styles.css', 'tokens.css']);
    expect(styles.trimStart().startsWith("@import './tokens.css';")).toBe(true);
    expect(readFileSync(join(root, 'main.tsx'), 'utf8').match(/import ['"].*\.css['"]/g)).toEqual([
      "import './styles.css'",
    ]);
  });

  it('limits the palette to 32 colors and keeps raw colors in the token file', () => {
    const palette = [...definitions].filter(([key]) => key.startsWith('--eh-color-'));
    expect(palette.length).toBeLessThanOrEqual(32);
    expect(palette.length).toBeGreaterThan(0);
    expect(palette.every(([, value]) => /^#[\da-f]{6}$/i.test(value))).toBe(true);
    expect(styles).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
    // Alpha variants share the palette rather than introducing separate colors.
    expect(styles).toContain('color-mix(in srgb, var(--eh-color-');
  });

  it('uses the agreed type, weight, radius and spacing scales', () => {
    for (const [prefix, values, unit] of [
      ['text', [12, 13, 14, 16, 20, 24, 32], 'px'],
      ['weight', [400, 500, 600, 700], ''],
      ['radius', [4, 8, 12, 999], 'px'],
    ] as const) {
      expect([...definitions].filter(([key]) => key.startsWith(`--eh-${prefix}-`))).toEqual(
        values.map((value) => [`--eh-${prefix}-${value}`, `${value}${unit}`]),
      );
    }
    for (const match of styles.matchAll(/(?:^|[;{\s])(font-size|font-weight|border-radius):\s*([^;}]+)/g)) {
      const prefix = (
        { 'font-size': 'text', 'font-weight': 'weight', 'border-radius': 'radius' } as Record<string, string>
      )[match[1]!];
      // Zero intentionally hides the label in the icon-only narrow sidebar.
      expect(match[2]!.replace(/\s*!important$/, '').trim(), match[0]).toMatch(
        new RegExp(`^(?:0|inherit|var\\(--eh-${prefix}-\\d+\\))$`),
      );
    }
    expect(styles).toContain('var(--eh-space-16)');
    expect(styles).toContain('var(--eh-shadow-card)');
  });

  it('resolves every variable and has only three viewport width boundaries', () => {
    const defined = new Set([...definitions.keys(), ...[...styles.matchAll(/(--[\w-]+):/g)].map((match) => match[1])]);
    for (const match of (styles + tokens).matchAll(/var\((--[\w-]+)/g))
      expect(defined.has(match[1]), match[1]).toBe(true);
    const media = [...styles.matchAll(/@media([^{}]*)\{/g)].map((match) => match[1]).join(' ');
    const widths = [...media.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)].map(
      (match) => Number(match[2]) - (match[1] === 'min' ? 1 : 0),
    );
    expect([...new Set(widths)].sort((a, b) => a - b)).toEqual([700, 850, 1180]);
    expect(styles).toContain('(prefers-reduced-motion: reduce)');
    expect(styles).toContain('.live-shell .issue-project-group.live-issue-group');
    expect(styles.replace(/\s/g, '')).toContain('cursor:text!important');
  });
});

describe('text contrast', () => {
  const themes = {
    light: tokens.slice(0, tokens.indexOf("[data-theme='dark']")),
    dark: tokens.slice(tokens.indexOf("[data-theme='dark']")),
  };
  const palette = (block: string) =>
    new Map([...block.matchAll(/--eh-color-([\w-]+):\s*(#[\da-f]{6});/gi)].map((match) => [match[1]!, match[2]!]));
  const channels = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const luminance = (hex: string) => {
    const [red, green, blue] = channels(hex).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  };
  const ratio = (first: string, second: string) => {
    const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (high! + 0.05) / (low! + 0.05);
  };
  // Hover fills are written as color-mix(fill 86%, scrim) in styles.css.
  const mix = (base: string, other: string, share: number) =>
    '#' +
    channels(base)
      .map((value, index) => Math.round(value * share + channels(other)[index]! * (1 - share)))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');

  it.each(Object.entries(themes))('keeps every text color readable in the %s theme', (_theme, block) => {
    const color = palette(block);
    const get = (name: string) => {
      const value = color.get(name);
      expect(value, name).toBeDefined();
      return value!;
    };
    const pairs: Array<[string, string, string]> = [];
    for (const text of ['ink', 'ink-soft', 'muted', 'faint', 'primary', 'danger', 'success', 'warning', 'accent'])
      for (const background of ['surface', 'surface-subtle', 'surface-bg'])
        pairs.push([text, background, get(background)]);
    for (const state of ['primary', 'danger', 'success', 'warning', 'accent'])
      pairs.push([state, `${state}-soft`, get(`${state}-soft`)]);
    for (const fill of ['primary-fill', 'danger-fill']) {
      pairs.push(['on-primary', fill, get(fill)]);
      pairs.push(['on-primary', `${fill} hover`, mix(get(fill), get('scrim'), 0.86)]);
    }
    const failing = pairs
      .map(([text, background, value]) => ({ pair: `${text} on ${background}`, ratio: ratio(get(text), value) }))
      .filter((item) => item.ratio < 4.5);
    expect(failing).toEqual([]);
  });

  it('uses the fill colors behind white button text', () => {
    expect(styles).toMatch(/\.button-primary \{[^}]*background: var\(--eh-color-primary-fill\)/);
    expect(styles).toMatch(/\.danger-confirm \{[^}]*background: var\(--eh-color-danger-fill\)/);
  });
});
