import assert from 'node:assert/strict';

const nav = (page, name) => page.locator('.sidebar-nav').getByRole('button', { name: new RegExp(`^${name}`) });
async function home(page) { await nav(page, '首页').click(); await page.locator('.home-dashboard').waitFor(); }
async function project(page, name = 'MyTool') { await home(page); await page.locator('.home-project-row').filter({ hasText: name }).getByRole('button', { name: '打开项目', exact: true }).click(); await page.locator('.detail-hero h1').filter({ hasText: name }).waitFor(); }
export async function runDemoChecks(page, { demoOnly = false } = {}) {
  await page.locator('.demo-workspace .home-dashboard').waitFor();
  assert.ok((await page.locator('.demo-mode-notice').innerText()).includes('未上传到 GitHub'));
  assert.equal(await page.locator('.sidebar-demo').count(), 0);
  assert.equal(await page.locator('.demo-mode-notice').getByRole('button', { name: '登录 GitHub', exact: true }).count(), demoOnly ? 0 : 1);
  await page.getByRole('button', { name: '账户菜单', exact: true }).click(); await page.getByText('演示账户', { exact: true }).waitFor(); await page.keyboard.press('Escape');

  // Home must route through the real file review and confirmation flow.
  await page.getByRole('button', { name: '查看并发布', exact: true }).click();
  const env = page.getByRole('checkbox', { name: '发布 .env', exact: true }); await env.waitFor(); assert.equal(await env.isChecked(), false);
  await page.getByRole('checkbox', { name: '全选', exact: true }).check(); await page.getByRole('checkbox', { name: '全选', exact: true }).uncheck(); await env.check();
  await page.getByRole('textbox', { name: '这次改了什么？', exact: true }).fill('演示选择发布一个文件');
  await page.getByRole('button', { name: '发布选中的文件', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '这些文件可能包含密码或密钥', exact: true }); await confirm.waitFor();
  await confirm.getByRole('button', { name: '返回检查', exact: true }).click(); assert.ok(await env.isVisible());
  await page.getByRole('button', { name: '发布选中的文件', exact: true }).click(); await confirm.getByRole('button', { name: '确认发布这些文件', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="发布 .env"]'));
  assert.ok(await page.getByRole('checkbox', { name: '发布 src/main.ts', exact: true }).isVisible(), 'Unselected changes remain after simulated publication');

  await nav(page, '问题').click(); await page.locator('.issue-row').filter({ hasText: '窗口缩小时按钮会重叠' }).click();
  await page.getByRole('textbox', { name: '写一条回复', exact: true }).fill('演示回复只保存在内存');
  await page.getByRole('button', { name: '发送回复', exact: true }).click(); await page.getByText('演示回复只保存在内存', { exact: true }).waitFor();
  await page.getByRole('button', { name: '标记为已解决', exact: true }).click(); await page.getByRole('button', { name: '重新打开', exact: true }).waitFor();

  await nav(page, '合并请求').click();
  await page.locator('.live-issue-group').filter({ hasText: 'MyTool' }).locator('.issue-project-header').click();
  await page.getByRole('button').filter({ hasText: '修复窗口缩小时的按钮排版' }).last().click();
  await page.getByRole('button', { name: 'AI 审查', exact: true }).click(); await page.getByRole('button', { name: '同意并开始审查', exact: true }).click(); await page.locator('.ai-review-result').getByText(/演示结果/).waitFor();

  await project(page);
  await page.getByRole('button', { name: /发布新版本|发布发行版/, exact: false }).click();
  const tag = await page.getByRole('textbox', { name: '版本号', exact: true }).inputValue();
  await page.getByRole('textbox', { name: '发行版介绍', exact: true }).fill('统一界面的模拟发行版');
  await page.locator('.release-add-files').click();
  await page.getByRole('button', { name: '预览发布效果', exact: true }).click(); await page.getByRole('button', { name: '确认发布发行版', exact: true }).click();
  await page.getByRole('heading', { name: `MyTool ${tag}`, exact: true }).waitFor();
  assert.ok(await page.getByText('统一界面的模拟发行版', { exact: true }).isVisible());
  await page.locator('.release-edit-entry').first().getByRole('button', { name: '编辑发行版', exact: true }).click();
  await page.getByRole('textbox', { name: '发行版名称', exact: true }).fill('Edited demo release');
  await page.locator('.release-edit-panel').getByRole('button', { name: /保存/, exact: false }).first().click();
  await page.getByRole('heading', { name: 'Edited demo release', exact: true }).waitFor();

  await nav(page, '发现').click(); await page.locator('.trending-card').filter({ hasText: 'StarterKit' }).click();
  await page.getByRole('button', { name: '下载发行版或源码', exact: true }).click(); await page.getByRole('button', { name: /下载源码 ZIP/ }).click();
  await page.locator('.download-notification-item').filter({ hasText: 'StarterKit' }).waitFor();
  const completedDownload = page.locator('.download-notification-item').filter({ hasText: 'StarterKit' }).locator('.download-notification-success');
  await completedDownload.waitFor();
  assert.equal(await completedDownload.innerText(), '项目已经下载完成。');

  // A reload creates a new bridge, not a durable account or virtual repository cache.
  await page.reload(); await page.locator('.demo-workspace .home-dashboard').waitFor(); await page.getByRole('button', { name: '查看并发布', exact: true }).click(); await page.getByRole('checkbox', { name: '发布 .env', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name: '发布 .env', exact: true }).isChecked(), false);
  await home(page);
  return { sharedUi: true, selectionAndSensitiveConfirmation: true, partialFileSelection: true, issuesAndReplies: true, pullReview: true, releasePublishAndEdit: true, virtualDownloads: true, reloadReset: true };
}

export async function runDemoHistoryChecks(page) {
  await project(page); const version = page.locator('.timeline-item').filter({ hasText: '修复启动问题' }).first(); await version.scrollIntoViewIfNeeded(); const scroll = await page.locator('.main-column').evaluate((node) => node.scrollTop);
  await version.click(); await page.getByRole('heading', { name: '修复启动问题', exact: true }).waitFor();
  await nav(page, '设置').click(); assert.equal(await page.locator('.back-link').count(), 0); await page.keyboard.press('Alt+ArrowLeft'); await page.getByRole('heading', { name: '修复启动问题', exact: true }).waitFor();
  await page.locator('.back-link').click(); await page.locator('.detail-hero h1').filter({ hasText: 'MyTool' }).waitFor();
  assert.ok(Math.abs(await page.locator('.main-column').evaluate((node) => node.scrollTop) - scroll) < 5);
  await page.locator('.back-link').click(); await page.locator('.home-dashboard').waitFor();
  await nav(page, '我的项目').click(); if (!await page.getByRole('heading', { name: '我的项目', exact: true }).count()) await nav(page, '我的项目').click(); await page.getByRole('button', { name: /这台电脑/ }).click(); await page.getByRole('combobox').fill('MyTool');
  await page.locator('.project-card').getByRole('button', { name: '查看详情', exact: true }).click();
  await page.locator('.detail-primary .panel').filter({ has: page.getByRole('heading', { name: '修改记录', exact: true }) }).getByRole('button', { name: '查看全部', exact: true }).click();
  await page.locator('.history-row').first().click(); await page.locator('.back-link').click(); await page.getByRole('heading', { name: '修改记录', exact: true }).waitFor(); await page.locator('.back-link').click(); await page.locator('.detail-hero').waitFor(); await page.locator('.back-link').click();
  assert.equal(await page.getByRole('combobox').inputValue(), 'MyTool'); assert.equal(await page.locator('.project-card').count(), 1);
  await page.keyboard.press('Alt+ArrowRight'); await page.locator('.detail-hero').waitFor();
  await page.getByRole('button', { name: '删除此项目', exact: true }).click(); const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: '确认项目名称', exact: true }).fill('easyhub-demo/MyTool'); await dialog.getByRole('button', { name: '删除此项目', exact: true }).click(); await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor();
  for (let index = 0; index < 12; index++) { await page.keyboard.press('Alt+ArrowLeft'); await page.waitForTimeout(100); assert.equal(await page.locator('.detail-hero h1').filter({ hasText: 'MyTool' }).count(), 0, 'Deleted demo projects must not return through cached navigation'); }
  return { directOrigin: true, multilevelBack: true, forward: true, scrollRestoration: true, searchRestoration: true, deletedPagePruning: true };
}
