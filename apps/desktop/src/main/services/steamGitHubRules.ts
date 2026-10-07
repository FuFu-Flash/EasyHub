import { isIP } from 'node:net';
import type { OriginRule } from './githubProxyOrigin';

/**
 * GitHub routing data interoperable with Watt Toolkit / SteamTools.
 * Upstream: BeyondDimension/SteamTools, GPL-3.0, commit
 * d04213147e77a8d73277fa8b86eeecfa444df071.
 * https://github.com/BeyondDimension/SteamTools/blob/d04213147e77a8d73277fa8b86eeecfa444df071/src/BD.WTTS.Client.Plugins.Accelerator.ReverseProxy/Services.Implementation/Http/ReverseProxyHttpClientHandler.cs
 * Snapshot: https://api.steampp.net/accelerator/projectgroups, 2026-10-01.
 * This is a new TypeScript parser for public configuration, not copied SDK code.
 * Certificate-verification overrides from upstream are deliberately discarded.
 */
const allowedHosts = new Set([
  'github.com', 'www.github.com', 'api.github.com', 'uploads.github.com', 'codeload.github.com',
  'pages.github.com', 'gist.github.com', 'raw.github.com', 'githubusercontent.com',
  'raw.githubusercontent.com', 'gist.githubusercontent.com', 'cloud.githubusercontent.com',
  'avatars.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com',
  'github-releases.githubusercontent.com', 'media.githubusercontent.com', 'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com', 'camo.githubusercontent.com', 'desktop.githubusercontent.com',
  'github.githubassets.com', 'opengraph.githubassets.com', 'support-assets.githubassets.com',
]);
const allowedDnsAliases = new Set([
  'githubapi.rmbgame.net', 'githubdocs.rmbgame.net',
]);

function allowedHost(host: string): boolean {
  return allowedHosts.has(host) || /^avatars[0-9]\.githubusercontent\.com$/u.test(host);
}

function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254) &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0)) &&
    !(a === 192 && b === 88 && c === 99) && !(a === 198 && (b === 18 || b === 19)) &&
    !(a === 198 && b === 51 && c === 100) && !(a === 203 && b === 0 && c === 113);
}

function dnsName(value: string): boolean {
  if (value.length > 253 || !value.includes('.') || isIP(value)) return false;
  return value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function domains(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > 4096) return [];
  return value.split(';').slice(0, 64).map(domain => domain.trim().toLowerCase()).filter(allowedHost);
}

/**
 * Parse only local HTTPS routes to known GitHub origins. The upstream "Local"
 * route keeps the original HTTP Host and changes only its TCP target / TLS SNI.
 * Empty SNI is distinct from an absent rule. HTTP relays and redirect rules are
 * never used for authenticated GitHub requests.
 */
export function parseSteamGitHubRules(value: unknown): Record<string, OriginRule> {
  const result: Record<string, OriginRule> = {};
  let content: unknown = value;
  if (record(value)) {
    if (value['🦄'] !== 200 || !Array.isArray(value['🦓'])) return result;
    content = value['🦓'];
  }
  if (!Array.isArray(content)) return result;
  let remaining = 256;
  const visit = (nodes: unknown[], depth: number): void => {
    if (depth > 8) return;
    for (const node of nodes.slice(0, 64)) {
      if (--remaining < 0) return;
      if (!record(node)) continue;
      if (Array.isArray(node.Items)) visit(node.Items, depth + 1);
      if (node.ProxyType !== 0 || node.Port !== 443 || typeof node.ForwardDomainNames !== 'string' ||
          node.FakeServerName !== null && typeof node.FakeServerName !== 'string') continue;
      const target = node.ForwardDomainNames.trim().toLowerCase();
      const address = publicIPv4(target);
      const alias = dnsName(target) && (allowedHost(target) || allowedDnsAliases.has(target));
      if (!address && !alias) continue;
      const servername = node.FakeServerName ?? '';
      if (servername !== '' && servername !== 'Github' && servername !== '@domain' &&
          !(dnsName(servername.toLowerCase()) && allowedHost(servername.toLowerCase()))) continue;
      const hosts = new Set([...domains(node.MatchDomainNames), ...domains(node.ListenDomainNames)]);
      for (const host of hosts) {
        const resolvedServername = servername === '@domain' ? host : servername;
        if (resolvedServername !== '' && resolvedServername !== 'Github' && resolvedServername.toLowerCase() !== host) continue;
        // Nested / earlier rules take precedence over broad parent matches.
        result[host] ??= { ...(address ? { addresses: [target] } : { dnsName: target }),
          servername: resolvedServername };
      }
    }
  };
  visit(content, 0);
  return result;
}

// Public upstream snapshot. Modern hosts absent from this snapshot retain their
// original DNS routes; they are never silently redirected to an unrelated IP.
export const DEFAULT_GITHUB_RULES: Record<string, OriginRule> = {
  'github.com': { addresses: ['20.207.73.82'], servername: '' },
  'pages.github.com': { addresses: ['20.207.73.82'], servername: '' },
  'gist.github.com': { addresses: ['20.207.73.82'], servername: '' },
  'api.github.com': { dnsName: 'githubapi.rmbgame.net', servername: '' },
  'uploads.github.com': { dnsName: 'uploads.github.com', servername: '' },
  'github.githubassets.com': { dnsName: 'githubdocs.rmbgame.net', servername: '' },
  'support-assets.githubassets.com': { dnsName: 'githubdocs.rmbgame.net', servername: '' },
  ...Object.fromEntries([
    'raw.github.com', 'githubusercontent.com', 'raw.githubusercontent.com', 'camo.githubusercontent.com',
    'cloud.githubusercontent.com', 'avatars.githubusercontent.com', 'avatars0.githubusercontent.com',
    'avatars1.githubusercontent.com', 'avatars2.githubusercontent.com', 'avatars3.githubusercontent.com',
    'user-images.githubusercontent.com', 'objects.githubusercontent.com', 'private-user-images.githubusercontent.com',
  ].map(host => [host, { addresses: ['23.235.37.133'], servername: 'Github' }])),
};
