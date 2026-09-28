import { spawnSync } from 'node:child_process';

const allowed = new Set(['start', 'android', 'ios', 'typecheck', 'lint', 'test', 'export']);
const task = process.argv[2];
if (!allowed.has(task)) {
  process.stderr.write('Unknown mobile task.\n');
  process.exit(1);
}

const pnpmEntrypoint = process.env.npm_execpath;
if (!pnpmEntrypoint) {
  process.stderr.write('Please run this script through pnpm.\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, [pnpmEntrypoint, '--filter', '@easyhub/mobile', task], {
  cwd: process.cwd(),
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
