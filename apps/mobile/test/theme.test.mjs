import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme, palette, parseThemePreference, resolveTheme, themed, themedStyles } from '../features/theme/theme.ts';
import { defaultPreferences, parsePreferences } from '../features/preferences/model.ts';

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('theme preference falls back to following the system and resolves against the system scheme', () => {
  assert.equal(parseThemePreference('dark'), 'dark');
  assert.equal(parseThemePreference('light'), 'light');
  for (const value of [undefined, null, 'auto', 3, {}]) assert.equal(parseThemePreference(value), 'system');
  assert.equal(resolveTheme('system', 'dark'), 'dark');
  assert.equal(resolveTheme('system', 'light'), 'light');
  assert.equal(resolveTheme('system', null), 'light');
  assert.equal(resolveTheme('light', 'dark'), 'light');
  assert.equal(resolveTheme('dark', 'light'), 'dark');
});

test('saved preferences keep the chosen theme and older files without one follow the system', () => {
  assert.equal(defaultPreferences.theme, 'system');
  assert.equal(parsePreferences(JSON.stringify({ language: 'en', theme: 'dark' })).theme, 'dark');
  assert.equal(parsePreferences(JSON.stringify({ language: 'en' })).theme, 'system');
  assert.equal(parsePreferences(JSON.stringify({ theme: 'sepia' })).theme, 'system');
});

test('applying a theme swaps the shared colours and leaves light colours untouched', () => {
  applyTheme('light');
  assert.equal(themed('#e7f0ff'), '#e7f0ff');
  assert.equal(palette.background, '#f5f8fd');
  applyTheme('dark');
  assert.notEqual(palette.background, '#f5f8fd');
  assert.notEqual(themed('#e7f0ff'), '#e7f0ff');
  assert.equal(themed('#ffffff22'), '#ffffff22');
  applyTheme('light');
  assert.equal(palette.ink, '#18263e');
});

test('dark colours keep text readable and cards above the page background', () => {
  applyTheme('dark');
  const page = palette.background, card = themed('#fff');
  assert.ok(luminance(card) > luminance(page), 'cards sit above the page');
  assert.ok(contrast(palette.ink, card) >= 7, 'main text on a card');
  assert.ok(contrast(palette.muted, card) >= 4.5, 'secondary text on a card');
  assert.ok(contrast(palette.blue, page) >= 4.5, 'links on the page');
  assert.ok(contrast(themed('#bf3947'), card) >= 4.5, 'error text on a card');
  assert.ok(contrast('#ffffff', palette.blue) >= 3, 'white text on a solid accent button');
  applyTheme('light');
});

test('themed style sheets are rebuilt after a theme change', () => {
  let builds = 0;
  const styles = themedStyles(() => { builds += 1; return { box: { backgroundColor: themed('#e7f0ff') } }; });
  applyTheme('light');
  assert.equal(styles.box.backgroundColor, '#e7f0ff');
  assert.equal(styles.box.backgroundColor, '#e7f0ff');
  assert.equal(builds, 1);
  applyTheme('dark');
  assert.notEqual(styles.box.backgroundColor, '#e7f0ff');
  assert.equal(builds, 2);
  applyTheme('light');
});
