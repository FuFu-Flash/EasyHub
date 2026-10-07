import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { request } from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { MacProxyService, isGitHubProxyURL, proxyAgentForURL, proxyURLFromPAC } from './macProxyService';

describe('GitHub PAC routing', () => {
  it('uses SOCKS5h before the compatibility SOCKS result and preserves DIRECT order', () => {
    expect(proxyURLFromPAC('SOCKS5 127.0.0.1:8868; SOCKS 127.0.0.1:8868')).toBe('socks5h://127.0.0.1:8868');
    expect(proxyURLFromPAC('DIRECT; SOCKS5 127.0.0.1:8868')).toBeUndefined();
    expect(proxyURLFromPAC('PROXY localhost:3128; DIRECT')).toBe('http://localhost:3128');
    expect(proxyURLFromPAC('HTTPS localhost:443')).toBe('https://localhost:443');
    expect(() => proxyURLFromPAC('SOCKS5 localhost:65536')).toThrow('端口');
  });

  it('keeps hostname DNS inside SOCKS for Git requests and release uploads', () => {
    for (const destination of ['https://github.com/owner/repo.git', 'https://uploads.github.com/repos/owner/repo/releases/1/assets']) {
      const agent = proxyAgentForURL('socks5://127.0.0.1:8868', destination);
      expect(agent).toBeInstanceOf(SocksProxyAgent);
      if (!(agent instanceof SocksProxyAgent)) throw new Error('Missing SOCKS agent');
      expect(agent.shouldLookup).toBe(false);
      expect(agent.proxy).toMatchObject({ host: '127.0.0.1', port: 8868, type: 5 });
    }
    expect(proxyAgentForURL('https://localhost:3128', 'https://github.com/owner/repo.git')).toBeInstanceOf(HttpsProxyAgent);
  });

  it('refuses suffix lookalikes and never proxies unrelated hosts', () => {
    for (const host of ['github.com.attacker.test', 'evil-github.com', 'notgithubusercontent.com', 'example.com']) {
      const url = `https://${host}/`;
      expect(isGitHubProxyURL(url)).toBe(false);
      expect(proxyAgentForURL('socks5h://127.0.0.1:8868', url)).toBeUndefined();
    }
    expect(isGitHubProxyURL('https://api.github.com/')).toBe(true);
    expect(isGitHubProxyURL('https://raw.githubusercontent.com/')).toBe(true);
    expect(isGitHubProxyURL('https://GitHub.COM./')).toBe(true);
    expect(isGitHubProxyURL('file:///github.com')).toBe(false);
  });

  it('sends the original GitHub upload hostname through a real local SOCKS handshake', async () => {
    const connections = new Set<Socket>();
    let observed: (host: string) => void = () => undefined;
    const hostname = new Promise<string>((resolve) => { observed = resolve; });
    const server = createServer((socket) => {
      connections.add(socket);
      socket.on('close', () => connections.delete(socket));
      let greeting = true;
      let bytes = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        bytes = Buffer.concat([bytes, chunk]);
        if (greeting && bytes.length >= 3) {
          expect(bytes.subarray(0, 3)).toEqual(Buffer.from([5, 1, 0]));
          bytes = bytes.subarray(3); greeting = false;
          socket.write(Buffer.from([5, 0]));
        }
        if (!greeting && bytes.length >= 5 && bytes.length >= 7 + bytes[4]!) {
          expect(bytes[3]).toBe(3);
          observed(bytes.subarray(5, 5 + bytes[4]!).toString('ascii'));
          // Reject locally: the test never establishes any public connection.
          socket.end(Buffer.from([5, 2, 0, 1, 0, 0, 0, 0, 0, 0]));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing local fixture port');
      const agent = proxyAgentForURL(`socks5h://127.0.0.1:${address.port}`, 'https://uploads.github.com/assets');
      const rejected = new Promise<void>((resolve, reject) => {
        const upload = request('https://uploads.github.com/assets', { method: 'POST', agent }, () => reject(new Error('Unexpected public response')));
        upload.once('error', () => resolve());
        upload.setTimeout(3000, () => upload.destroy(new Error('Local fixture timed out')));
        upload.end();
      });
      expect(await hostname).toBe('uploads.github.com');
      await rejected;
    } finally {
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe.skipIf(process.platform !== 'darwin')('MacProxyService isolated helper integration', () => {
  let resources = '';
  let service: MacProxyService;

  beforeAll(async () => {
    resources = await mkdtemp(join(tmpdir(), 'easyhub-mac-helper-service-'));
    const executable = join(resources, 'debug-helper');
    const build = fileURLToPath(new URL('../../../../../mac-helper/build-helper.sh', import.meta.url));
    await promisify(execFile)('/bin/bash', [build, executable, '--debug'], { timeout: 60000 });
    const quoted = `'${executable.replace(/'/g, "'\\''")}'`;
    await writeFile(join(resources, 'easyhub-proxy-helper'), `#!/bin/sh\nexec ${quoted} --test-fixture\n`, { mode: 0o700 });
    service = new MacProxyService(resources);
  }, 65000);

  afterAll(async () => {
    await service?.shutdown();
    if (resources) await rm(resources, { recursive: true, force: true });
  });

  it('starts only on enable, reports real responses, stops, reconnects and shuts down', async () => {
    expect((await service.status()).status).toBe('disconnected');
    await expect(service.probe()).rejects.toThrow('先开启');
    const connected = await service.setEnabled(true);
    expect(connected).toMatchObject({ status: 'connected', socksPort: 8868, pacURL: 'http://127.0.0.1:8869/github.pac', domains: 1 });
    expect((await service.status()).status).toBe('connected');
    let changes = 0;
    service.onChange = () => { changes += 1; };
    await service.status(); await service.status();
    expect(changes).toBe(0);
    expect((await service.probe()).lastProbe).toMatch(/^GitHub HTTP 200 · \d+ ms$/);
    expect((await service.setEnabled(false)).status).toBe('disconnected');
    await expect(service.probe()).rejects.toThrow('先开启');
    expect((await service.setEnabled(true)).status).toBe('connected');
    await service.shutdown();
    expect((await service.status()).status).toBe('disconnected');
  }, 20000);

  it('returns an actual availability error for a missing helper', async () => {
    const missing = new MacProxyService(join(resources, 'missing'));
    expect((await missing.status()).status).toBe('unavailable');
    await expect(missing.setEnabled(true)).rejects.toThrow('未安装');
    await missing.shutdown();
  });
});
