import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchUpstreamFixture } from './upstream-smoke-runtime.mjs';

const desktopDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(desktopDirectory, 'out', 'project-detail-layout-smoke');
await mkdir(outputDirectory, { recursive: true });
const runDirectory = await mkdtemp(join(outputDirectory, 'isolated-'));
const profileDirectory = join(runDirectory, 'profile');
await mkdir(profileDirectory);
const preload = await readFile(join(desktopDirectory, 'src', 'preload', 'index.ts'), 'utf8');
const bridgeChannels = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\(([^,\r\n]*)/g)].map(match => {
  const channel = /^'(easyhub:[^']+)'\s*\)?\s*$/.exec(match[1]);
  assert.ok(channel, 'Every exposed IPC invocation must use a known literal channel before this fixture can isolate it.');
  return channel[1];
}))];
assert.ok(bridgeChannels.length >= 40, 'The fixture must discover the full EasyHub IPC bridge.');
const started = Date.now();
const { app, executable, renderer } = await launchUpstreamFixture(desktopDirectory, { profile: profileDirectory,
  launcher: join(runDirectory, 'launch.cjs'), registerName: 'layoutRegisterMock', rejectedName: 'layoutRejectedIpc',
  title: 'Isolated layout fixture' });
const measurements = [];
let geometryAssertions = 0;
const assertGeometry = (condition, message) => { geometryAssertions++; assert.ok(condition, message); };
try {
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profileDirectory);
  await app.evaluate(({ BrowserWindow, ipcMain, session }, bridgeChannels) => {
    const renderer = BrowserWindow.getAllWindows()[0].webContents;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const register = globalThis.layoutRegisterMock ?? ipcMain.handle.bind(ipcMain);
    const fixture = globalThis.layoutFixture = { forbidden: [], reads: [], repositories: [], localLinks: [] };
    const mock = (channel, handler) => {
      ipcMain.removeHandler(channel);
      register(channel, (event, ...args) => {
        if (event.sender !== renderer) throw new Error('Fixture bridge called from another renderer');
        return handler(...args);
      });
    };
    // Deny every exposed real handler first, including packaged executables; allow only the explicit local reads below.
    for (const channel of bridgeChannels.filter(channel => !['easyhub:menu-state', 'easyhub:window-set-style'].includes(channel))) mock(channel, () => {
      fixture.forbidden.push(channel);
      throw new Error('External and write actions are blocked by this layout fixture: ' + channel);
    });
    const now = new Date().toISOString();
    const repository = (id, name) => ({ id, name, full_name: `layout-fixture/${name}`, description: 'Windows/Android GitHub client for newbies: Publish source code and releases on Windows, manage issues, pull request reviews, and support AI code reviews. Beginner-friendly GitHub client for Windows desktop and Android: source publishing, release management, issues, pull request reviews and optional AI code review.',
      private: false, archived: false, owner: { login: 'layout-fixture', avatar_url: '' }, default_branch: 'main', updated_at: now, pushed_at: now,
      permissions: { pull: true, push: true, admin: true }, open_issues_count: 1, stargazers_count: 3, language: 'TypeScript' });
    const longName = 'EasyHub' + 'UnbrokenRepositoryName'.repeat(4);
    const repos = [repository(4201, 'layout-project-with-a-readable-name'),
      { ...repository(4202, longName), description: 'UnbrokenDescription'.repeat(18).slice(0, 350) },
      { ...repository(4203, 'layout-without-description'), description: null },
      repository(4204, 'Local' + 'UnbrokenRepositoryName'.repeat(4))];
    const publicOwner = { login: 'other-layout-fixture', avatar_url: '' };
    const publicRepos = [
      { ...repository(4301, 'public-long-description'), owner: { ...publicOwner, avatar_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1cAAAAASUVORK5CYII=' } },
      { ...repository(4302, longName), owner: publicOwner, description: 'UnbrokenDescription'.repeat(18).slice(0, 350) },
      { ...repository(4303, 'public-without-description'), owner: publicOwner, description: null },
    ].map(repo => ({ ...repo, full_name: `${repo.owner.login}/${repo.name}`, permissions: { pull: true, push: false, admin: false } }));
    fixture.repositories = [...repos, ...publicRepos];
    fixture.localLinks = [{ id: 'layout-local', repositoryId: repos[3].id, owner: 'layout-fixture', name: repos[3].name,
      localPath: `C:\\Projects\\${repos[3].name}\\${'local-path-segment-'.repeat(3)}`, lastOpenedAt: now }];
    const issue = { id: 42011, number: 1, title: 'Fixture issue with a readable title', body: 'A read-only fixture discussion.', state: 'open',
      created_at: now, user: { login: 'fixture-author' }, comments: 0 };
    mock('easyhub:auth-status', () => ({ user: { login: 'layout-fixture', name: 'Layout Fixture', avatar_url: '', html_url: '' }, clientId: null }));
    mock('easyhub:local-list', () => fixture.localLinks);
    mock('easyhub:local-status', () => ({ files: [], needsReview: false }));
    mock('easyhub:local-check-sync', () => ({ state: 'current', files: [] }));
    mock('easyhub:local-read-introduction', () => '# Local fixture\n\nA local project introduction remains available.\n\n'
      + '| Long value | Notes |\n| --- | --- |\n| ' + 'T'.repeat(210) + ' | A table scrolls in its own area. |\n\n'
      + '```text\n' + 'C'.repeat(350) + '\n```');
    mock('easyhub:local-preview-changes', () => ({ files: [], needsReview: false, snapshot: 'layout-read-only-snapshot' }));
    mock('easyhub:local-discovery-roots', () => []);
    mock('easyhub:downloads-list', () => []);
    mock('easyhub:github-cancel', () => undefined);
    mock('easyhub:ai-settings', () => ({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', hasApiKey: false }));
    mock('easyhub:github-proxy-status', () => ({ enabled: false, state: 'off', checkedAt: null, error: null, checks: [], legacyHosts: false }));
    mock('easyhub:mac-proxy-status', () => ({ status: 'disconnected', pacURL: 'http://127.0.0.1:8869/github.pac', socksPort: 8868 }));
    mock('easyhub:binary-analysis-status', () => ({ installed: false, state: 'missing', engineVersion: '12.1.2' }));
    mock('easyhub:github', (action, ...args) => {
      fixture.reads.push(action);
      if (action === 'repos') return args[0] === 1 ? repos : [];
      if (action === 'searchPublicReposPage') return { items: publicRepos, totalCount: publicRepos.length, hasNextPage: false };
      if (action === 'trending') return { items: publicRepos, page: args[1] ?? 1, hasNextPage: false };
      if (action === 'repository' || action === 'publicRepo') {
        const repo = fixture.repositories.find(item => item.owner.login === args[0] && item.name === args[1]);
        if (!repo) throw new Error('Unknown read-only fixture repository');
        return repo;
      }
      if (action === 'activityCounts') return Object.fromEntries(fixture.repositories.map(repo => [repo.id,
        { issues: repo.id === 4201 ? 1 : 0, closedIssues: 0, pullRequests: 0, closedPullRequests: 0 }]));
      if (action === 'readme') return '# Layout fixture\n\nProject introductions and controls remain usable as the window changes size.';
      if (action === 'issuesPage') return { items: args[1] === repos[0].name ? [issue] : [], nextPage: null };
      if (action === 'isStarred') return args[0] === 'layout-fixture' && args[1] === repos[0].name;
      if (action === 'commits' || action === 'comments' || action === 'releases' || action === 'pullRequests') return [];
      if (action === 'releasesPage' || action === 'commentsPage' || action === 'pullRequestsPage') return { items: [], nextPage: null };
      fixture.forbidden.push('github:' + action);
      throw new Error('Unexpected mock GitHub action: ' + action);
    });
  }, bridgeChannels);
  const page = await app.firstWindow();
  page.setDefaultTimeout(12_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(async ({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file), renderer);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('easyhub:language', 'zh'); localStorage.setItem('easyhub:auto-translate', 'false'); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.locator('.live-connected').waitFor();

  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fixtures = await app.evaluate(() => globalThis.layoutFixture.repositories.map(repo => ({ id: repo.id, name: repo.name, owner: repo.owner.login })));
  const openOwnedList = async () => {
    await page.locator('.sidebar-nav').getByRole('button', { name: /^(我的项目|My Projects)$/ }).click();
    await page.getByRole('button', { name: /我的云端项目|Cloud Projects/ }).click();
    await page.locator('.cloud-row').first().waitFor();
    await settle();
  };
  const openProject = async (repo = fixtures[0]) => {
    await openOwnedList();
    await page.locator('.cloud-row').filter({ has: page.getByRole('button', { name: repo.name, exact: true }) }).getByRole('button', { name: /^(查看|View)$/ }).click();
    await page.locator('.detail-hero').waitFor();
    await page.getByRole('button', { name: /^(读取中…|Loading…)$/ }).waitFor({ state: 'hidden' });
    await settle();
  };
  await openProject();
  const measure = async label => {
    await settle();
    const geometry = await page.locator('.detail-hero').evaluate(hero => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      const logo = hero.querySelector('.project-logo');
      const actions = hero.querySelector('.detail-actions');
      const main = hero.querySelector('.detail-main');
      const copy = main.querySelector('div');
      const title = main.querySelector('h1');
      const description = main.querySelector('p');
      const measuredLineHeight = (element) => {
        if (!element) return 0;
        const computed = parseFloat(getComputedStyle(element).lineHeight);
        if (Number.isFinite(computed)) return computed;
        // CSS 'normal' remains a keyword on Chromium/macOS. Measure the actual
        // text line advances instead of guessing a font-size multiplier.
        const range = document.createRange(); range.selectNodeContents(element);
        const rectangles = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
        const tops = [...new Set(rectangles.map(rect => rect.top))].sort((a, b) => a - b);
        const advances = tops.slice(1).map((top, index) => top - tops[index]);
        return advances.length ? Math.min(...advances) : rectangles[0]?.height ?? 0;
      };
      const visibility = main.querySelector('.visibility-label');
      const buttons = [...actions.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(),
        textOverflow: button.scrollWidth - button.clientWidth, ...rect(button) }));
      const column = document.querySelector('.main-column');
      return { viewport: { width: innerWidth, height: innerHeight }, platform: window.easyHub?.platform,
        descriptionLineHeight: measuredLineHeight(description),
        density: document.querySelector('.app-shell').dataset.layout,
        hero: rect(hero), logo: rect(logo), main: rect(main), copy: rect(copy), title: rect(title),
        description: description ? rect(description) : null, visibility: rect(visibility), actions: rect(actions), buttons,
        descriptionOverflow: description ? description.scrollWidth - description.clientWidth : 0,
        titleOverflow: title.scrollWidth - title.clientWidth,
        verticalInsets: parseFloat(getComputedStyle(hero).paddingTop) + parseFloat(getComputedStyle(hero).paddingBottom),
        avatar: logo.querySelector('img') ? { loaded: logo.querySelector('img').complete && logo.querySelector('img').naturalWidth > 0 } : null,
        logoShrink: getComputedStyle(logo).flexShrink, actionDirection: getComputedStyle(actions).flexDirection,
        overflow: column.scrollWidth - column.clientWidth };
    });
    measurements.push({ label, ...geometry });
    await page.screenshot({ path: join(outputDirectory, label + '.png') });
    return geometry;
  };
  const check = (geometry, label) => {
    const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.right <= outer.right + 1;
    const separated = (a, b) => a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1;
    assertGeometry(Math.abs(geometry.logo.width - geometry.logo.height) <= 1,
      label + ': project icon must keep its square shape, received ' + geometry.logo.width + ' × ' + geometry.logo.height);
    assertGeometry(geometry.overflow <= 1, label + ': no page horizontal overflow');
    assertGeometry(inside(geometry.logo, geometry.main), label + ': icon stays inside identity area');
    assertGeometry(inside(geometry.title, geometry.copy) && inside(geometry.visibility, geometry.copy), label + ': title and visibility remain inside copy area');
    assertGeometry(separated(geometry.title, geometry.visibility), label + ': title and visibility must not overlap');
    assertGeometry(geometry.titleOverflow <= 1 && geometry.descriptionOverflow <= 1, label + ': long text wraps without internal clipping');
    assertGeometry(separated(geometry.logo, geometry.copy), label + ': icon and text must not overlap');
    assertGeometry(separated(geometry.main, geometry.actions), label + ': identity and actions must not overlap');
    if (geometry.description) assertGeometry(inside(geometry.description, geometry.copy), label + ': description stays inside copy area');
    for (const button of geometry.buttons) {
      assertGeometry(inside(button, geometry.hero) && button.y >= geometry.hero.y && button.bottom <= geometry.hero.bottom + 1,
        label + ': action stays inside the card: ' + button.text);
      assertGeometry(separated(button, geometry.title) && (!geometry.description || separated(button, geometry.description)),
        label + ': action does not overlap heading or description: ' + button.text);
      assertGeometry(button.textOverflow <= 1, label + ': full action label must remain visible: ' + button.text);
    }
    for (let i = 0; i < geometry.buttons.length; i++) for (let j = i + 1; j < geometry.buttons.length; j++)
      assertGeometry(separated(geometry.buttons[i], geometry.buttons[j]), label + ': action buttons must not overlap');
    const publishRelease = geometry.buttons.find(button => button.text === '发布新版本' || button.text === 'Publish New Release');
    const editRelease = geometry.buttons.find(button => button.text === '编辑发行版' || button.text === 'Edit Releases');
    if (publishRelease && editRelease) assertGeometry(Math.abs(publishRelease.y - editRelease.y) <= 1,
      label + ': related publish/edit release actions must stay together on the same row');
    if (geometry.avatar) assertGeometry(geometry.avatar.loaded, label + ': local avatar fixture must load');
    if (geometry.viewport.width >= 1440) {
      const rows = new Set(geometry.buttons.map(button => Math.round(button.y)));
      assertGeometry(rows.size <= 2, label + ': wide headers must use at most two action rows, received ' + rows.size);
      // The upstream 260px Windows baseline uses different font metrics. On Mac,
      // permit one actual description line when the title/visibility wrap naturally.
      // Content/inset bounds and the two-row action limit below remain independent.
      const fontMetricBudget = geometry.platform === 'darwin' ? geometry.descriptionLineHeight : 0;
      assertGeometry(Number.isFinite(fontMetricBudget) && fontMetricBudget >= 0, label + ': native description line height must be measurable');
      const normalHeadingBudget = 260 + fontMetricBudget;
      if (geometry.title.height < 50) assertGeometry(geometry.hero.height <= normalHeadingBudget,
        label + ': a normal title and long description should fit the baseline plus native text line budget (' + normalHeadingBudget + '): ' + geometry.hero.height);
    }
    const contentHeight = Math.max(geometry.main.bottom, geometry.actions.bottom) - Math.min(geometry.main.y, geometry.actions.y);
    assertGeometry(geometry.hero.height <= contentHeight + geometry.verticalInsets + 3,
      label + ': header must not add excess vertical blank space beyond its visible content');
  };
  const before = await measure('owned-long-description-wide');
  process.stdout.write(JSON.stringify(before) + '\n');
  check(before, 'Owned long description at 1440');
  const checkCloudList = async label => {
    await openOwnedList();
    const rows = await page.locator('.cloud-row').evaluateAll(elements => elements.map(row => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, width: r.width, height: r.height }; };
      const copy = row.querySelector('div');
      const heading = copy.querySelector('.plain-heading');
      return { row: rect(row), copy: rect(copy), heading: rect(heading), title: heading.textContent,
        headingOverflow: heading.scrollWidth - heading.clientWidth, rowOverflow: row.scrollWidth - row.clientWidth,
        logo: rect(row.querySelector('.project-logo')), buttons: [...row.querySelectorAll(':scope > button')].map(rect) };
    }));
    measurements.push({ label, cloudRows: rows });
    if (label.includes('1060') || label.includes('1440')) await page.screenshot({ path: join(outputDirectory, label + '.png') });
    for (const row of rows) {
      assertGeometry(row.rowOverflow <= 1 && row.headingOverflow <= 1, label + ': row content must not be internally clipped: ' + row.title);
      assertGeometry(row.heading.x >= row.copy.x - 1 && row.heading.right <= row.copy.right + 1, label + ': long cloud title stays in text column');
      assertGeometry(Math.abs(row.logo.width - row.logo.height) <= 1, label + ': list logo retains square shape');
      for (const button of row.buttons) assertGeometry(row.copy.right <= button.x + 1 && button.right <= row.row.right + 1,
        label + ': cloud title and description must not overlap actions');
    }
  };
  const openAddress = async repo => {
    await page.locator('.topbar-search input').fill(`https://github.com/${repo.owner}/${repo.name}`);
    await page.locator('.discover-search input').waitFor();
    await page.locator('.discover-search input').press('Enter');
    await page.getByTestId('public-project-browser').waitFor();
    await page.locator('.public-browser-hero').waitFor();
    await page.getByRole('button', { name: /^(读取中…|Loading…)$/ }).waitFor({ state: 'hidden' });
    await settle();
    for (const forbidden of ['本地项目与发布源码', '发布新版本', '编辑发行版', 'Local Project & Publish Source', 'Publish New Release', 'Edit Releases'])
      assert.equal(await page.locator('.public-browser-hero').getByRole('button', { name: forbidden, exact: true }).count(), 0,
        'Public read-only header must not expose owned actions: ' + forbidden);
  };
  const checkLocalWorkspace = async label => {
    await page.locator('.sidebar-nav').getByRole('button', { name: /^(我的项目|My Projects)$/ }).click();
    await page.getByRole('button', { name: /这台电脑|This Computer/ }).click();
    const card = page.locator('.project-card').filter({ has: page.getByRole('button', { name: fixtures[3].name, exact: true }) });
    await card.getByRole('button', { name: /^(打开项目|Open Project)$/ }).click();
    await page.locator('.local-workspace .local-project-card').waitFor();
    await page.getByRole('heading', { name: 'Local fixture', exact: true }).waitFor();
    const local = await page.locator('.local-project-card').evaluate(card => {
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom }; };
      const title = card.querySelector('.panel-heading h2');
      const status = card.querySelector('.panel-heading .muted');
      const path = card.querySelector(':scope > p');
      const column = document.querySelector('.main-column');
      const introduction = card.querySelector('.readme-markdown');
      return { card: rect(card), title: rect(title), status: rect(status), pathOverflow: path.scrollWidth - path.clientWidth,
        overflow: card.scrollWidth - card.clientWidth, titleOverflow: title.scrollWidth - title.clientWidth,
        viewportWidth: innerWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth,
        columnOverflow: column.scrollWidth - column.clientWidth, column: rect(column), introduction: rect(introduction),
        scrollRegions: [...introduction.querySelectorAll('table, pre')].map(region => ({ tag: region.tagName, ...rect(region),
          scrollWidth: region.scrollWidth, clientWidth: region.clientWidth })) };
    });
    measurements.push({ label, localWorkspace: local });
    if (label.includes('1060') || label.includes('1440')) await page.screenshot({ path: join(outputDirectory, label + '-local-workspace.png') });
    assertGeometry(local.overflow <= 1 && local.titleOverflow <= 1 && local.pathOverflow <= 1, label + ': local title and folder path must wrap without clipping');
    assertGeometry(local.pageOverflow <= 1 && local.columnOverflow <= 1 && local.card.right <= local.column.right + 1,
      label + ': wide README tables and code must not expand the local page or card');
    assertGeometry(local.introduction.x >= local.card.x - 1 && local.introduction.right <= local.card.right + 1,
      label + ': local README stays inside the project card');
    assert.equal(local.scrollRegions.length, 2, label + ': stress fixture must render both the 210-character table value and 350-character code line');
    for (const region of local.scrollRegions) assertGeometry(region.x >= local.introduction.x - 1 && region.right <= local.introduction.right + 1,
      label + ': ' + region.tag + ' scrolls only inside its own constrained README area');
    assertGeometry(local.title.right <= local.card.right + 1 && local.status.right <= local.card.right + 1,
      label + ': local title and status stay inside the card');
    assertGeometry(local.title.right <= local.status.x + 1 || local.title.bottom <= local.status.y + 1,
      label + ': local heading and status must not overlap');
    await page.locator('.sidebar-nav').getByRole('button', { name: /^(我的项目|My Projects)$/ }).click();
    await page.getByRole('button', { name: /这台电脑|This Computer/ }).click();
    await card.getByRole('button', { name: label.startsWith('en-') ? 'View Details' : '查看详情', exact: true }).click();
    await page.locator('.detail-hero').waitFor();
    await page.getByRole('button', { name: /^(读取中…|Loading…)$/ }).waitFor({ state: 'hidden' });
    check(await measure(label + '-local-detail'), label + ': detail opened from local checkout');
  };
  let cases = 1;
  let cloudMatrices = 0;
  const runMatrix = async (width, preference, language = 'zh') => {
    await page.setViewportSize({ width, height: width === 1060 ? 700 : 900 });
    await page.evaluate(preference => {
      localStorage.setItem('easyhub:layout-preference', preference);
      window.dispatchEvent(new StorageEvent('storage', { key: 'easyhub:layout-preference', newValue: preference }));
    }, preference);
    const density = preference === 'auto' ? width <= 1180 ? 'compact' : 'comfortable' : preference;
    await page.waitForFunction(({ preference, density }) => document.querySelector('.app-shell')?.dataset.layoutPreference === preference
      && document.querySelector('.app-shell')?.dataset.layout === density, { preference, density });
    const label = `${language}-${preference}-${width}`;
    await checkCloudList(label + '-cloud-list');
    cloudMatrices++;
    for (const repo of fixtures.slice(0, 3)) {
      await openProject(repo);
      check(await measure(`${label}-owned-${repo.id}`), `${label}: owned ${repo.name}`);
      if (language === 'en') assert.equal(await page.locator('.detail-actions').getByRole('button', { name: 'Local Project & Publish Source', exact: true }).count(), 1,
        'English matrix must exercise the translated action labels');
      cases++;
    }
    for (const repo of fixtures.slice(4)) {
      await openAddress(repo);
      check(await measure(`${label}-public-${repo.id}`), `${label}: public ${repo.name}`);
      cases++;
    }
    await checkLocalWorkspace(label);
    cases += 2;
    process.stdout.write(`PASS ${label}: cloud list, three owned headers, three public headers, local workspace and local detail.\n`);
  };
  for (const width of [1060, 1200, 1440, 1920]) for (const preference of ['comfortable', 'compact', 'auto']) await runMatrix(width, preference);
  await page.evaluate(() => localStorage.setItem('easyhub:language', 'en'));
  await page.reload();
  await page.locator('.live-connected').waitFor();
  await page.locator('.sidebar-nav').getByRole('button', { name: 'My Projects', exact: true }).waitFor();
  await runMatrix(1440, 'comfortable', 'en');
  await runMatrix(1060, 'compact', 'en');
  assert.deepEqual(errors, []);
  assert.deepEqual(await app.evaluate(() => globalThis.layoutFixture.forbidden), []);
  assert.deepEqual(await app.evaluate(() => globalThis.layoutRejectedIpc ?? []), []);
  await writeFile(join(outputDirectory, 'isolation-and-count-report.json'), JSON.stringify({ blockedByDefaultChannels: bridgeChannels.filter(channel => !['easyhub:menu-state', 'easyhub:window-set-style'].includes(channel)).length,
    allowedNativeUIChannels: ['easyhub:menu-state', 'easyhub:window-set-style'], credentialStore: 'memory',
    matrixPageChecks: cases - 1, baselineChecks: 1, cloudListMatrices: cloudMatrices, geometryAssertions,
    forbiddenCalls: [], unexpectedIpcCalls: [], externalNetworkBlocked: true, systemProxyIntegrationDisabled: true }, null, 2) + '\n');
  process.stdout.write(`PASS: ${geometryAssertions} geometry assertions in ${cases - 1} real-renderer matrix cases + 1 baseline check, plus ${cloudMatrices} cloud-list matrices; no external writes or AI calls. (${Date.now() - started} ms)\n`);
} finally {
  await writeFile(join(outputDirectory, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
  await app.close();
}
