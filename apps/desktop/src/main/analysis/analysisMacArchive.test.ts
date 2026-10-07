import { afterEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { c as createTar } from 'tar';
import { extractRuntimeArchive } from './analysisArchive';

const roots: string[] = [];
async function temporary(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'easyhub-mac-archive-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
function storedZip(name: string, data: Buffer, mode = 0o100644): Buffer {
  const filename = Buffer.from(name);
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, filename, end]);
}

describe.skipIf(process.platform !== 'darwin')('macOS runtime archive safety', () => {
  it('retains native decompiler executable permission without privileged mode bits', async () => {
    const root = await temporary();
    await writeFile(join(root, 'native.zip'), storedZip('ghidra/os/mac_arm_64/decompile', Buffer.from('native fixture'), 0o104755));
    await extractRuntimeArchive(join(root, 'native.zip'), join(root, 'unpacked'), 4096);
    const path = join(root, 'unpacked/ghidra/os/mac_arm_64/decompile');
    expect(await readFile(path, 'utf8')).toBe('native fixture');
    expect((await stat(path)).mode & 0o7777).toBe(0o755);
  });
  it.each(['../escape', '/absolute', 'nested/../escape', 'nested\\escape', 'nested/file:stream'])('rejects ZIP path %s before writing', async name => {
    const root = await temporary();
    await writeFile(join(root, 'unsafe.zip'), storedZip(name, Buffer.from('unsafe')));
    await expect(extractRuntimeArchive(join(root, 'unsafe.zip'), join(root, 'unpacked'), 4096)).rejects.toThrow();
    expect(await readdir(join(root, 'unpacked'))).toEqual([]);
  });
  it('rejects ZIP links and inflated content over the declared bound', async () => {
    const root = await temporary();
    await writeFile(join(root, 'link.zip'), storedZip('escape', Buffer.from('../outside'), 0o120777));
    await expect(extractRuntimeArchive(join(root, 'link.zip'), join(root, 'link'), 4096)).rejects.toThrow('链接');
    await writeFile(join(root, 'oversize.zip'), storedZip('large', Buffer.alloc(128)));
    await expect(extractRuntimeArchive(join(root, 'oversize.zip'), join(root, 'oversize'), 64)).rejects.toThrow('大小上限');
  });
  it('extracts the Java bundle TAR with executable mode and rejects symbolic links', async () => {
    const root = await temporary(); const source = join(root, 'source');
    await mkdir(join(source, 'jdk/Contents/Home/bin'), { recursive: true });
    await writeFile(join(source, 'jdk/Contents/Home/bin/java'), 'fixture java');
    await chmod(join(source, 'jdk/Contents/Home/bin/java'), 0o755);
    await createTar({ cwd: source, file: join(root, 'java.tar.gz'), gzip: true }, ['jdk']);
    await extractRuntimeArchive(join(root, 'java.tar.gz'), join(root, 'unpacked'), 4096);
    expect((await stat(join(root, 'unpacked/jdk/Contents/Home/bin/java'))).mode & 0o111).toBe(0o111);
    await symlink('../outside', join(source, 'unsafe'));
    await createTar({ cwd: source, file: join(root, 'link.tar.gz'), gzip: true }, ['unsafe']);
    await expect(extractRuntimeArchive(join(root, 'link.tar.gz'), join(root, 'link'), 4096)).rejects.toThrow('链接');
  });
  it('honors cancellation before touching the extraction directory', async () => {
    const root = await temporary(); const controller = new AbortController(); controller.abort();
    await writeFile(join(root, 'cancel.zip'), storedZip('file', Buffer.from('fixture')));
    await expect(extractRuntimeArchive(join(root, 'cancel.zip'), join(root, 'unpacked'), 4096, controller.signal)).rejects.toThrow('取消');
    expect(await readdir(root)).toEqual(['cancel.zip']);
  });
});
