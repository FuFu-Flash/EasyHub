import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RendererErrorLog } from './RendererErrorLog';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function fixture(maxBytes?: number) {
  const directory = await mkdtemp(join(tmpdir(), 'easyhub-render-log-')); directories.push(directory);
  const file = join(directory, 'logs', 'renderer-errors.log');
  return { file, logger: new RendererErrorLog(file, maxBytes) };
}
describe('renderer error log', () => {
  it('writes ordered local reports and redacts tokens in every field', async () => {
    const { file, logger } = await fixture();
    await Promise.all([logger.write({ scope: 'page', message: 'failure sk-secret123', stack: 'ghp_secret123', componentStack: 'Authorization: bearer secret123' }), logger.write({ scope: 'shell', message: 'second', stack: '', componentStack: '' })]);
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('secret123');
    expect(raw.split('\n').filter(Boolean).map((line) => JSON.parse(line).scope)).toEqual(['page', 'shell']);
    expect(JSON.parse(raw.split('\n')[0]!).at).toMatch(/^\d{4}-/);
  });
  it('rotates bounded logs and retains only one previous file', async () => {
    const { file, logger } = await fixture(150);
    for (const message of ['first', 'second', 'third']) await logger.write({ scope: 'page', message: message.repeat(15), stack: '', componentStack: '' });
    expect(await readFile(file, 'utf8')).toContain('third');
    const previous = await readFile(`${file}.previous`, 'utf8'); expect(previous).toContain('second'); expect(previous).not.toContain('first');
  });
  it('rejects malformed reports and remains usable after rejection', async () => {
    const { file, logger } = await fixture();
    await expect(logger.write({ file: 'arbitrary-path' })).rejects.toThrow();
    await logger.write({ scope: 'page', message: 'ok', stack: 'x'.repeat(25000), componentStack: '' });
    expect((await readFile(file, 'utf8')).length).toBeLessThan(13000);
  });
});
