import { spawnSync } from 'node:child_process';

const allowed = new Set(['dev', 'typecheck', 'lint', 'test', 'test:ui', 'test:public-ui', 'test:discovery-ui', 'test:responsive-ui', 'test:translation-ui', 'test:live-download', 'test:live-local', 'test:live-translation', 'test:danger-ui', 'test:packaged', 'test:demo-packaged', 'icons', 'build', 'package:win', 'package:demo']);
const task = process.argv[2];
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
