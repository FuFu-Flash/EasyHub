import { spawnSync } from 'node:child_process';

const allowed = new Set(['dev', 'typecheck', 'lint', 'test', 'test:ui', 'test:public-ui', 'test:discovery-ui', 'test:discovery-navigation', 'test:responsive-ui', 'test:translation-ui', 'test:live-download', 'test:live-local', 'test:live-release', 'test:live-translation', 'test:danger-ui', 'test:packaged', 'test:installer-ui', 'icons', 'build', 'package:win']);
const task = process.argv[2];
allowed.add('test:ai-review-ui');
allowed.add('test:live-pull-download');
allowed.add('test:local-introduction-ui');
allowed.add('test:readme-editor-ui');
allowed.add('test:layout-ui');
allowed.add('test:common-workflows');
allowed.add('test:issue-workspace');
allowed.add('test:discussion-links');
allowed.add('test:discussion-pagination');
allowed.add('test:app-update-drafts');
allowed.add('test:managed-downloads');
allowed.add('test:pull-review-tools');
allowed.add('test:local-publish-selection');
allowed.add('test:workspace-safety');
allowed.add('test:ux-consistency');
allowed.add('test:resilience');
allowed.add('review:resilience');
allowed.add('review:workspace-navigation');
allowed.add('test:key-localization');
allowed.add('test:new-project-layout');
allowed.add('test:code-explanation');
allowed.add('test:source-history');
allowed.add('test:navigation-state');
allowed.add('test:navigation-detail');
allowed.add('test:dialog-focus');
allowed.add('test:release-navigation');
allowed.add('test:navigation-chain');
allowed.add('test:demo-navigation-chain');
allowed.add('test:demo');
allowed.add('review:demo');
allowed.add('test:release-downloads-ui');
allowed.add('test:v2-live-ui');
allowed.add('test:notifications-ui');
allowed.add('test:github-proxy-ui');
allowed.add('test:github-proxy-network');
allowed.add('test:github-system-proxy');
allowed.add('test:single-instance');
allowed.add('test:binary-analysis-ui');
allowed.add('test:live-binary-analysis');
allowed.add('test:compact-package');
if (!allowed.has(task)) {
  process.stderr.write('Unknown desktop task.\n');
  process.exit(1);
}

const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  process.stderr.write('Please run this script through pnpm.\n');
  process.exit(1);
}

const forwarded = process.argv.slice(3);
const args = /npm-cli\.[cm]?js$/i.test(pnpmEntrypoint)
  ? [pnpmEntrypoint, '--prefix', 'apps/desktop', 'run', task, '--', ...forwarded]
  : [pnpmEntrypoint, '--filter', '@easyhub/desktop', task, ...forwarded];
const result = spawnSync(process.execPath, args, {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
