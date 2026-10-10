import fs from 'node:fs';
import { createReadStream, type Stats } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import * as git from 'isomorphic-git';
import type { ChangedFile, LocalDiffLine, LocalFileDiff, LocalPublishPreview, LocalPublishSelection } from '@easyhub/types';
import type { GitAuthor, GitProjectStatus } from './GitEngine';
import { GitEngineError } from './GitEngine';

const staleMessage = '文件在你查看后又发生了变化，请刷新修改列表后重新选择。';
interface FileSnapshot { file: ChangedFile; fingerprint: string; mode?: number }
export interface ChangeSnapshot { preview: LocalPublishPreview; head: string | null; branch: string | undefined; files: FileSnapshot[] }
export interface PendingPublication { head: string; snapshot: string; paths: string[]; message: string }
export async function pendingPublication(dir: string, head: string | null): Promise<PendingPublication | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(dir, '.git', 'easyhub-publish-pending.json'), 'utf8'));
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<PendingPublication>;
    return item.head === head && typeof item.snapshot === 'string' && /^[a-f0-9]{64}$/.test(item.snapshot) && typeof item.message === 'string'
      && Array.isArray(item.paths) && item.paths.every(safeChangePath) ? item as PendingPublication : null;
  } catch { return null; }
}
const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

export function safeChangePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\\:\x00-\x1f\x7f]/.test(value)
    && !value.split('/').some((part) => !part || part === '.' || part === '..' || /^\.git$/i.test(part) || /[. ]$/.test(part));
}
async function inspectPath(dir: string, path: string): Promise<Stats | null> {
  if (!safeChangePath(path)) throw new GitEngineError('invalid', '文件路径无效，请重新选择。');
  let parent = dir;
  for (const segment of path.split('/').slice(0, -1)) {
    parent = join(parent, segment);
    try { const entry = await lstat(parent); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new GitEngineError('unsupported', '该文件包含特殊链接，暂时不能安全查看或发布。'); }
    catch (error) { if (missing(error)) return null; throw error; }
  }
  try { const entry = await lstat(join(dir, path)); if (!entry.isFile() || entry.isSymbolicLink()) throw new GitEngineError('unsupported', '该文件不是普通文件，暂时不能安全查看或发布。'); return entry; }
  catch (error) { if (missing(error)) return null; throw error; }
}
async function fingerprint(dir: string, file: ChangedFile): Promise<{ value: string; mode?: number }> {
  const entry = await inspectPath(dir, file.path);
  if (!entry) return { value: 'missing' };
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(join(dir, file.path))) hash.update(chunk as Buffer);
  const mode = process.platform === 'win32' ? 0o100644 : entry.mode & 0o111 ? 0o100755 : 0o100644;
  return { value: `${mode}:${hash.digest('hex')}`, mode };
}

export async function snapshotChanges(dir: string, status: GitProjectStatus): Promise<ChangeSnapshot> {
  const branch = await git.currentBranch({ fs, dir }) || undefined;
  const files: FileSnapshot[] = [];
  for (const file of status.files) {
    if (!safeChangePath(file.path) || file.previousPath && !safeChangePath(file.previousPath)) throw new GitEngineError('unsupported', '项目包含暂时无法安全发布的文件路径。');
    const found = await fingerprint(dir, file);
    if ((file.kind === 'deleted') !== (found.value === 'missing')) throw new GitEngineError('invalid', staleMessage);
    if (file.previousPath && await inspectPath(dir, file.previousPath)) throw new GitEngineError('invalid', staleMessage);
    files.push({ file, fingerprint: found.value, mode: found.mode });
  }
  const snapshot = createHash('sha256').update(JSON.stringify({ head: status.head, branch, prepared: status.hasPreparedChanges, files })).digest('hex');
  return { preview: { snapshot, files: status.files, needsReview: status.hasPreparedChanges, pendingPublish: status.pendingPublish, pendingMessage: status.pendingMessage }, head: status.head, branch, files };
}

function diffLines(before: string, after: string): { lines: LocalDiffLine[]; additions: number; deletions: number } | null {
  const old = before === '' ? [] : before.split('\n'); const next = after === '' ? [] : after.split('\n');
  if (old.at(-1) === '') old.pop(); if (next.at(-1) === '') next.pop();
  if (old.length > 4000 || next.length > 4000 || old.length * next.length > 4_000_000) return null;
  const width = next.length + 1; const matrix = new Uint16Array((old.length + 1) * width);
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--)
    matrix[i * width + j] = old[i] === next[j] ? matrix[(i + 1) * width + j + 1]! + 1 : Math.max(matrix[(i + 1) * width + j]!, matrix[i * width + j + 1]!);
  let i = 0; let j = 0; let additions = 0; let deletions = 0; const lines: LocalDiffLine[] = [];
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && old[i] === next[j]) { lines.push({ kind: 'context', text: old[i]!, before: ++i, after: ++j }); }
    else if (i < old.length && (j === next.length || matrix[(i + 1) * width + j]! >= matrix[i * width + j + 1]!)) { lines.push({ kind: 'deleted', text: old[i]!, before: ++i }); deletions++; }
    else { lines.push({ kind: 'added', text: next[j]!, after: ++j }); additions++; }
  }
  if (before.endsWith('\n') !== after.endsWith('\n')) lines.push({ kind: 'context', text: after.endsWith('\n') ? '文件末尾新增换行' : '文件末尾没有换行' });
  return { lines, additions, deletions };
}

export async function fileDifference(dir: string, snapshot: ChangeSnapshot, path: string): Promise<LocalFileDiff> {
  const selected = snapshot.files.find((entry) => entry.file.path === path);
  if (!selected) throw new GitEngineError('invalid', '这个文件不在修改列表中，请刷新后重试。');
  const file = selected.file;
  const result: LocalFileDiff = { ...file, lines: [], additions: 0, deletions: 0 };
  const details = await inspectPath(dir, file.path);
  if (details && details.size > 256 * 1024) return { ...result, unavailable: 'large' };
  let before = Buffer.alloc(0); let after = Buffer.alloc(0);
  if (snapshot.head && file.kind !== 'added') {
    const blob = await git.readBlob({ fs, dir, oid: snapshot.head, filepath: file.previousPath ?? file.path });
    if (blob.blob.length > 256 * 1024) return { ...result, unavailable: 'large' };
    before = Buffer.from(blob.blob);
  }
  if (details) after = await readFile(join(dir, file.path));
  if (after.length > 256 * 1024) return { ...result, unavailable: 'large' };
  if (before.includes(0) || after.includes(0)) return { ...result, unavailable: 'binary' };
  let oldText: string; let newText: string;
  try { const decoder = new TextDecoder('utf-8', { fatal: true }); oldText = decoder.decode(before); newText = decoder.decode(after); }
  catch { return { ...result, unavailable: 'binary' }; }
  if ((await fingerprint(dir, file)).value !== selected.fingerprint) throw new GitEngineError('invalid', staleMessage);
  const diff = diffLines(oldText, newText);
  return diff ? { ...result, ...diff } : { ...result, unavailable: 'large' };
}

/** Builds a private index, then atomically replaces only metadata under normal Git locks.
 * The working directory is never checked out, reset, removed or rewritten here. */
export async function commitSelectedChanges(dir: string, author: GitAuthor, message: string, selection: LocalPublishSelection,
  rescan: () => Promise<ChangeSnapshot>): Promise<{ head: string; changed: number }> {
  const gitdir = join(dir, '.git');
  const gitInfo = await lstat(gitdir);
  if (!gitInfo.isDirectory() || gitInfo.isSymbolicLink()) throw new GitEngineError('unsupported', '这个项目的本地保存方式暂时不支持按文件发布。');
  const branch = await git.currentBranch({ fs, dir });
  if (!branch || !safeChangePath(branch)) throw new GitEngineError('unsupported', '暂时无法确认项目的当前工作版本。');
  const indexPath = join(gitdir, 'index'); const indexLock = `${indexPath}.lock`;
  const refPath = join(gitdir, 'refs', 'heads', branch); const refLock = `${refPath}.lock`;
  const tempIndex = join(gitdir, `easyhub-index-${randomUUID()}`); const marker = join(gitdir, 'easyhub-publish-incomplete');
  let indexHeld = false; let refHeld = false; let markerCreated = false; let finished = false;
  let indexHandle: Awaited<ReturnType<typeof open>> | undefined; let refHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    try { indexHandle = await open(indexLock, 'wx'); indexHeld = true; await mkdir(dirname(refPath), { recursive: true }); refHandle = await open(refLock, 'wx'); refHeld = true; }
    catch { throw new GitEngineError('unsupported', '另一个工具正在保存这个项目，请稍后刷新再发布。'); }
    const current = await rescan();
    if (current.branch !== branch) throw new GitEngineError('invalid', staleMessage);
    if (current.preview.needsReview) throw new GitEngineError('unsupported', '这个文件夹有其他工具准备的修改，请先在该工具中完成或取消。');
    if (current.preview.snapshot !== selection.snapshot) throw new GitEngineError('invalid', staleMessage);
    if (!selection.paths.length || new Set(selection.paths).size !== selection.paths.length || selection.paths.some((path) => !current.files.some((entry) => entry.file.path === path)))
      throw new GitEngineError('invalid', '请重新选择本次要发布的文件。');
    const originalIndex = await readFile(indexPath).catch((error: unknown) => { if (missing(error)) return null; throw error; });
    if (originalIndex) await writeFile(tempIndex, originalIndex, { flag: 'wx' });
    const promises = new Proxy(fs.promises, { get(target, key) {
      const method = Reflect.get(target, key);
      if (typeof method !== 'function') return method;
      return (...args: unknown[]) => {
        const path = args[0];
        if (typeof path === 'string' && resolve(path) === resolve(indexPath)) args[0] = tempIndex;
        return Reflect.apply(method, target, args);
      };
    } });
    const isolated = { promises };
    for (const path of selection.paths) {
      const entry = current.files.find((item) => item.file.path === path)!;
      const file = entry.file;
      if (file.previousPath) await git.updateIndex({ fs: isolated, dir, filepath: file.previousPath, remove: true, force: true });
      if (file.kind === 'deleted') await git.updateIndex({ fs: isolated, dir, filepath: path, remove: true, force: true });
      else {
        const details = await inspectPath(dir, path);
        if (!details || details.size > 100 * 1024 * 1024) throw new GitEngineError('unsupported', '单个文件过大或已变化，请刷新后检查；大文件可以作为发行版附件上传。');
        const bytes = await readFile(join(dir, path));
        if (bytes.length > 100 * 1024 * 1024 || `${entry.mode}:${createHash('sha256').update(bytes).digest('hex')}` !== entry.fingerprint) throw new GitEngineError('invalid', staleMessage);
        const oid = await git.writeBlob({ fs, dir, blob: bytes });
        let mode = entry.mode;
        if (process.platform === 'win32' && current.head && file.kind !== 'added') {
          const tree = await git.readTree({ fs, dir, oid: current.head, filepath: dirname(file.previousPath ?? path) === '.' ? undefined : dirname(file.previousPath ?? path).replaceAll('\\', '/') });
          const previous = tree.tree.find((item) => item.path === (file.previousPath ?? path).split('/').at(-1));
          if (previous?.mode === '100755') mode = 0o100755;
        }
        await git.updateIndex({ fs: isolated, dir, filepath: path, oid, mode, add: true });
      }
    }
    const head = await git.commit({ fs: isolated, dir, message, author, noUpdateBranch: true, parent: current.head ? [current.head] : [] });
    const verified = await rescan();
    const indexNow = await readFile(indexPath).catch((error: unknown) => { if (missing(error)) return null; throw error; });
    if (verified.branch !== branch || verified.preview.snapshot !== selection.snapshot || verified.preview.needsReview || !Buffer.from(originalIndex ?? '').equals(Buffer.from(indexNow ?? '')))
      throw new GitEngineError('invalid', staleMessage);
    await writeFile(marker, JSON.stringify({ before: current.head, head }), { flag: 'wx' }); markerCreated = true;
    await writeFile(join(gitdir, 'easyhub-publish-pending.json'), JSON.stringify({ head, snapshot: selection.snapshot, paths: selection.paths, message }));
    await indexHandle!.writeFile(await readFile(tempIndex)); await indexHandle!.sync(); await indexHandle!.close(); indexHandle = undefined;
    await refHandle!.writeFile(`${head}\n`); await refHandle!.sync(); await refHandle!.close(); refHandle = undefined;
    await rename(indexLock, indexPath); indexHeld = false;
    await rename(refLock, refPath); refHeld = false;
    finished = true;
    await rm(marker, { force: true }); markerCreated = false;
    return { head, changed: selection.paths.length };
  } catch (error) {
    if (markerCreated && !finished) throw new GitEngineError('unsupported', '本地版本保存未完成，文件内容已保留。请先备份项目并检查后再发布。');
    throw error;
  } finally {
    await indexHandle?.close(); await refHandle?.close();
    if (indexHeld) await rm(indexLock, { force: true });
    if (refHeld) await rm(refLock, { force: true });
    await rm(tempIndex, { force: true });
  }
}
