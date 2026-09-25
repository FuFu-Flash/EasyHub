import { describe, expect, it } from 'vitest';
import { translationErrorMessage } from './translationError';

describe('translationErrorMessage', () => {
  it('removes Electron IPC details from a translation failure', () => {
    expect(translationErrorMessage(new Error("Error invoking remote method 'easyhub:translate-content': Error: 内容太长，暂时无法翻译。")))
      .toBe('内容太长，暂时无法翻译。');
  });

  it('does not show unknown technical errors to the user', () => {
    expect(translationErrorMessage(new Error('SyntaxError: Unexpected token'))).toBe('翻译失败，请稍后重试。');
  });
});
