import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(join(root, 'tokens.css'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
const definitions = new Map<string, string>([...tokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(match => [match[1]!, match[2]!]));

describe('desktop style contract', () => {
  it('has one rule entry and one token file, with no component override sheets', () => {
    expect(readdirSync(root, { recursive: true }).filter(file => String(file).endsWith('.css')).sort()).toEqual(['styles.css', 'tokens.css']);
    expect(styles.trimStart().startsWith("@import './tokens.css';")).toBe(true);
    expect(readFileSync(join(root, 'main.tsx'), 'utf8').match(/import ['"].*\.css['"]/g)).toEqual(["import './styles.css'"]);
  });

  it('limits the palette to 30 colors and keeps raw colors in the token file', () => {
    const palette = [...definitions].filter(([key]) => key.startsWith('--eh-color-'));
    expect(palette.length).toBeLessThanOrEqual(30);
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
      expect([...definitions].filter(([key]) => key.startsWith(`--eh-${prefix}-`))).toEqual(values.map(value => [`--eh-${prefix}-${value}`, `${value}${unit}`]));
    }
    for (const match of styles.matchAll(/(?:^|[;{\s])(font-size|font-weight|border-radius):\s*([^;}]+)/g)) {
      const prefix = ({ 'font-size': 'text', 'font-weight': 'weight', 'border-radius': 'radius' } as Record<string,string>)[match[1]!];
      // Zero intentionally hides the label in the icon-only narrow sidebar.
      expect(match[2]!.replace(/\s*!important$/, '').trim(), match[0]).toMatch(new RegExp(`^(?:0|inherit|var\\(--eh-${prefix}-\\d+\\))$`));
    }
    expect(styles).toContain('var(--eh-space-16)');
    expect(styles).toContain('var(--eh-shadow-card)');
  });

  it('resolves every variable and has only three viewport width boundaries', () => {
    const defined = new Set([...definitions.keys(), ...[...styles.matchAll(/(--[\w-]+):/g)].map(match => match[1])]);
    for (const match of (styles + tokens).matchAll(/var\((--[\w-]+)/g)) expect(defined.has(match[1]), match[1]).toBe(true);
    const media = [...styles.matchAll(/@media([^{}]*)\{/g)].map(match => match[1]).join(' ');
    const widths = [...media.matchAll(/\((max|min)-width:\s*(\d+)px\)/g)].map(match => Number(match[2]) - (match[1] === 'min' ? 1 : 0));
    expect([...new Set(widths)].sort((a,b) => a-b)).toEqual([700, 850, 1180]);
    expect(styles).toContain('(prefers-reduced-motion: reduce)');
    expect(styles).toContain('.live-shell .issue-project-group.live-issue-group');
    expect(styles.replace(/\s/g, '')).toContain('cursor:text!important');
  });
});
