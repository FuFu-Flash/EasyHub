export const GITHUB_CLIENT_ID = 'Ov23lixRW8K0uXzZqwMj';

interface DeviceCode { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }
export interface Credential { accessToken: string; refreshToken?: string; expiresAt?: number }
interface TokenReply { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; interval?: number }

const endpoint = 'https://github.com/login';

async function post<T>(path: string, data: Record<string, string>, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<T> {
  const response = await transport(`${endpoint}${path}`, {
    method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString(),
  });
  if (!response.ok) throw new Error('GitHub 登录暂时不可用，请稍后重试。');
  return response.json() as Promise<T>;
}

export async function requestDeviceCode(signal?: AbortSignal, transport: typeof fetch = fetch): Promise<DeviceCode> {
  return post<DeviceCode>('/device/code', { client_id: GITHUB_CLIENT_ID, scope: 'repo read:user' }, signal, transport);
}

export async function refreshCredential(current: Credential, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<Credential> {
  if (!current.refreshToken) throw new Error('GitHub 登录已过期，请重新登录。');
  const result = await post<TokenReply>('/oauth/access_token', {
    client_id: GITHUB_CLIENT_ID, grant_type: 'refresh_token', refresh_token: current.refreshToken,
  }, signal, transport);
  if (!result.access_token) throw new Error('GitHub 登录已过期，请重新登录。');
  return { accessToken: result.access_token, refreshToken: result.refresh_token ?? current.refreshToken,
    expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined };
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('登录已取消。')); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(new Error('登录已取消。')); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

export async function awaitDeviceAuthorization(code: DeviceCode, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<Credential> {
  const deadline = Date.now() + code.expires_in * 1000;
  let interval = Math.max(5, code.interval) * 1000;
  while (Date.now() < deadline) {
    await pause(interval, signal);
    const result = await post<TokenReply>('/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID, device_code: code.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }, signal, transport);
    if (result.access_token) return { accessToken: result.access_token, refreshToken: result.refresh_token,
      expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined };
    if (result.error === 'authorization_pending') continue;
    if (result.error === 'slow_down') { interval += Math.max(5, result.interval ?? 5) * 1000; continue; }
    if (result.error === 'access_denied') throw new Error('你没有授权 EasyHub。');
    if (result.error === 'expired_token') break;
    throw new Error('登录暂时无法完成，请重试。');
  }
  throw new Error('验证码已过期，请重新登录。');
}
