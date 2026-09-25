export function translationErrorMessage(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : '';
  const message = raw.match(/Error invoking remote method '[^']+': Error: ([^\r\n]+)/u)?.[1] ?? raw;
  return /[\p{Script=Han}]/u.test(message) ? message : '翻译失败，请稍后重试。';
}
