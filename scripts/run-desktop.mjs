import { spawnSync } from 'node:child_process';

const allowed = new Set(['dev', 'typecheck', 'lint', 'test', 'test:ui', 'test:public-ui', 'test:discovery-ui', 'test:discovery-navigation', 'test:responsive-ui', 'test:translation-ui', 'test:live-download', 'test:live-local', 'test:live-release', 'test:live-translation', 'test:danger-ui', 'test:packaged', 'test:installer-ui', 'icons', 'build', 'package:win']);
const task = process.argv[2];
allowed.add('test:ai-review-ui');
allowed.add('test:live-pull-download');
allowed.add('test:local-introduction-ui');
allowed.add('test:release-downloads-ui');
allowed.add('test:v2-live-ui');
allowed.add('test:notifications-ui');
allowed.add('test:github-proxy-ui');
allowed.add('test:github-proxy-network');
allowed.add('test:github-system-proxy');
allowed.add('test:single-instance');
allowed.add('test:binary-analysis-ui');
allowed.add('test:live-binary-analysis');
if (!allowed.has(task)) {
  process.stderr.write('Unknown desktop task.\n');
  process.exit(1);
}

const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  process.stderr.write('Please run this script through pnpm.\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, [pnpmEntrypoint, '--filter', '@easyhub/desktop', task], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
