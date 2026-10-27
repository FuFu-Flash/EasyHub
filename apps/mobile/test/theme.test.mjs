import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTheme, darkTokens, lightTokens, palette, tokenFor, parseThemePreference, resolveTheme, themed, themedStyles } from '../features/theme/theme.ts';
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

test('applying a theme swaps the shared colours to the desktop palette', () => {
  applyTheme('light');
  assert.deepEqual({ ...palette }, { ink: '#1d1d1b', muted: '#62625d', blue: '#2369de', border: '#e3e3df', green: '#208a4d', background: '#f6f6f4' });
  assert.equal(themed('#fff'), '#ffffff');
  assert.equal(themed('#ffffff22'), '#ffffff22');
  applyTheme('dark');
  assert.deepEqual({ ...palette }, { ink: '#ecece9', muted: '#a5a59f', blue: '#3f84ee', border: '#31312f', green: '#4cc27a', background: '#161615' });
  assert.equal(themed('#fff'), '#1e1e1c');
  assert.equal(themed('#ffffff22'), '#ffffff22');
  applyTheme('light');
});

test('the dark palette keeps every name the light palette has, with the desktop values', () => {
  assert.deepEqual(Object.keys(darkTokens), Object.keys(lightTokens));
  assert.equal(Object.keys(lightTokens).length, 30);
  for (const value of [...Object.values(lightTokens), ...Object.values(darkTokens)]) assert.match(value, /^#[0-9a-f]{6}$/u);
  assert.equal(darkTokens.surface, '#1e1e1c');
  assert.equal(darkTokens.danger, '#e5534b');
  assert.equal(lightTokens.primary, '#2369de');
});

test('legacy colours resolve to the palette role they played', () => {
  const roles = { '#fff': 'surface', '#f5f8fd': 'surfaceBg', '#e7f0ff': 'primarySoft', '#e3ecf8': 'line', '#c9d4e4': 'lineStrong', '#a8cbff': 'linePrimary',
    '#18263e': 'ink', '#52637c': 'inkSoft', '#60718b': 'muted', '#8797ac': 'faint', '#2477ed': 'primary', '#bf3947': 'danger', '#fff0f1': 'dangerSoft',
    '#e9b7bf': 'dangerLine', '#18b35e': 'success', '#e8f7ef': 'successSoft', '#996616': 'warning', '#f1f4f9': 'surfaceSunken' };
  for (const [hex, role] of Object.entries(roles)) assert.equal(tokenFor(hex), role, hex);
});

test('dark colours keep text readable and cards above the page background', () => {
  applyTheme('dark');
  const page = palette.background, card = themed('#fff');
  assert.ok(luminance(card) > luminance(page), 'cards sit above the page');
  assert.ok(contrast(palette.ink, card) >= 7, 'main text on a card');
  assert.ok(contrast(palette.muted, card) >= 4.5, 'secondary text on a card');
  assert.ok(contrast(themed('#8797ac'), card) >= 3, 'faint text on a card');
  assert.ok(contrast(palette.blue, page) >= 4.5, 'links on the page');
  assert.ok(contrast(themed('#bf3947'), card) >= 4.5, 'error text on a card');
  assert.ok(contrast('#ffffff', palette.blue) >= 3, 'white text on a solid accent button');
  applyTheme('light');
});

test('themed style sheets are rebuilt after a theme change', () => {
  let builds = 0;
  const styles = themedStyles(() => { builds += 1; return { box: { backgroundColor: themed('#e7f0ff') } }; });
  applyTheme('light');
  assert.equal(styles.box.backgroundColor, '#eaf3ff');
  assert.equal(styles.box.backgroundColor, '#eaf3ff');
  assert.equal(builds, 1);
  applyTheme('dark');
  assert.equal(styles.box.backgroundColor, '#1b2a42');
  assert.equal(builds, 2);
  applyTheme('light');
});
