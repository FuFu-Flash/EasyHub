import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export const HOSTS_SOURCE = 'https://api.github.com/repos/maxiaof/github-hosts/contents/hosts?ref=master';
export const HOSTS_FALLBACK = 'https://cdn.jsdelivr.net/gh/maxiaof/github-hosts@master/hosts';
const START = '# EasyHub GitHub Hosts Start';
const END = '# EasyHub GitHub Hosts End';
const managedDomains = new Set([
  'github.com', 'api.github.com', 'raw.githubusercontent.com', 'gist.github.com',
  'codeload.github.com', 'github.global.ssl.fastly.net', 'assets-cdn.github.com',
  'github.githubassets.com', 'avatars.githubusercontent.com', 'user-images.githubusercontent.com',
  'objects.githubusercontent.com', 'media.githubusercontent.com', 'private-user-images.githubusercontent.com',
  'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com',
  'alive.github.com', 'live.github.com', 'central.github.com', 'desktop.githubusercontent.com',
  'camo.githubusercontent.com', 'github.map.fastly.net', 'github.io', 'github.blog',
  'favicons.githubusercontent.com', 'github-cloud.s3.amazonaws.com', 'github-com.s3.amazonaws.com',
  'githubstatus.com', 'github.community', 'github.dev', 'collector.github.com',
  'pipelines.actions.githubusercontent.com', 'cloud.githubusercontent.com',
]);

export interface HostsRepairStatus { enabled: boolean; updatedAt: string | null; source: string }

function allowedDomain(domain: string): boolean {
  return managedDomains.has(domain) || /^avatars[0-9]\.githubusercontent\.com$/u.test(domain) ||
    /^github-production-(?:release-asset|user-asset|repository-file)-[a-z0-9-]+\.s3\.amazonaws\.com$/u.test(domain);
}

function safeIPv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const [first = 0, second = 0] = value.split('.').map(Number);
  return first !== 0 && first !== 10 && first !== 127 && first < 224 &&
    !(first === 169 && second === 254) && !(first === 172 && second >= 16 && second <= 31) &&
    !(first === 192 && second === 168) && !(first === 100 && second >= 64 && second <= 127) &&
    !(first === 198 && (second === 18 || second === 19));
}

export function parseUpstreamHosts(raw: string, now = new Date()): { lines: string[]; date: string } {
  if (raw.length > 65536 || !raw.includes('#Github Hosts Start') || !raw.includes('#Github Hosts End')) throw new Error('地址数据无效，请稍后重试。');
  const date = raw.match(/^#Update Time:\s*(\d{4}-\d{2}-\d{2})\s*$/mu)?.[1];
  if (!date || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || Math.abs(now.getTime() - Date.parse(`${date}T00:00:00Z`)) > 8 * 86400000) {
    throw new Error('地址数据已过期，请稍后重试。');
  }
  const domains = new Set<string>();
  const lines: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/u);
    const [address = '', domain = ''] = parts;
    if (parts.length !== 2 || !safeIPv4(address) || !allowedDomain(domain) || domains.has(domain)) {
      throw new Error('地址数据包含无效项目，未修改系统设置。');
    }
    domains.add(domain);
    lines.push(`${address} ${domain}`);
  }
  if (!domains.has('github.com') || !domains.has('api.github.com') || !domains.has('raw.githubusercontent.com') || lines.length > 100) {
    throw new Error('地址数据不完整，未修改系统设置。');
  }
  return { lines, date };
}

export async function fetchHostMappings(fetcher: (url: string, init: RequestInit) => Promise<Response>): Promise<string[]> {
  try {
    const response = await fetcher(HOSTS_SOURCE, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EasyHub' } });
    if (!response.ok) throw new Error('GitHub API unavailable');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('content' in body) || typeof body.content !== 'string' || !('encoding' in body) || body.encoding !== 'base64') {
      throw new Error('Invalid GitHub API response');
    }
    return parseUpstreamHosts(Buffer.from(body.content.replace(/\s/gu, ''), 'base64').toString('utf8')).lines;
  } catch {
    try {
      const response = await fetcher(HOSTS_FALLBACK, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('CDN unavailable');
      return parseUpstreamHosts(await response.text()).lines;
    } catch { throw new Error('暂时无法获取 GitHub 访问地址。请检查网络后重试。'); }
  }
}

function decodeHosts(input: Buffer): { text: string; bom: string; newline: string } {
  if (input[0] === 0xff && input[1] === 0xfe || input[0] === 0xfe && input[1] === 0xff || input.includes(0)) {
    throw new Error('系统 Hosts 文件格式暂不支持，请手动检查。');
  }
  const bom = input.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? '\ufeff' : '';
  const text = input.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(input) !== 0) throw new Error('系统 Hosts 文件编码暂不支持，请手动检查。');
  return { text: bom ? text.slice(1) : text, bom, newline: text.includes('\r\n') ? '\r\n' : '\n' };
}

function splitManaged(text: string): { before: string; block: string | null; after: string } {
  const starts = [...text.matchAll(/^# EasyHub GitHub Hosts Start\r?\n/gmu)];
  const ends = [...text.matchAll(/^# EasyHub GitHub Hosts End(?:\r?\n|$)/gmu)];
  if ((text.includes(START) && starts.length !== 1) || (text.includes(END) && ends.length !== 1)) {
    throw new Error('EasyHub 的 Hosts 区块已被修改，请手动检查。');
  }
  if (starts.length === 0 && ends.length === 0) return { before: text, block: null, after: '' };
  if (starts.length !== 1 || ends.length !== 1 || starts[0]!.index >= ends[0]!.index) throw new Error('EasyHub 的 Hosts 区块已被修改，请手动检查。');
  const start = starts[0]!.index;
  const end = ends[0]!.index + ends[0]![0].length;
  return { before: text.slice(0, start), block: text.slice(start, end), after: text.slice(end) };
}

export function hostsStatus(input: Buffer): HostsRepairStatus {
  const { text } = decodeHosts(input);
  const block = splitManaged(text).block;
  return { enabled: block !== null, updatedAt: block?.match(/^# Updated: (\d{4}-\d{2}-\d{2}T[^\r\n]+)$/mu)?.[1] ?? null,
    source: 'maxiaof/github-hosts' };
}

export function updateHosts(input: Buffer, lines: string[] | null, updatedAt: string): Buffer {
  const { text, bom, newline } = decodeHosts(input);
  const { before, after } = splitManaged(text);
  const original = before + after;
  if (lines === null) return Buffer.from(bom + original, 'utf8');
  const currentBlock = splitManaged(text).block;
  if (currentBlock && lines.every((line) => currentBlock.includes(`${newline}${line}${newline}`)) &&
    currentBlock.split(/\r?\n/u).filter((line) => /^\d+\.\d+\.\d+\.\d+ /u.test(line)).length === lines.length) return input;
  const block = [START, '# Source: maxiaof/github-hosts', `# Updated: ${updatedAt}`, ...lines, END, ''].join(newline);
  return Buffer.from(bom + block + original, 'utf8');
}

function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }

export class HostsRepairService {
  private readonly hostsPath: string;
  private readonly helperPath: string;
  private readonly workDir: string;
  private running = false;

  constructor(private readonly fetcher: (url: string, init: RequestInit) => Promise<Response>, resourcesPath: string, userData: string) {
    this.hostsPath = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
    this.helperPath = join(resourcesPath, 'hosts-repair.ps1');
    this.workDir = join(userData, 'hosts-repair');
  }

  async status(): Promise<HostsRepairStatus> {
    const content = await readFile(this.hostsPath).catch(() => { throw new Error('无法读取系统 Hosts 文件。'); });
    return hostsStatus(content);
  }

  async setEnabled(enabled: boolean): Promise<HostsRepairStatus> { return this.apply(enabled); }
  async refresh(): Promise<HostsRepairStatus> { return this.apply(true); }

  private async apply(enabled: boolean): Promise<HostsRepairStatus> {
    if (this.running) throw new Error('Hosts 修复正在进行，请稍候。');
    this.running = true;
    try {
      const before = await readFile(this.hostsPath).catch(() => { throw new Error('无法读取系统 Hosts 文件。'); });
      let lines: string[] | null = null;
      if (enabled) lines = await fetchHostMappings(this.fetcher);
      const after = updateHosts(before, lines, new Date().toISOString());
      if (before.equals(after)) return hostsStatus(before);
      await mkdir(this.workDir, { recursive: true });
      const id = `${process.pid}-${Date.now()}`;
      const payloadPath = join(this.workDir, `${id}.json`);
      const resultPath = join(this.workDir, `${id}.result.json`);
      await writeFile(payloadPath, JSON.stringify({ expected: sha256(before), content: after.toString('base64'), resultPath }), { flag: 'wx', mode: 0o600 });
      try {
        const quote = (value: string): string => `'${value.replace(/'/gu, "''")}'`;
        const command = `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',${quote(`\"${this.helperPath}\"`)},'-PayloadPath',${quote(`\"${payloadPath}\"`)}) | Out-Null`;
        await new Promise<void>((resolve, reject) => {
          const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true });
          let stderr = '';
          child.stderr.on('data', (data: Buffer) => { stderr += data.toString('utf8').slice(0, 1000); });
          child.once('error', reject);
          child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.includes('cancel') ? '已取消 Windows 管理员授权。' : '无法获得 Windows 管理员授权。')));
        });
        const resultText = await readFile(resultPath, 'utf8').catch(() => { throw new Error('Windows 未完成管理员授权，系统 Hosts 未修改。'); });
        let result: { ok?: boolean; error?: string };
        try { result = JSON.parse(resultText.replace(/^\ufeff/u, '')) as { ok?: boolean; error?: string }; }
        catch { throw new Error('无法确认 Hosts 修改结果，请重新打开设置检查状态。'); }
        if (!result.ok) throw new Error(result.error || '无法更新系统 Hosts 文件。');
        return this.status();
      } finally {
        await Promise.allSettled([rm(payloadPath, { force: true }), rm(resultPath, { force: true })]);
      }
    } finally { this.running = false; }
  }
}
