import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { formatDate, formatDateTime } from '../features/localization/format.ts';

const timestamp = '2026-10-07T06:00:00.000Z';

test('project and discussion dates use the requested app language for dates and times', () => {
  const date = new Date(timestamp);
  assert.equal(formatDate(timestamp, 'zh'), date.toLocaleDateString('zh-CN'));
  assert.equal(formatDate(timestamp, 'en'), date.toLocaleDateString('en-US'));
  assert.equal(formatDateTime(timestamp, 'zh'), date.toLocaleString('zh-CN'));
  assert.equal(formatDateTime(timestamp, 'en'), date.toLocaleString('en-US'));
  assert.notEqual(formatDate(timestamp, 'zh'), formatDate(timestamp, 'en'));
});

test('invalid and missing timestamps produce a stable localized fallback', () => {
  for (const value of [undefined, null, '', '   ', 'a repository-authored timestamp', '2026-99-99']) {
    assert.equal(formatDate(value, 'zh'), '日期未知');
    assert.equal(formatDate(value, 'en'), 'Date unavailable');
    assert.equal(formatDateTime(value, 'zh'), '日期未知');
    assert.equal(formatDateTime(value, 'en'), 'Date unavailable');
  }
});

test('the formatter passes explicit locales and works without Intl constructors', context => {
  const dateTime = Object.getOwnPropertyDescriptor(Intl, 'DateTimeFormat');
  const plural = Object.getOwnPropertyDescriptor(Intl, 'PluralRules');
  const calls = [];
  try {
    Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value: undefined });
    Object.defineProperty(Intl, 'PluralRules', { configurable: true, value: undefined });
    context.mock.method(Date.prototype, 'toLocaleDateString', function (locale) { calls.push(['date', locale]); return locale; });
    context.mock.method(Date.prototype, 'toLocaleString', function (locale) { calls.push(['time', locale]); return locale; });
    assert.equal(formatDate(timestamp, 'en'), 'en-US');
    assert.equal(formatDate(timestamp, 'zh'), 'zh-CN');
    assert.equal(formatDateTime(timestamp, 'en'), 'en-US');
    assert.equal(formatDateTime(timestamp, 'zh'), 'zh-CN');
    assert.equal(formatDate('invalid', 'en'), 'Date unavailable');
    assert.deepEqual(calls, [['date', 'en-US'], ['date', 'zh-CN'], ['time', 'en-US'], ['time', 'zh-CN']]);
  } finally {
    context.mock.restoreAll();
    if (dateTime) Object.defineProperty(Intl, 'DateTimeFormat', dateTime);
    else delete Intl.DateTimeFormat;
    if (plural) Object.defineProperty(Intl, 'PluralRules', plural);
    else delete Intl.PluralRules;
  }
});

test('all project, release, issue, pull and history date call sites pass saved app language', () => {
  const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(path.join(mobile, 'package.json'));
  const ts = require('typescript');
  const files = [
    'components/SourceHistoryPanel.tsx',
    'src/app/project/[owner]/[repo]/index.tsx',
    'src/app/project/[owner]/[repo]/issue/[number].tsx',
    'src/app/project/[owner]/[repo]/pull/[number].tsx',
    'src/app/project/[owner]/[repo]/release/[id].tsx',
    'src/app/project/[owner]/[repo]/version/[sha].tsx',
  ];
  let checked = 0;
  for (const file of files) {
    const text = fs.readFileSync(path.join(mobile, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.match(text, /const \{ language \} = usePreferences\(\)/u, file);
    const visit = node => {
      if (ts.isCallExpression(node)) {
        const method = node.expression;
        if (ts.isPropertyAccessExpression(method) && /^toLocale(?:DateString|TimeString|String)$/u.test(method.name.text)
          && ts.isNewExpression(method.expression) && method.expression.expression.getText(source) === 'Date') {
          assert.fail(`${file}: date formatting must not use the system locale`);
        }
        if (ts.isIdentifier(method) && ['formatDate', 'formatDateTime'].includes(method.text)) {
          assert.equal(node.arguments[1]?.getText(source), 'language', file);
          checked += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.equal(checked, 8);
});
