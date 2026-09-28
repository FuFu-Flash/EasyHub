import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetchDnsCandidates, fetchHostMappings, HOSTS_FALLBACK, HOSTS_SOURCE, hostsStatus, parseUpstreamHosts, selectUsableMappings, updateHosts } from './hostsRepair';

const upstream = `#Github Hosts Start
#Update Time: 2026-09-27
140.82.114.4 github.com
140.82.112.6 api.github.com
185.199.109.133 raw.githubusercontent.com
185.199.111.133 avatars.githubusercontent.com
#Github Hosts End`;

describe('Hosts repair', () => {
  it('accepts only fresh GitHub addresses from the expected source format', () => {
    expect(parseUpstreamHosts(upstream, new Date('2026-09-27T12:00:00Z')).lines).toHaveLength(4);
    expect(() => parseUpstreamHosts(upstream.replace('github.com', 'example.com'), new Date('2026-09-27T12:00:00Z'))).toThrow();
    expect(() => parseUpstreamHosts(upstream.replace('140.82.114.4', '127.0.0.1'), new Date('2026-09-27T12:00:00Z'))).toThrow();
    expect(() => parseUpstreamHosts(upstream, new Date('2026-10-10T12:00:00Z'))).toThrow();
  });

  it('uses the same repository through a CDN when the GitHub API is unreachable', async () => {
    const visited: string[] = [];
    const lines = await fetchHostMappings(async (url) => {
      visited.push(url);
      if (url === HOSTS_SOURCE) throw new Error('offline');
      return new Response(upstream.replace('2026-09-27', new Date().toISOString().slice(0, 10)), { status: 200 });
    });
    expect(visited).toEqual([HOSTS_SOURCE, HOSTS_FALLBACK]);
    expect(lines).toContain('140.82.114.4 github.com');
  });

  it('keeps working regional DNS and writes only reachable replacement addresses', async () => {
    const lines = parseUpstreamHosts(upstream, new Date('2026-09-27T12:00:00Z')).lines;
    const checked: string[] = [];
    const selected = await selectUsableMappings(lines, async (domain, address) => {
      checked.push(`${domain}:${address ?? 'system'}`);
      return domain === 'github.com' ? address !== null : address === null;
    });
    expect(selected).toEqual(['140.82.114.4 github.com']);
    expect(checked).toContain('api.github.com:system');
    expect(checked).not.toContain('api.github.com:140.82.112.6');
  });

  it('rejects a source address when the OAuth POST cannot reach GitHub', async () => {
    const lines = parseUpstreamHosts(upstream, new Date('2026-09-27T12:00:00Z')).lines;
    await expect(selectUsableMappings(lines, async () => false)).rejects.toThrow('Hosts 只能更换地址');
  });

  it('uses a verified DNS over HTTPS address when the published mapping is stale', async () => {
    const selected = await selectUsableMappings(parseUpstreamHosts(upstream, new Date('2026-09-27T12:00:00Z')).lines,
      async (domain, address) => domain === 'github.com' ? address === '20.205.243.166' : address === null,
      async () => ['20.205.243.166']);
    expect(selected).toEqual(['20.205.243.166 github.com']);
  });

  it('keeps an existing working Hosts entry during refresh', async () => {
    const lines = parseUpstreamHosts(upstream, new Date('2026-09-27T12:00:00Z')).lines;
    const selected = await selectUsableMappings(lines, async () => true, undefined,
      ['140.82.114.4 github.com']);
    expect(selected).toEqual(['140.82.114.4 github.com']);
  });

  it('accepts only public IPv4 answers for the requested DNS record', async () => {
    const addresses = await fetchDnsCandidates('api.github.com', async (url) => new Response(JSON.stringify({
      Status: 0, Answer: [{ type: 1, data: url.includes('alidns') ? '20.205.243.168' : '127.0.0.1' },
        { type: 1, data: '192.168.1.1' }, { type: 28, data: '2001:db8::1' }],
    }), { status: 200 }));
    expect(addresses).toEqual(['20.205.243.168']);
  });

  it('adds and removes only the managed block, preserving original bytes', () => {
    const original = Buffer.from('\ufeff# Local notes\r\n127.0.0.1 localhost\r\n', 'utf8');
    const lines = parseUpstreamHosts(upstream, new Date('2026-09-27T12:00:00Z')).lines;
    const changed = updateHosts(original, lines, '2026-09-27T12:00:00.000Z');
    expect(hostsStatus(changed).enabled).toBe(true);
    expect(updateHosts(changed, lines, '2026-09-28T12:00:00.000Z')).toEqual(changed);
    expect(updateHosts(changed, null, '')).toEqual(original);
  });

  it('refuses malformed or unsupported existing Hosts files', () => {
    const lines = parseUpstreamHosts(upstream, new Date('2026-09-27T12:00:00Z')).lines;
    expect(() => updateHosts(Buffer.from('# EasyHub GitHub Hosts Start\n'), lines, 'now')).toThrow();
    expect(() => updateHosts(Buffer.from([0xff, 0xfe, 0x41, 0]), lines, 'now')).toThrow();
  });

  it.skipIf(process.platform !== 'win32')('elevated helper safely replaces a temporary Hosts file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'easyhub-hosts-test-'));
    try {
      const hostsPath = join(root, 'hosts');
      const helperPath = join(root, 'helper.ps1');
      const payloadPath = join(root, 'payload.json');
      const resultPath = join(root, 'result.json');
      const before = Buffer.from('127.0.0.1 localhost\r\n');
      const after = Buffer.from('# EasyHub GitHub Hosts Start\r\n140.82.114.4 github.com\r\n# EasyHub GitHub Hosts End\r\n127.0.0.1 localhost\r\n');
      await writeFile(hostsPath, before);
      const source = await readFile(join(process.cwd(), 'resources', 'hosts-repair.ps1'), 'utf8');
      const targetLine = "$hostsPath = Join-Path $systemRoot 'System32\\drivers\\etc\\hosts'";
      expect(source).toContain(targetLine);
      const copy = source.replace(targetLine, `$hostsPath = '${hostsPath.replace(/'/gu, "''")}'`)
        .replace('try { & ipconfig.exe /flushdns | Out-Null } catch { }', '');
      await writeFile(helperPath, copy, 'utf8');
      await writeFile(payloadPath, JSON.stringify({ expected: createHash('sha256').update(before).digest('hex'), content: after.toString('base64'), resultPath }));
      const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath, '-PayloadPath', payloadPath], { encoding: 'utf8' });
      const helperResult = await readFile(resultPath, 'utf8').catch(() => 'No result file');
      expect(run.status, `${run.stderr}\n${helperResult}`).toBe(0);
      expect(await readFile(hostsPath)).toEqual(after);
      expect(JSON.parse((await readFile(resultPath, 'utf8')).replace(/^\ufeff/u, '')).ok).toBe(true);
      const stale = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath, '-PayloadPath', payloadPath], { encoding: 'utf8' });
      expect(stale.status).toBe(1);
      expect(await readFile(hostsPath)).toEqual(after);
    } finally {
      if (resolve(root).startsWith(resolve(tmpdir()) + sep) && basename(root).startsWith('easyhub-hosts-test-')) await rm(root, { recursive: true, force: true });
    }
  });
});
