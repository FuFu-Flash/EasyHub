import { describe, expect, it } from 'vitest';
import { DEFAULT_GITHUB_RULES, parseSteamGitHubRules } from './steamGitHubRules';
import { GitHubOriginAgent } from './githubProxyOrigin';

function route(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { Name: 'Github Api', Port: 443, MatchDomainNames: 'api.github.com',
    ListenDomainNames: 'api.github.com', ForwardDomainNames: 'githubapi.rmbgame.net',
    IgnoreSSLCertVerification: true, FakeServerName: '', ProxyType: 0, Items: [], ...overrides };
}

describe('SteamTools GitHub routing configuration', () => {
  it('reads the public current API wrapper and preserves empty or literal SNI values', () => {
    expect(parseSteamGitHubRules({ '🦄': 200, '🦓': [{ Name: 'Github', Items: [route(), route({
      MatchDomainNames: 'githubusercontent.com;raw.github.com',
      ListenDomainNames: 'raw.githubusercontent.com;avatars.githubusercontent.com;objects.githubusercontent.com',
      ForwardDomainNames: '23.235.37.133', FakeServerName: 'Github',
    })] }] })).toEqual({
      'api.github.com': { dnsName: 'githubapi.rmbgame.net', servername: '' },
      'githubusercontent.com': { addresses: ['23.235.37.133'], servername: 'Github' },
      'raw.github.com': { addresses: ['23.235.37.133'], servername: 'Github' },
      'raw.githubusercontent.com': { addresses: ['23.235.37.133'], servername: 'Github' },
      'avatars.githubusercontent.com': { addresses: ['23.235.37.133'], servername: 'Github' },
      'objects.githubusercontent.com': { addresses: ['23.235.37.133'], servername: 'Github' },
    });
  });

  it('retains only routing fields and never accepts disabled certificate verification', () => {
    const parsed = parseSteamGitHubRules([route({ IgnoreSSLCertVerification: true, rejectUnauthorized: false })]);
    expect(parsed['api.github.com']).toEqual({ dnsName: 'githubapi.rmbgame.net', servername: '' });
    expect(Object.keys(parsed['api.github.com'] ?? {})).toEqual(['dnsName', 'servername']);
  });

  it('rejects redirects, remote relays, non-HTTPS ports, and malformed records', () => {
    for (const changed of [{ ProxyType: 1 }, { ProxyType: 4 }, { ProxyType: '0' }, { Port: 80 },
      { Port: '443' }, { ForwardDomainNames: 'https://githubapi.rmbgame.net/' },
      { ForwardDomainNames: 'http://pt.mossimo.net:41080/' }, { ForwardDomainNames: null },
      { FakeServerName: true }, { FakeServerName: undefined }, { FakeServerName: '@random' },
      { FakeServerName: 'github.com.evil.test' }]) {
      expect(parseSteamGitHubRules([route(changed)])).toEqual({});
    }
    for (const value of [null, undefined, 'json', {}, { '🦄': 500, '🦓': [route()] },
      { '🦄': 200, '🦓': route() }]) expect(parseSteamGitHubRules(value)).toEqual({});
  });

  it('rejects private, reserved, multicast, and malformed addresses', () => {
    for (const address of ['0.1.2.3', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254',
      '172.16.0.1', '192.168.0.1', '192.0.2.1', '192.88.99.1', '198.18.0.1', '198.51.100.1',
      '203.0.113.1', '224.0.0.1', '255.255.255.255', '1.2.3.999', '::1', '2130706433']) {
      expect(parseSteamGitHubRules([route({ ForwardDomainNames: address })])).toEqual({});
    }
    expect(parseSteamGitHubRules([route({ ForwardDomainNames: '20.207.73.82' })])['api.github.com'])
      .toEqual({ addresses: ['20.207.73.82'], servername: '' });
  });

  it('allows only GitHub origins and the exact official DNS aliases', () => {
    for (const domain of ['github.com.evil.com', 'evil.github.com', 'user@api.github.com',
      'api.github.com:443', '*.github.com', '__proto__', 'https://api.github.com', 'api.github.com/']) {
      expect(parseSteamGitHubRules([route({ MatchDomainNames: domain, ListenDomainNames: domain })])).toEqual({});
    }
    for (const target of ['localhost', 'intranet.local', 'githubapi.rmbgame.net.evil.com',
      'other.rmbgame.net', 'githubapi..rmbgame.net', 'githubapi.rmbgame.net:443', 'api.github.com/',
      'educationgithub.rmbgame.net', 'githubpipelines.rmbgame.net']) {
      expect(parseSteamGitHubRules([route({ ForwardDomainNames: target })])).toEqual({});
    }
  });

  it('supports nested local routes, original-domain SNI, and precedence', () => {
    const parsed = parseSteamGitHubRules([route({ ForwardDomainNames: '20.207.73.82', Items: [
      route({ ForwardDomainNames: 'api.github.com', FakeServerName: '@domain' }),
    ] })]);
    expect(parsed['api.github.com']).toEqual({ dnsName: 'api.github.com', servername: 'api.github.com' });
    expect(parseSteamGitHubRules([route({ FakeServerName: null })])['api.github.com']?.servername).toBe('');
  });

  it('skips hostname SNI for different origins and returns rules the origin agent can install', () => {
    const parsed = parseSteamGitHubRules([route({ MatchDomainNames: 'github.com;api.github.com',
      ListenDomainNames: 'github.com;api.github.com', FakeServerName: 'github.com',
      ForwardDomainNames: '20.207.73.82' }), route({ FakeServerName: 'API.GITHUB.COM' })]);
    expect(parsed).toEqual({
      'github.com': { addresses: ['20.207.73.82'], servername: 'github.com' },
      'api.github.com': { dnsName: 'githubapi.rmbgame.net', servername: 'API.GITHUB.COM' },
    });
    expect(parseSteamGitHubRules([route({ FakeServerName: 'uploads.github.com' })])).toEqual({});
    const agent = new GitHubOriginAgent();
    try { expect(() => agent.setRules({ ...DEFAULT_GITHUB_RULES, ...parsed })).not.toThrow(); }
    finally { agent.destroy(); }
  });

  it('limits recursion and does not invent fixed mappings for absent modern origins', () => {
    let deep: unknown = route();
    for (let index = 0; index < 20; index += 1) deep = { Items: [deep] };
    expect(parseSteamGitHubRules([deep])).toEqual({});
    expect(DEFAULT_GITHUB_RULES['github.com']).toEqual({ addresses: ['20.207.73.82'], servername: '' });
    expect(DEFAULT_GITHUB_RULES['avatars.githubusercontent.com']?.servername).toBe('Github');
    expect(DEFAULT_GITHUB_RULES['pages.github.com']).toBeDefined();
    expect(DEFAULT_GITHUB_RULES['cloud.githubusercontent.com']).toBeDefined();
    expect(DEFAULT_GITHUB_RULES['support-assets.githubassets.com']).toBeDefined();
    expect(DEFAULT_GITHUB_RULES['release-assets.githubusercontent.com']).toBeUndefined();
  });
});
