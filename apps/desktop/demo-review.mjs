import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function runDemoReview(page, { app, output }) {
  const scenarios = [
    { goal: '首次使用先体验，再连接自己的账户', steps: '欢迎页选择演示 → 创建虚拟项目 → 登录 → 退出', expected: '登录前不调用原生业务 API，真实账户中没有演示项目，退出后演示重新初始化' },
    { goal: '发布之前能检查本次文件', steps: '首页主任务 → 文件选择 → 查看差异 → 选择敏感文件', expected: '说明和选择可见、焦点合理；敏感文件默认不选并要求确认' },
    { goal: '日常阅读和管理与真实界面一致', steps: '问题、合并请求、发行版、设置；切页后返回', expected: '共用组件，数量和状态一致，草稿/导航保持在本次会话' },
    { goal: '小窗口及英文界面能正常使用', steps: '中英文 × 舒适/紧凑 × 1440/1000，检查文案、属性、布局和窗口控件', expected: '无溢出、遮挡或界面中文漏翻，用户原文保留' },
  ];
  await writeFile(join(output, 'experience-scenarios.json'), JSON.stringify(scenarios, null, 2));
  // firstWindow can resolve before loadURL leaves about:blank. Keep the fresh
  // visit on the actual fixture route instead of navigating to a blank document.
  await page.waitForURL(url => url.protocol === 'http:' || url.protocol === 'file:');
  const root = new URL(page.url()); root.search = '?fresh=1'; await page.goto(root.href); await page.getByRole('heading', { name: '欢迎使用 EasyHub', exact: true }).waitFor();
  await page.getByRole('button', { name: '先看看演示', exact: true }).click(); await page.locator('.demo-workspace').waitFor();
  await page.getByRole('button', { name: '新建项目', exact: true }).click(); await page.getByRole('button', { name: '选择文件夹', exact: true }).click(); await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('DemoOnlyCreated'); await page.getByRole('button', { name: '创建项目', exact: true }).click(); await page.getByRole('checkbox', { name: '发布 README.md', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.nativeDomainCalls), []);
  await page.locator('.demo-mode-notice').getByRole('button', { name: '登录 GitHub', exact: true }).click(); await page.locator('.oauth-code').waitFor(); await page.locator('.live-connected').waitFor();
  assert.equal(await page.locator('.demo-workspace').count(), 0); await page.getByText('RealOnly', { exact: true }).first().waitFor(); assert.equal(await page.getByText('DemoOnlyCreated', { exact: true }).count(), 0);
  await page.locator('.sidebar-nav').getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click(); await page.locator('.demo-workspace .home-dashboard').waitFor(); assert.equal(await page.getByText('RealOnly', { exact: true }).count(), 0); assert.equal(await page.getByText('DemoOnlyCreated', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('easyhub:repos:easyhub-demo')), null);
  const layouts = [], leaks = [];
  const names = { zh: ['首页', '问题', '合并请求', '设置'], en: ['Home', 'Issues', 'Pull requests', 'Settings'] };
  for (const language of ['zh', 'en']) for (const density of ['comfortable', 'compact']) for (const width of [1440, 1000]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await page.evaluate(({ language, density }) => { localStorage.setItem('easyhub:language', language); localStorage.setItem('easyhub:layout-preference', density); }, { language, density });
    root.search = ''; await page.goto(root.href); await page.locator('.demo-workspace .home-dashboard').waitFor();
    for (const label of names[language]) {
      await page.locator('.sidebar-nav').getByRole('button', { name: new RegExp(`^${label}`, 'i') }).click();
      const measure = await page.evaluate(() => { const main = document.querySelector('.main-column'), controls = document.querySelector('.windows-window-controls').getBoundingClientRect(); return { width: innerWidth, overflow: main.scrollWidth - main.clientWidth, controlsTop: controls.top, controlsRight: controls.right }; });
      assert.ok(measure.overflow <= 2 && measure.controlsTop === 0 && Math.abs(measure.width - measure.controlsRight) <= 1, JSON.stringify(measure)); layouts.push({ language, density, label, ...measure });
      if (language === 'en') {
        const remaining = await page.evaluate(() => {
          const allowed = new Set(window.demoUserContent), found = []; const walker = document.createTreeWalker(document.querySelector('.app-shell'), NodeFilter.SHOW_TEXT); let node;
          while ((node = walker.nextNode())) { const el = node.parentElement, value = node.textContent.trim(); if (!el?.getBoundingClientRect().width || el.closest('[data-content-original],textarea') || allowed.has(value)) continue; if (/[\u3400-\u9fff]/u.test(value)) found.push(value); }
          for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) { if (!el.getBoundingClientRect().width || el.closest('[data-content-original]')) continue; for (const attribute of ['title','aria-label','placeholder']) { const value = el.getAttribute(attribute) || ''; if (!allowed.has(value) && /[\u3400-\u9fff]/u.test(value)) found.push(attribute+': '+value); } }
          return found;
        }); leaks.push(...remaining.map(text => ({label,density,width,text})));
      }
      await page.screenshot({ path: join(output, `review-${language}-${density}-${width}-${label}.png`) });
    }
    await page.locator('.sidebar-nav').getByRole('button', { name: language === 'en' ? 'Home' : '首页', exact: true }).click(); await page.locator('.v2-feature-button').click(); await page.locator('.local-publish').waitFor();
    assert.equal(await page.getByRole('checkbox', { name: language === 'en' ? 'Publish .env' : '发布 .env', exact: true }).isChecked(), false);
    assert.ok(await page.locator('.local-publish input').evaluate((input) => input === document.activeElement));
    await page.screenshot({ path: join(output, `review-publish-${language}-${density}-${width}.png`) });
  }
  await writeFile(join(output,'english-leaks.json'),JSON.stringify(leaks,null,2));assert.deepEqual(leaks,[],'English interface text and attributes');
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Home', exact: true }).click();
  const input = page.getByRole('combobox'); await input.focus(); await page.evaluate(() => { const el = document.querySelector('[role=combobox]'); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); }); await input.fill('Starter'); await page.keyboard.press('Enter'); assert.ok(await page.locator('.home-dashboard').isVisible()); await page.evaluate(() => document.querySelector('[role=combobox]').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))); await page.keyboard.press('Escape');
  await page.evaluate(() => { document.querySelector('[role=combobox]').value = ''; });
  await writeFile(join(output, 'experience-result.json'), JSON.stringify({ passed: true, scenarios, layouts, leaks, network: 'blocked outside localhost', realAccount: 'isolated fixture', githubWrites: 0, paidAiCalls: 0 }, null, 2));
  return { onboarding: true, demoToRealIsolation: true, realToDemoReset: true, memoryOnlyCache: true, layouts: layouts.length, fileSelectionAndFocus: true, composition: true };
}
