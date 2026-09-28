import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { targetPath } = require('./path.cjs');

describe('installer path selection', () => {
  it('keeps the previous installation folder exactly', () => {
    expect(targetPath('D:\\My Custom Apps', 'D:\\My Custom Apps')).toBe('D:\\My Custom Apps');
  });

  it('adds the EasyHub folder only when choosing a parent folder', () => {
    expect(targetPath('E:\\Programs', '')).toBe('E:\\Programs\\EasyHub');
    expect(targetPath('E:\\Programs\\EasyHub', '')).toBe('E:\\Programs\\EasyHub');
  });

  it('rejects relative paths and drive roots', () => {
    expect(() => targetPath('Programs', '')).toThrow();
    expect(() => targetPath('D:\\', '')).toThrow();
  });
});
