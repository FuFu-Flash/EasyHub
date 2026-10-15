import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readAppError } from '../../shared/errors';

/** Bounded local diagnostics. Never accept a path or credentials from the renderer. */
export class RendererErrorLog {
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly file: string, private readonly maxBytes = 1_000_000) {}
  write(input: unknown): Promise<void> {
    if (!input || typeof input !== 'object') return Promise.reject(new Error('Invalid renderer error report'));
    const value = input as Record<string, unknown>;
    if (!['scope', 'message', 'stack', 'componentStack'].every((key) => typeof value[key] === 'string')) return Promise.reject(new Error('Invalid renderer error report'));
    const clean = (text: unknown, limit: number): string => readAppError(String(text).slice(0, limit)).detail;
    const line = JSON.stringify({ at: new Date().toISOString(), scope: clean(value.scope, 160), message: clean(value.message, 4000), stack: clean(value.stack, 12000), componentStack: clean(value.componentStack, 8000) }) + '\n';
    const pending = this.tail.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      let size = 0;
      try { size = (await stat(this.file)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (size + Buffer.byteLength(line) > this.maxBytes) await rename(this.file, `${this.file}.previous`).catch(async (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
      await appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 });
    });
    this.tail = pending;
    return pending;
  }
}
