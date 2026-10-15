import { describe, expect, it } from 'vitest';
import { sensitiveFileReasons } from './sensitiveFiles';

describe('sensitive file detection', () => {
  it.each(['.env', 'config/.env.production', '.env.local', 'a.pem', 'a.key', 'a.p12', 'a.pfx', 'a.keystore', 'a.jks', 'ssh/id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'my-service-account-prod.json', 'credentials.json', 'client_secret_abc.json', '.npmrc', '.pypirc', '.netrc', '.git-credentials'])('warns for %s', (path) => {
    expect(sensitiveFileReasons(path).length).toBeGreaterThan(0);
  });
  it.each(['.env.example', '.env.sample', '.env.template', 'config/.env.example', 'id_rsa.pub', 'id_ed25519.pub', 'README.md', 'env.ts'])('allows safe names %s', (path) => {
    expect(sensitiveFileReasons(path)).toEqual([]);
  });
  it.each(['-----BEGIN RSA PRIVATE KEY-----', '-----BEGIN PRIVATE KEY-----', 'ghp_' + 'a'.repeat(36), 'gho_' + 'b'.repeat(36), 'ghs_' + 'c'.repeat(36), 'github_pat_' + 'a'.repeat(40), 'AKIA' + 'A'.repeat(16), 'xoxb-123456-abcdef', '{"type": "service_account"}'])('detects credentials without returning their values (%s)', (content) => {
    const reasons = sensitiveFileReasons('config.txt', content);
    expect(reasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(reasons)).not.toContain(content);
  });
  it('scans example files for real credentials and handles Windows paths', () => {
    expect(sensitiveFileReasons('.env.example', '-----BEGIN PRIVATE KEY-----')).toContain('private-key');
    expect(sensitiveFileReasons('C:\\project\\.ENV.LOCAL')).toContain('environment');
    expect(sensitiveFileReasons('README.md', 'ghp_ is a prefix; AKIA is a prefix; xoxb- is a prefix')).toEqual([]);
  });
});
