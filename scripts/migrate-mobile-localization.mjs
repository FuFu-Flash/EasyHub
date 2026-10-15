/** One-time AST migration. Dry-run is the default; --write changes catalogs and explicit t(zh, en) calls. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/mobile/package.json'));
const ts = require('typescript');
const printer = ts.createPrinter({ removeComments: true });
const canonical = (node, source) => printer.printNode(ts.EmitHint.Expression, node, source).trim();

function normalizeChinese(value) {
  return value.replaceAll('改进请求', '合并请求').replaceAll('历史版本', '修改记录').replaceAll('版本历史', '修改记录');
}

function sentence(node, source, parameters) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  let result = node.head.text;
  for (const span of node.templateSpans) {
    const identity = canonical(span.expression, source);
    let index = parameters.findIndex((item) => item.identity === identity);
    if (index === -1) { index = parameters.length; parameters.push({ identity, expression: span.expression }); }
    result += `{p${index}}${span.literal.text}`;
  }
  return result;
}

function englishEntry(message) {
  // Only unambiguous count nouns become plurals automatically; other grammar needs editorial review.
  const nouns = { files: 'file', comments: 'comment', projects: 'project', items: 'item', findings: 'finding', reviews: 'review', days: 'day', changes: 'change', commits: 'commit', releases: 'release', versions: 'version' };
  const counts = [...message.matchAll(/\{(p\d+)\} (files|comments|projects|items|findings|reviews|days|changes|commits|releases|versions)\b/gu)];
  if (!counts.length || counts.some((match) => match[1] !== counts[0][1])) return message;
  const one = message.replace(/\{(p\d+)\} (files|comments|projects|items|findings|reviews|days|changes|commits|releases|versions)\b/gu,
    (_all, count, noun) => `{${count}} ${nouns[noun]}`);
  return { count: counts[0][1], one, other: message };
}

function namespace(file) {
  const clean = file.replace(/\\/gu, '/');
  if (clean.endsWith('/(tabs)/index.tsx')) return 'home';
  if (clean.endsWith('/project/[owner]/[repo]/index.tsx')) return 'project';
  return path.basename(file).replace(/\.(?:tsx?|mjs)$/u, '').replace(/[^A-Za-z0-9]+/gu, '') || 'mobile';
}

function keyFor(file, chinese, english, occupied) {
  const words = english.replace(/\{[^}]+\}/gu, '').match(/[A-Za-z0-9]+/gu)?.slice(0, 11) ?? [];
  const label = words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1) : word.toLowerCase()).join('') || 'message';
  const key = `${namespace(file)}.${label}`;
  return occupied.has(key) ? `${key}${createHash('sha256').update(JSON.stringify([chinese, english])).digest('hex').slice(0, 8)}` : key;
}

/** Rewrites only explicit UI translator calls; arbitrary strings and authored fields are not traversed as keys. */
export function migrateSource(text, file, catalog = { zh: {}, en: {} }) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const byPair = new Map(Object.entries(catalog.zh).map(([key, chinese]) => [JSON.stringify([chinese, typeof catalog.en[key] === 'string' ? catalog.en[key] : catalog.en[key].other]), key]));
  const occupied = new Set(Object.keys(catalog.zh));
  const edits = [];
  const skipped = [];
  let calls = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't'
      && node.arguments.some((argument) => ts.isSpreadElement(argument))) {
      skipped.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason: 'spread translation pair', source: node.getText(source) });
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments.length === 2) {
      const parameters = [];
      const rawChinese = sentence(node.arguments[0], source, parameters);
      const english = sentence(node.arguments[1], source, parameters);
      if (rawChinese !== null && english !== null) {
        const chinese = normalizeChinese(rawChinese);
        const leftSlots = [...chinese.matchAll(/\{(p\d+)\}/gu)].map((match) => match[1]).sort();
        const rightSlots = [...english.matchAll(/\{(p\d+)\}/gu)].map((match) => match[1]).sort();
        if (new Set(leftSlots).size !== new Set(rightSlots).size || [...new Set(leftSlots)].some((slot) => !rightSlots.includes(slot))) {
          skipped.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason: 'different interpolation expressions', source: node.getText(source) });
        } else {
          const pair = JSON.stringify([chinese, english]);
          const key = byPair.get(pair) ?? keyFor(file, chinese, english, occupied);
          catalog.zh[key] = chinese; catalog.en[key] = englishEntry(english);
          occupied.add(key); byPair.set(pair, key);
          // Nested translator calls in interpolation expressions are migrated recursively below.
          const params = parameters.map((item, index) => `p${index}: ${migrateExpression(item.expression)}`).join(', ');
          edits.push({ start: node.getStart(source), end: node.end, value: `t(${JSON.stringify(key)}${parameters.length ? `, { ${params} }` : ''})` });
          calls++;
          return;
        }
      } else if (!(ts.isStringLiteral(node.arguments[0]) && ts.isObjectLiteralExpression(node.arguments[1]))) {
        skipped.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason: 'nonliteral pair', source: node.getText(source) });
      }
    }
    ts.forEachChild(node, visit);
  };
  const migrateExpression = (node) => {
    const start = edits.length;
    visit(node);
    const nested = edits.splice(start).sort((a, b) => b.start - a.start);
    let value = node.getText(source);
    const offset = node.getStart(source);
    for (const edit of nested) value = value.slice(0, edit.start - offset) + edit.value + value.slice(edit.end - offset);
    return value;
  };
  visit(source);
  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  return { output, calls, skipped, catalog };
}

/** Separates translation reads from persisted preferences without changing other preference bindings. */
export function migrateHooks(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  let hooks = 0;
  let needsPreferences = false;
  const visit = (node) => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isObjectBindingPattern(declaration.name) || !declaration.initializer || !ts.isCallExpression(declaration.initializer)
          || !ts.isIdentifier(declaration.initializer.expression) || declaration.initializer.expression.text !== 'usePreferences') continue;
        const elements = declaration.name.elements;
        const translation = elements.find((element) => !element.propertyName && ts.isIdentifier(element.name) && element.name.text === 't');
        if (!translation) { needsPreferences = true; continue; }
        const remaining = elements.filter((element) => element !== translation);
        if (remaining.length) {
          needsPreferences = true;
          edits.push({ start: declaration.name.getStart(source), end: declaration.name.end, value: `{ ${remaining.map((element) => element.getText(source)).join(', ')} }` });
          edits.push({ start: node.end, end: node.end, value: '\n  const t = useTranslation();' });
        } else if (node.declarationList.declarations.length === 1) {
          edits.push({ start: node.getStart(source), end: node.end, value: 'const t = useTranslation();' });
        } else throw new Error(`${file}: split the combined preference declaration before migrating`);
        hooks++;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!hooks) return { output: text, hooks };
  if (!needsPreferences) {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings || !ts.isNamedImports(statement.importClause.namedBindings)) continue;
      const imports = statement.importClause.namedBindings.elements;
      if (!imports.some((item) => item.name.text === 'usePreferences')) continue;
      const remaining = imports.filter((item) => item.name.text !== 'usePreferences');
      if (remaining.length) edits.push({ start: statement.importClause.namedBindings.getStart(source), end: statement.importClause.namedBindings.end, value: `{ ${remaining.map((item) => item.getText(source)).join(', ')} }` });
      else edits.push({ start: statement.getStart(source), end: statement.end, value: '' });
    }
  }
  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  if (!/import\s*\{[^}]*\buseTranslation\b[^}]*\}\s*from\s*['"][^'"]*localization\/react/u.test(output)) {
    output = `import { useTranslation } from '@/features/localization/react';\n${output}`;
  }
  return { output, hooks };
}

function conditionalLanguage(condition, source) {
  if (ts.isBinaryExpression(condition) && condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    && ts.isStringLiteral(condition.right) && condition.right.text === 'en'
    && (ts.isIdentifier(condition.left) && condition.left.text === 'language'
      || ts.isPropertyAccessExpression(condition.left) && condition.left.name.text === 'language')) return condition.left.getText(source);
  // Several presentation helpers keep a local `en` boolean; resolve its declaration, never arbitrary data fields.
  if (ts.isIdentifier(condition) && condition.text === 'en') {
    for (let scope = condition.parent; scope; scope = scope.parent) {
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement) || statement.getStart(source) >= condition.getStart(source)) continue;
        const declaration = statement.declarationList.declarations.find((item) => ts.isIdentifier(item.name) && item.name.text === 'en');
        if (declaration?.initializer) return conditionalLanguage(declaration.initializer, source);
      }
    }
  }
  return null;
}

/** Collects explicit helper-language branches. It does not infer translations from arbitrary content. */
export function migrateLanguageBranches(text, file, catalog) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  let calls = 0;
  const visit = (node) => {
    if (ts.isConditionalExpression(node)) {
      const language = conditionalLanguage(node.condition, source);
      const parameters = [];
      const chinese = sentence(node.whenFalse, source, parameters);
      const english = sentence(node.whenTrue, source, parameters);
      if (language && chinese !== null && english !== null && /[\u3400-\u9fff]/u.test(chinese)) {
        const expression = `t(${node.whenFalse.getText(source)}, ${node.whenTrue.getText(source)})`;
        const result = migrateSource(expression, file, catalog);
        if (!result.skipped.length) {
          edits.push({ start: node.getStart(source), end: node.end, value: result.output.replace(/^t\(/u, `getTranslator(${language})(`) });
          calls += result.calls;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  if (calls && !/import\s*\{[^}]*\bgetTranslator\b[^}]*\}\s*from\s*['"][^'"]*localization(?:\/index)?(?:\.ts)?['"]/u.test(output)) {
    const isFeature = file.replace(/\\/gu, '/').includes('/features/');
    const importPath = isFeature ? path.relative(path.dirname(file), path.join(root, 'apps/mobile/features/localization/index.ts')).replace(/\\/gu, '/') : '@/features/localization';
    output = `import { getTranslator } from '${importPath.startsWith('.') || importPath.startsWith('@') ? importPath : `./${importPath}`}';\n${output}`;
  }
  return { output, calls };
}

const ownedErrorEnglish = {
  '请检查 AI 设置。': 'Check your AI settings.',
  '请选择服务商，并填写有效的模型名称和 API Key。': 'Choose a provider and enter a valid model name and API key.',
  'AI 返回的内容太长，请重试。': 'AI returned too much content. Please retry.',
  'AI 没有返回可用的审查结果，请重试或更换模型。': 'AI did not return a usable review. Retry or choose another model.',
  'AI 返回的审查内容不完整，请重试。': 'AI returned an incomplete review. Please retry.',
  'AI 返回的审查内容无法对应这次修改，请重试。': 'AI review findings do not match these changes. Please retry.',
  'AI 没有返回完整的审查结果，请重试。': 'AI did not return a complete review. Please retry.',
  '程序分析结果无效，请重新分析文件。': 'The program analysis result is invalid. Analyze the file again.',
  '程序函数证据无效，请重新分析文件。': 'The program function evidence is invalid. Analyze the file again.',
  '请选择有效的审查语言。': 'Choose a valid review language.',
  '请先确认要发送的程序证据和服务地址。': 'Confirm the program evidence and AI destination first.',
  'AI 服务没有返回内容，请检查模型名称。': 'The AI service returned no content. Check the model name.',
  'GitHub 登录暂时不可用，请稍后重试。': 'GitHub sign-in is unavailable. Please try again later.',
  'GitHub 登录已过期，请重新登录。': 'Your GitHub sign-in expired. Sign in again.',
  '登录已取消。': 'Sign-in canceled.',
  '你没有授权 EasyHub。': 'You did not authorize EasyHub.',
  '登录暂时无法完成，请重试。': 'Sign-in could not be completed. Please retry.',
  '验证码已过期，请重新登录。': 'The verification code expired. Sign in again.',
  '请先使用 GitHub 登录。': 'Sign in with GitHub first.',
  '下载地址无效。': 'The download address is invalid.',
  '此设备暂不支持保存或分享文件。': 'Saving or sharing files is unavailable on this device.',
  '版本地址无效。': 'The release address is invalid.',
};

function localizationImport(text, file, names, module) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statement = source.statements.find((item) => ts.isImportDeclaration(item)
    && ts.isStringLiteral(item.moduleSpecifier) && item.moduleSpecifier.text.endsWith(`/localization/${module}.ts`));
  if (statement && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
    const bindings = statement.importClause.namedBindings;
    const existing = bindings.elements.map((item) => item.getText(source));
    return text.slice(0, bindings.getStart(source)) + `{ ${[...new Set([...existing, ...names])].join(', ')} }` + text.slice(bindings.end);
  }
  const relative = path.relative(path.dirname(file), path.join(root, `apps/mobile/features/localization/${module}.ts`)).replace(/\\/gu, '/');
  return `import { ${names.join(', ')} } from '${relative.startsWith('.') ? relative : `./${relative}`}';\n${text}`;
}

/** Introduces stable identities only for explicitly authored application failures, retaining wire diagnostics. */
export function migrateOwnedErrors(text, file, catalog) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = []; const skipped = [];
  const visit = (node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Error'
      && node.arguments?.length === 1 && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
      const diagnostic = node.arguments[0].text;
      if (/[\u3400-\u9fff]/u.test(diagnostic)) {
        const bilingual = diagnostic.split(' / ');
        const chinese = bilingual.length === 2 ? bilingual[0] : diagnostic;
        const english = bilingual.length === 2 ? bilingual[1] : ownedErrorEnglish[chinese];
        if (english) {
          const expression = migrateSource(`t(${JSON.stringify(chinese)}, ${JSON.stringify(english)})`, file, catalog).output;
          const creation = expression.replace(/^t\(/u, 'new InterfaceError(');
          edits.push({ start: node.getStart(source), end: node.end, value: `${creation}.withDiagnostic(${JSON.stringify(diagnostic)})` });
          return;
        }
        skipped.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: diagnostic });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  if (edits.length) output = localizationImport(output, file, ['InterfaceError'], 'error');
  return { output, errors: edits.length, skipped };
}

export function migrateUiErrorRendering(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const visit = (node) => {
    if (ts.isConditionalExpression(node) && ts.isBinaryExpression(node.condition)
      && node.condition.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword
      && ts.isIdentifier(node.condition.right) && node.condition.right.text === 'Error'
      && ts.isPropertyAccessExpression(node.whenTrue) && node.whenTrue.name.text === 'message'
      && node.whenTrue.expression.getText(source) === node.condition.left.getText(source)) {
      edits.push({ start: node.getStart(source), end: node.end,
        value: `localizeError(${node.condition.left.getText(source)}, t, ${node.whenFalse.getText(source)})` });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let output = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  if (edits.length) output = localizationImport(output, file, ['localizeError'], 'error');
  return { output, errors: edits.length };
}

function listSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === 'localization') return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? listSources(file) : /\.(?:ts|tsx)$/u.test(entry.name) ? [file] : [];
  });
}

async function main() {
  const catalogDir = path.join(root, 'apps/mobile/features/localization/locales');
  const { zh } = await import(pathToFileURL(path.join(catalogDir, 'zh.ts')).href);
  const { en } = await import(pathToFileURL(path.join(catalogDir, 'en.ts')).href);
  const catalog = { zh: { ...zh }, en: { ...en } };
  let calls = 0; const skipped = []; const changed = [];
  for (const file of listSources(path.join(root, 'apps/mobile')).sort()) {
    if (file.endsWith('/auth/uiTestFixtures.ts') || file.endsWith('/programReviewRuntime.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const result = migrateSource(text, file, catalog);
    result.output = migrateHooks(result.output, file).output;
    // `programReviewRuntime` contains synthetic authored AI output for the UI fixture, not interface messages.
    if (!file.endsWith('/programReviewRuntime.ts')) result.output = migrateLanguageBranches(result.output, file, catalog).output;
    const failures = migrateOwnedErrors(result.output, file, catalog);
    result.output = failures.output;
    if (file.endsWith('.tsx') && /\bt\(/u.test(result.output)) result.output = migrateUiErrorRendering(result.output, file).output;
    skipped.push(...failures.skipped.map((item) => ({ file: path.relative(root, file), ...item })));
    calls += result.calls;
    skipped.push(...result.skipped.map((item) => ({ file: path.relative(root, file), ...item })));
    if (result.output !== text) {
      changed.push(path.relative(root, file));
      if (process.argv.includes('--write')) fs.writeFileSync(file, result.output);
    }
  }
  if (process.argv.includes('--write')) {
    fs.writeFileSync(path.join(catalogDir, 'zh.ts'), `export const zh = ${JSON.stringify(catalog.zh, null, 2)} as const;\n`);
    fs.writeFileSync(path.join(catalogDir, 'en.ts'), `import type { zh } from './zh.ts';\nimport type { CatalogMessage } from '../types.ts';\n\nexport const en = ${JSON.stringify(catalog.en, null, 2)} as const satisfies Record<keyof typeof zh, CatalogMessage>;\n`);
  }
  process.stdout.write(`${JSON.stringify({ write: process.argv.includes('--write'), calls, keys: Object.keys(catalog.zh).length, changed, skipped }, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
