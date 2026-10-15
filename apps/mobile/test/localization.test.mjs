import test from 'node:test';
import assert from 'node:assert/strict';
import { zh } from '../features/localization/locales/zh.ts';
import { en } from '../features/localization/locales/en.ts';
import { getTranslator } from '../features/localization/index.ts';
import { InterfaceError, localizeError } from '../features/localization/error.ts';
import { friendlyGitHubError } from '../features/localization/githubError.ts';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { migrateSource, migrateHooks, migrateLanguageBranches, migrateOwnedErrors, migrateUiErrorRendering } from '../../../scripts/migrate-mobile-localization.mjs';

const slots = (message) => [...new Set([...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu)].map((match) => match[1]))].sort();

test('Chinese and English interface catalogs contain exactly matching keys and interpolation parameters', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const [key, message] of Object.entries(en)) {
    const expected = slots(zh[key]);
    if (typeof message === 'string') assert.deepEqual(slots(message), expected, key);
    else {
      assert.ok(expected.includes(message.count), `${key}: plural count must be a parameter`);
      assert.deepEqual(slots(message.one), expected, `${key}: one`);
      assert.deepEqual(slots(message.other), expected, `${key}: other`);
    }
  }
});

test('Android catalogs use the shared pull request, history and interface-language terminology', () => {
  for (const [key, chinese] of Object.entries(zh)) {
    assert.doesNotMatch(chinese, /代码提交审查|改进请求|历史版本|版本历史|下载修改记录|复制主要版本|默认版本/u, key);
    const english = en[key];
    for (const text of typeof english === 'string' ? [english] : [english.one, english.other]) {
      assert.doesNotMatch(text, /\bchange requests?\b/iu, key);
    }
    if (chinese === '修改记录') assert.equal(english, 'Change history', key);
    if (chinese === '界面语言') assert.equal(english, 'Interface language', key);
  }
});

test('English counts use complete singular and plural messages', () => {
  const t = getTranslator('en');
  assert.equal(t('common.fileCount', { count: 1 }), '1 file');
  assert.equal(t('common.fileCount', { count: 0 }), '0 files');
  assert.equal(t('common.fileCount', { count: 2 }), '2 files');
  assert.equal(t('common.fileCount', { count: -1 }), '-1 file');
  assert.equal(t('common.fileCount', { count: 1.0 }), '1 file');
  assert.equal(t('common.fileCount', { count: 1.1 }), '1.1 files');
  assert.equal(t('common.commentCount', { count: 1 }), '1 comment');
  assert.equal(getTranslator('zh')('common.fileCount', { count: 1 }), '1 个文件');
});

test('Android translators work when Hermes has no Intl.PluralRules', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, 'PluralRules');
  try {
    Object.defineProperty(Intl, 'PluralRules', { configurable: true, value: undefined });
    assert.equal(getTranslator('en')('common.reload'), 'Reload');
    assert.equal(getTranslator('en')('common.fileCount', { count: 1 }), '1 file');
    assert.equal(getTranslator('en')('common.fileCount', { count: -1 }), '-1 file');
    assert.equal(getTranslator('en')('common.fileCount', { count: 0 }), '0 files');
    assert.equal(getTranslator('en')('common.fileCount', { count: 2 }), '2 files');
    assert.equal(getTranslator('zh')('common.fileCount', { count: 1 }), '1 个文件');
    assert.equal(getTranslator('zh')('common.fileCount', { count: 2 }), '2 个文件');
  } finally {
    if (descriptor) Object.defineProperty(Intl, 'PluralRules', descriptor);
    else delete Intl.PluralRules;
  }
});

test('parameters are inserted once without interpreting authored braces or catalog-like strings', () => {
  const authored = '{total} common.reload <script>路径/代码</script>';
  assert.equal(getTranslator('en')('common.itemOfTotal', { current: authored, total: 2 }), `Item ${authored} of 2`);
  assert.equal(getTranslator('zh')('common.itemOfTotal', { current: authored, total: 2 }), `第 ${authored} 项，共 2 项`);
});

test('language-specific translators do not share a translated-label cache', () => {
  const chinese = getTranslator('zh');
  const english = getTranslator('en');
  assert.equal(chinese('common.reload'), '重新读取');
  assert.equal(english('common.reload'), 'Reload');
  assert.equal(chinese('common.reload'), '重新读取');
  assert.throws(() => english('a repository-authored title'), /Unknown interface message/);
});

test('typed failures are localized by stable identity while remote errors are never message keys', () => {
  const failure = new InterfaceError('common.fileCount', { count: 2 });
  assert.equal(failure.message, '2 个文件');
  assert.equal(localizeError(failure, getTranslator('en'), 'Fallback'), '2 files');
  assert.equal(localizeError(failure, getTranslator('zh'), 'Fallback'), '2 个文件');
  const remote = new Error('common.reload {count} 用户原文');
  assert.equal(localizeError(remote, getTranslator('en'), 'Fallback'), remote.message);
  assert.equal(localizeError(null, getTranslator('en'), 'Fallback'), 'Fallback');
  const legacy = new InterfaceError('common.reload').withDiagnostic('重新读取 / Reload');
  assert.equal(legacy.message, '重新读取 / Reload');
  assert.equal(localizeError(legacy, getTranslator('en'), 'Fallback'), 'Reload');
});

test('GitHub failure presentation uses status identity in the current interface language', () => {
  const error = Object.assign(new Error('a repository-authored title {count}'), { status: 403 });
  assert.equal(friendlyGitHubError(error, getTranslator('en')), 'GitHub declined the action. Try again later or check authorization scopes.');
  assert.equal(friendlyGitHubError(error, getTranslator('zh')), 'GitHub 暂时拒绝了操作，请稍后再试，或检查授权范围。');
  assert.equal(friendlyGitHubError(Object.assign(new Error('opaque'), { name: 'AbortError' }), getTranslator('en')), 'Action canceled.');
});

test('Android interface messages use existing catalog keys and translated text attributes', () => {
  const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(path.join(mobile, 'package.json'));
  const ts = require('typescript');
  const files = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'localization', 'test', 'modules'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (/\.(?:ts|tsx)$/u.test(file) && !['uiTestFixtures.ts', 'programReviewRuntime.ts'].includes(entry.name)) files.push(file);
    }
  };
  for (const directory of ['components', 'src', 'features']) collect(path.join(mobile, directory));
  let checked = 0;
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        assert.ok(!node.arguments.some((argument) => ts.isSpreadElement(argument)), `${file}: spread translation pair`);
        const key = node.arguments[0];
        if (ts.isStringLiteral(key)) {
          assert.ok(Object.hasOwn(zh, key.text), `${file}: unknown message ${key.text}`);
          checked++;
        }
        if (node.arguments.length > 1) assert.ok(!ts.isStringLiteral(node.arguments[1]) && !ts.isTemplateExpression(node.arguments[1]), `${file}: legacy translation pair`);
      }
      if (ts.isJsxAttribute(node) && ['title', 'placeholder', 'accessibilityLabel', 'accessibilityHint'].includes(node.name.getText(source))
        && node.initializer && ts.isStringLiteral(node.initializer)) {
        assert.doesNotMatch(node.initializer.text, /[\u3400-\u9fff]/u, `${file}: untranslated UI attribute`);
      }
      if (ts.isJsxText(node)) assert.doesNotMatch(node.text, /[\u3400-\u9fff]/u, `${file}: untranslated UI text`);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.ok(checked > 800, 'the audit must cover the complete Android interface');
});

test('AST migration preserves interpolation expressions, reordered slots and literal escapes', () => {
  const result = migrateSource('const label = t(`已下载 ${bytes} / ${total}：${name}`, `File ${name}: ${bytes} / ${total} downloaded`); const authored = "问题 ${name}";', 'download.tsx');
  assert.equal(result.skipped.length, 0);
  assert.match(result.output, /\{ p0: bytes, p1: total, p2: name \}/u);
  assert.equal(Object.values(result.catalog.zh)[0], '已下载 {p0} / {p1}：{p2}');
  assert.equal(Object.values(result.catalog.en)[0], 'File {p2}: {p0} / {p1} downloaded');
  assert.match(result.output, /const authored = "问题 \$\{name\}"/u);
  const escaped = migrateSource('const label = t("第一行\\n第二行", "First line\\nSecond line");', 'message.ts');
  assert.equal(Object.values(escaped.catalog.zh)[0], '第一行\n第二行');
});

test('AST migration handles nested UI calls without interpreting dynamic authored values as keys', () => {
  const result = migrateSource('const label = t(`结果：${t("成功", "Success")} ${title}`, `Result: ${t("成功", "Success")} ${title}`); const body = t(repository.title, repository.description);', 'message.tsx');
  assert.equal(result.calls, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'nonliteral pair');
  assert.match(result.output, /p0: t\("message.success"\), p1: title/u);
  assert.match(result.output, /t\(repository.title, repository.description\)/u);
  const mismatch = migrateSource('const label = t(`共 ${chineseCount} 个`, `${englishCount} items`);', 'message.ts');
  assert.equal(mismatch.calls, 0);
  assert.equal(mismatch.skipped[0].reason, 'different interpolation expressions');
  const whitespace = migrateSource('const label = t(`内容 ${"two  spaces"}`, `Content ${"two spaces"}`);', 'message.ts');
  assert.equal(whitespace.calls, 0);
  assert.equal(whitespace.skipped[0].reason, 'different interpolation expressions');
});

test('AST migration produces deterministic keys and complete English count forms', () => {
  const source = 'const countLabel = t(`共 ${count} 个文件`, `${count} files`); const other = t("修改记录", "Change history");';
  const first = migrateSource(source, 'message.tsx');
  const second = migrateSource(source, 'message.tsx');
  assert.deepEqual(first, second);
  assert.deepEqual(Object.values(first.catalog.en)[0], { count: 'p0', one: '{p0} file', other: '{p0} files' });
});

test('hook migration follows the render language and retains non-translation preferences', () => {
  const result = migrateHooks("import { usePreferences } from '@/features/preferences/provider';\nfunction Screen() { const { language, t } = usePreferences(); return t('key'); }\nfunction Label() { const { t } = usePreferences(); return t('key'); }", 'screen.tsx');
  assert.equal(result.hooks, 2);
  assert.match(result.output, /const \{ language \} = usePreferences\(\);\n  const t = useTranslation\(\);/u);
  assert.match(result.output, /function Label\(\) \{ const t = useTranslation\(\);/u);
  assert.match(result.output, /import \{ usePreferences \}/u);
  assert.match(result.output, /import \{ useTranslation \}/u);
  const label = migrateHooks("import { usePreferences } from '@/features/preferences/provider';\nfunction Label() { const { t } = usePreferences(); return t('key'); }", 'label.tsx');
  assert.doesNotMatch(label.output, /usePreferences/u);
});

test('explicit helper-language branches use the caller language while prompt configuration stays opaque', () => {
  const catalog = { zh: {}, en: {} };
  const result = migrateLanguageBranches('function message(language) { const en = language === "en"; return en ? `${name} cannot be read.` : `无法读取 ${name}。`; } const prompt = `Write in ${language === "en" ? "English" : "Simplified Chinese"}`;', '/app/features/helper.ts', catalog);
  assert.equal(result.calls, 1);
  assert.match(result.output, /getTranslator\(language\)\("helper.cannotBeRead", \{ p0: name \}\)/u);
  assert.match(result.output, /"English" : "Simplified Chinese"/u);
  assert.equal(Object.values(catalog.zh)[0], '无法读取 {p0}。');
});

test('owned error migration retains diagnostics and never turns dynamic failures into catalog keys', () => {
  const catalog = { zh: {}, en: {} };
  const result = migrateOwnedErrors('throw new Error("下载地址无效。"); const remote = new Error(server.message); throw new Error("文件名称无效。 / Invalid file name.");', '/app/features/helper.ts', catalog);
  assert.equal(result.errors, 2);
  assert.equal(result.skipped.length, 0);
  assert.match(result.output, /new InterfaceError\("helper.theDownloadAddressIsInvalid"\)\.withDiagnostic\("下载地址无效。"\)/u);
  assert.match(result.output, /new Error\(server.message\)/u);
  assert.match(result.output, /withDiagnostic\("文件名称无效。 \/ Invalid file name\."\)/u);
  const display = migrateUiErrorRendering('setError(cause instanceof Error ? cause.message : t("fallback"));', '/app/screen.tsx');
  assert.match(display.output, /localizeError\(cause, t, t\("fallback"\)\)/u);
});
