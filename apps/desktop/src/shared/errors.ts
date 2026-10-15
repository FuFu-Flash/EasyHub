export type ErrorCode = 'NETWORK' | 'TIMEOUT' | 'UNAUTHORIZED' | 'RATE_LIMIT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'GIT_CONFLICT' | 'FILE_PERMISSION' | 'SERVER' | 'UNKNOWN';
export interface AppError { code: ErrorCode; detail: string }
const prefix = 'EASYHUB_ERROR:';
const codes = new Set<ErrorCode>(['NETWORK', 'TIMEOUT', 'UNAUTHORIZED', 'RATE_LIMIT', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'VALIDATION', 'GIT_CONFLICT', 'FILE_PERMISSION', 'SERVER', 'UNKNOWN']);
function redact(text: string): string {
  return text.replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-[\w-]+)\b/gu, '<REDACTED>').replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,}]+/giu, '$1<REDACTED>');
}
export function readAppError(error: unknown): AppError {
  const object = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  const source = typeof object.message === 'string' ? object.message : typeof error === 'string' ? error : 'Unknown error';
  const marker = source.indexOf(prefix);
  if (marker >= 0) {
    try { const value = JSON.parse(source.slice(marker + prefix.length)) as AppError; if (codes.has(value.code) && typeof value.detail === 'string') return { code: value.code, detail: redact(value.detail) }; } catch { /* Legacy or malformed IPC message. */ }
  }
  const detail = redact(source.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/u, ''));
  const response = object.response && typeof object.response === 'object' ? object.response as Record<string, unknown> : {};
  const status = Number(object.status ?? object.statusCode ?? response.status ?? detail.match(/(?:HTTP|status(?: code)?|GitHub(?: API)?)\D{0,12}(401|403|404|409|422|429|5\d\d)\b/iu)?.[1]);
  const hint = `${object.code ?? ''} ${detail}`;
  let code: ErrorCode = 'UNKNOWN';
  const headers = response.headers && typeof response.headers === 'object' ? response.headers as Record<string, unknown> : {};
  if (codes.has(object.code as ErrorCode)) code = object.code as ErrorCode;
  else if (/rate.?limit|限流|请求过于频繁|请求次数|secondary rate/iu.test(hint) || status === 429 || status === 403 && String(headers['x-ratelimit-remaining']) === '0') code = 'RATE_LIMIT';
  else if (status === 401 || /登录.*(?:过期|失效)|unauthorized|bad credentials/iu.test(hint)) code = 'UNAUTHORIZED';
  else if (status === 403 || /forbidden/iu.test(hint)) code = 'FORBIDDEN';
  else if (status === 404) code = 'NOT_FOUND';
  else if (/merge conflict|CONFLICT \(|冲突|unmerged|non-fast-forward/iu.test(hint)) code = 'GIT_CONFLICT';
  else if (status === 409) code = 'CONFLICT';
  else if (status === 422) code = 'VALIDATION';
  else if (/EACCES|EPERM|permission denied|文件.*权限|拒绝访问/iu.test(hint)) code = 'FILE_PERMISSION';
  else if (/ETIMEDOUT|timeout|timed out|超时|TimeoutError/iu.test(hint)) code = 'TIMEOUT';
  else if (/ENOTFOUND|EAI_AGAIN|ECONN|ENET|EHOST|fetch failed|failed to fetch|network|socket hang up|无法连接|网络不可达/iu.test(hint)) code = 'NETWORK';
  else if (status >= 500 && status < 600) code = 'SERVER';
  return { code, detail };
}
export function encodeAppError(error: unknown): string { return prefix + JSON.stringify(readAppError(error)); }
