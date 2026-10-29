import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// SHA-256 of the debug.keystore that ships in the Expo template (CN=Android Debug, password "android"). Anyone can sign with it.
export const PUBLIC_DEBUG_CERTIFICATE = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c';

/** Reads every `certificate SHA-256 digest` line from `apksigner verify --print-certs` output. */
export function parseCertificateDigests(output) {
  return [...output.matchAll(/certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/gu)].map((match) => match[1].replaceAll(':', '').toLowerCase());
}

export function isPublicDebugCertificate(digest) {
  return digest.replaceAll(':', '').toLowerCase() === PUBLIC_DEBUG_CERTIFICATE;
}

function findApksigner() {
  if (process.env.APKSIGNER) return process.env.APKSIGNER;
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Library/Android/sdk');
  const tools = join(sdk, 'build-tools');
  if (!existsSync(tools)) return null;
  const versions = readdirSync(tools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse();
  const found = versions.map((version) => join(tools, version, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner')).find(existsSync);
  return found ?? null;
}

function main(apk) {
  if (!apk || !existsSync(apk)) {
    process.stderr.write('用法：node scripts/verify-android-signature.mjs <APK 路径>\n');
    return 2;
  }
  const apksigner = findApksigner();
  if (!apksigner) {
    process.stderr.write('找不到 apksigner。请安装 Android SDK Build-Tools，或用 APKSIGNER 指向它。\n');
    return 2;
  }
  const result = spawnSync(apksigner, ['verify', '--print-certs', apk], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(`apksigner 校验失败：\n${result.stderr || result.stdout}`);
    return 1;
  }
  const digests = parseCertificateDigests(result.stdout);
  if (digests.length === 0) {
    process.stderr.write('没有读到签名证书。\n');
    return 1;
  }
  for (const digest of digests) process.stdout.write(`证书 SHA-256：${digest}\n`);
  if (digests.some(isPublicDebugCertificate)) {
    process.stderr.write('错误：这个 APK 用的是公开的调试签名（CN=Android Debug），任何人都能伪造同签名的安装包。请用自己的发布密钥重新构建。\n');
    return 1;
  }
  process.stdout.write('签名检查通过：不是公开的调试证书。请把上面的 SHA-256 写进发布说明。\n');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv[2]));
