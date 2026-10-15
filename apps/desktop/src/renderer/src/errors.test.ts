import { describe, expect, it } from 'vitest';
import { friendlyError, readAppError } from './errors';
import { encodeAppError } from '../../shared/errors';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageContext } from './i18n';
import { ErrorMessage } from './components/ErrorMessage';
describe('errors survive Electron invoke', () => {
  it('keeps selection error markers in details, without exposing them as UI copy', () => {
    const error = new Error('[SENSITIVE_FILES] 请先检查并选择要发布的文件。');
    expect(friendlyError(error, 'zh')).toBe('请先检查并选择要发布的文件。');
    expect(readAppError(error).detail).toContain('[SENSITIVE_FILES]');
  });
  it('uses the active interface language, without waiting for storage effects', () => {
    const error = encodeAppError({ status: 403, message: 'Permission denied by GitHub' });
    const html = renderToStaticMarkup(createElement(LanguageContext.Provider, { value: 'en' }, createElement(ErrorMessage, { error })));
    expect(html).toContain('Your account cannot perform this action');
    expect(html).toContain('View details');
    expect(html).not.toMatch(/[\u3400-\u9fff]/u);
  });
  it.each([[401,'UNAUTHORIZED'],[403,'FORBIDDEN'],[404,'NOT_FOUND'],[409,'CONFLICT'],[422,'VALIDATION'],[429,'RATE_LIMIT'],[503,'SERVER']])('preserves HTTP %s', (status, code) => {
    const encoded = encodeAppError({ status, message: 'API request failed' });
    const ipc = new Error(`Error invoking remote method 'easyhub:github': Error: ${encoded}`);
    expect(readAppError(ipc).code).toBe(code);
    expect(friendlyError(ipc, 'en')).not.toContain('API request failed');
    expect(friendlyError(ipc, 'zh')).toMatch(/[\u3400-\u9fff]/u);
  });
  it.each([['ETIMEDOUT','TIMEOUT'],['ENOTFOUND','NETWORK'],['EACCES','FILE_PERMISSION'],['CONFLICT (content): merge conflict','GIT_CONFLICT'],['HTTP 403 secondary rate limit','RATE_LIMIT']])('recognizes %s', (message, code) => expect(readAppError(new Error(message)).code).toBe(code));
  it('redacts keys before retaining details', () => expect(readAppError(new Error('failed sk-examplekey123')).detail).not.toContain('sk-examplekey123'));
});
