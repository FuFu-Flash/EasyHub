import { InterfaceError } from '../localization/error.ts';
export const GITHUB_CLIENT_ID = 'Ov23lixRW8K0uXzZqwMj';

export interface DeviceCode { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }
export interface Credential { accessToken: string; refreshToken?: string; expiresAt?: number }
export class CredentialExpiredError extends InterfaceError<'deviceFlow.yourGitHubSignInExpiredSignInAgain'> {
  readonly code = 'GITHUB_CREDENTIAL_EXPIRED';
  constructor() { super('deviceFlow.yourGitHubSignInExpiredSignInAgain'); }
}

class OAuthResponseError extends InterfaceError<'deviceFlow.githubSignInIsUnavailablePleaseTryAgainLater'> {
  readonly status: number;
  readonly oauthError?: string;
  constructor(status: number, oauthError?: string) { super('deviceFlow.githubSignInIsUnavailablePleaseTryAgainLater'); this.status = status; this.oauthError = oauthError; }
}

interface TokenReply { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; interval?: number }

const endpoint = 'https://github.com/login';

async function post<T>(path: string, data: Record<string, string>, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<T> {
  const response = await transport(`${endpoint}${path}`, {
    method: 'POST', signal, headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(data).toString(),
  });
  if (!response.ok) {
    let oauthError: string | undefined;
    try { const reply = await response.json() as { error?: unknown }; if (typeof reply?.error === 'string') oauthError = reply.error; } catch { /* HTTP status is still available. */ }
    throw new OAuthResponseError(response.status, oauthError);
  }
  return response.json() as Promise<T>;
}

export async function requestDeviceCode(signal?: AbortSignal, transport: typeof fetch = fetch): Promise<DeviceCode> {
  return post<DeviceCode>('/device/code', { client_id: GITHUB_CLIENT_ID, scope: 'repo read:user' }, signal, transport);
}

/** Deletion credentials are requested only for a confirmed repository deletion. */
export async function requestDeletionDeviceCode(signal?: AbortSignal, transport: typeof fetch = fetch): Promise<DeviceCode> {
  return post<DeviceCode>('/device/code', { client_id: GITHUB_CLIENT_ID, scope: 'repo read:user delete_repo' }, signal, transport);
}

export async function refreshCredential(current: Credential, signal?: AbortSignal, transport: typeof fetch = fetch): Promise<Credential> {
  if (!current.refreshToken) throw new CredentialExpiredError();
  let result: TokenReply;
  try {
    result = await post<TokenReply>('/oauth/access_token', {
      client_id: GITHUB_CLIENT_ID, grant_type: 'refresh_token', refresh_token: current.refreshToken,
    }, signal, transport);
  } catch (cause) {
    if (cause instanceof OAuthResponseError && (cause.status === 400 || cause.status === 401)
      && ['bad_refresh_token', 'expired_token', 'invalid_grant'].includes(cause.oauthError ?? '')) throw new CredentialExpiredError();
    throw cause;
  }
  if (!result.access_token) {
    if (['bad_refresh_token', 'expired_token', 'invalid_grant'].includes(result.error ?? '')) throw new CredentialExpiredError();
    throw new InterfaceError('deviceFlow.githubSignInIsUnavailablePleaseTryAgainLater');
  }
  return { accessToken: result.access_token, refreshToken: result.refresh_token ?? current.refreshToken,
    expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined };
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new InterfaceError("deviceFlow.signInCanceled").withDiagnostic("登录已取消。")); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    const cancel = () => { clearTimeout(timer); reject(new InterfaceError("deviceFlow.signInCanceled").withDiagnostic("登录已取消。")); };
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
    if (result.error === 'access_denied') throw new InterfaceError("deviceFlow.youDidNotAuthorizeEasyHub").withDiagnostic("你没有授权 EasyHub。");
    if (result.error === 'expired_token') break;
    throw new InterfaceError("deviceFlow.signInCouldNotBeCompletedPleaseRetry").withDiagnostic("登录暂时无法完成，请重试。");
  }
  throw new InterfaceError("deviceFlow.theVerificationCodeExpiredSignInAgain").withDiagnostic("配对码已过期，请重新登录。");
}
