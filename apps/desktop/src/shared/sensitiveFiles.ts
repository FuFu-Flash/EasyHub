/** Returns reason codes only; never returns a matched password or token. */
export function sensitiveFileReasons(path: string, content?: string): string[] {
  const name = path.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? '';
  const reasons = new Set<string>();
  if (/^\.env(?:\..*)?$/.test(name) && !/^\.env\.(?:example|sample|template)$/.test(name)) reasons.add('environment');
  if (/\.(?:pem|key|p12|pfx|keystore|jks)$/.test(name) || /^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(name)) reasons.add('key-file');
  if (/service-account.*\.json$/.test(name) || name === 'credentials.json' || /^client_secret.*\.json$/.test(name)) reasons.add('credential-file');
  if (['.npmrc', '.pypirc', '.netrc', '.git-credentials'].includes(name)) reasons.add('login-config');
  if (content !== undefined) {
    if (/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(content)) reasons.add('private-key');
    if (/\b(?:gh[pso]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(content)) reasons.add('github-token');
    if (/\bAKIA[A-Z0-9]{16}\b/.test(content)) reasons.add('aws-key');
    if (/\bxox[abprs]-[A-Za-z0-9-]{8,}\b/.test(content)) reasons.add('slack-token');
    if (/"type"\s*:\s*"service_account"/.test(content)) reasons.add('service-account');
  }
  return [...reasons];
}

