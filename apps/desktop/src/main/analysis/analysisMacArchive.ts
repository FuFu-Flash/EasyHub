import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { open as openZip, type Entry, type ZipFile } from 'yauzl';
import { x as unpackTar } from 'tar';
import { throwIfAborted } from './analysisDownloads';

function archivePath(root: string, name: string): string {
  if (!name || isAbsolute(name) || /[\\:\x00-\x1f]/u.test(name)
    || name.replace(/\/$/u, '').split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('分析组件归档包含不安全的路径');
  }
  const target = resolve(root, name);
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('分析组件归档路径超出安装目录');
  }
  return target;
}

async function zipArchive(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => openZip(path,
    { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
    (error, zip) => error || !zip ? reject(error ?? new Error('ZIP 无效')) : resolveZip(zip)));
}

/** ZIP central-directory validation precedes all writes; extracted executables
 * retain only their ordinary execute bits, never setuid/setgid attributes. */
async function extractZip(path: string, root: string, maximum: number, signal?: AbortSignal): Promise<void> {
  const zip = await zipArchive(path);
  try {
    const entries = await new Promise<Entry[]>((resolveEntries, reject) => {
      const records: Entry[] = [];
      const seen = new Set<string>();
      let bytes = 0;
      const fail = (error: unknown) => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('entry', (entry: Entry) => {
        try {
          throwIfAborted(signal);
          const target = archivePath(root, entry.fileName);
          const mode = entry.externalFileAttributes >>> 16;
          if ((mode & 0o170000) === 0o120000 || (entry.generalPurposeBitFlag & 1)) throw new Error('分析组件 ZIP 不允许符号链接或加密内容');
          const key = target.replace(/\/$/u, '').toLowerCase();
          if (seen.has(key)) throw new Error('分析组件 ZIP 包含重复路径');
          seen.add(key);
          bytes += entry.uncompressedSize;
          if (seen.size > 100_000 || !Number.isSafeInteger(bytes) || bytes > maximum) throw new Error('分析组件 ZIP 超过解压大小上限');
          records.push(entry);
          zip.readEntry();
        } catch (error) { fail(error); }
      });
      zip.on('end', () => resolveEntries(records));
      zip.readEntry();
    });
    let written = 0;
    for (const entry of entries) {
      throwIfAborted(signal);
      const target = archivePath(root, entry.fileName);
      if (entry.fileName.endsWith('/')) { await mkdir(target, { recursive: true }); continue; }
      await mkdir(dirname(target), { recursive: true });
      const stream = await new Promise<import('node:stream').Readable>((resolveStream, reject) => {
        zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error ?? new Error('ZIP 数据无效')) : resolveStream(stream));
      });
      let fileBytes = 0;
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length; fileBytes += chunk.length;
        callback(written > maximum || fileBytes > entry.uncompressedSize ? new Error('分析组件 ZIP 实际内容超过大小上限') : null, chunk);
      } });
      await pipeline(stream, limit, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
      if (fileBytes !== entry.uncompressedSize) throw new Error('分析组件 ZIP 文件长度不符');
      await chmod(target, ((entry.externalFileAttributes >>> 16) & 0o111) ? 0o755 : 0o644);
    }
  } finally { zip.close(); }
}

async function extractTar(path: string, root: string, maximum: number, signal?: AbortSignal): Promise<void> {
  let bytes = 0;
  let records = 0;
  let inflated = 0;
  const seen = new Set<string>();
  const extractor = unpackTar({ cwd: root, strict: true, preservePaths: false, preserveOwner: false,
    filter(name, entry) {
      throwIfAborted(signal);
      const target = archivePath(root, name);
      if (!('type' in entry) || !['File', 'Directory'].includes(entry.type)) throw new Error('分析组件 TAR 不允许链接或设备文件');
      const key = target.toLowerCase();
      if (seen.has(key)) throw new Error('分析组件 TAR 包含重复路径');
      seen.add(key);
      bytes += entry.size;
      records++;
      if (records > 100_000 || !Number.isSafeInteger(bytes) || bytes > maximum) throw new Error('分析组件 TAR 超过解压大小上限');
      return true;
    },
  });
  // Bound gzip expansion including metadata/padding, independently of TAR sizes.
  const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    inflated += chunk.length;
    callback(inflated > maximum + 64 * 1024 ** 2 ? new Error('分析组件 TAR 实际内容超过大小上限') : null, chunk);
  } });
  // node-tar's Unpack is a Minipass sink without Node's destroy() contract.
  // Adapt it explicitly so pipeline cancellation/error keeps the real cause.
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try {
        if (extractor.write(chunk)) callback();
        else extractor.once('drain', callback);
      } catch (error) { callback(error instanceof Error ? error : new Error(String(error))); }
    },
    final(callback) {
      extractor.once('close', () => callback());
      extractor.end();
    },
    destroy(error, callback) {
      if (error) extractor.abort(error);
      callback(error);
    },
  });
  extractor.on('error', error => sink.destroy(error));
  await pipeline(createReadStream(path), createGunzip(), limit, sink, { signal });
}

export async function extractMacRuntimeArchive(archive: string, destination: string, maximum: number, signal?: AbortSignal): Promise<void> {
  if (archive.endsWith('.tar.gz')) await extractTar(archive, destination, maximum, signal);
  else if (archive.endsWith('.zip')) await extractZip(archive, destination, maximum, signal);
  else throw new Error('不支持的分析组件归档格式');
}
