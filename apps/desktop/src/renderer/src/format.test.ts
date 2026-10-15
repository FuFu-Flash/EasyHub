import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDateTime, formatRelative } from './format';
afterEach(() => vi.useRealTimers());
describe('dates in the application language', () => {
  it('formats dates without relying on the system locale', () => {
    expect(formatDateTime('2026-10-14T12:00:00Z', 'en')).toContain('Oct');
    expect(formatDateTime('2026-10-14T12:00:00Z', 'zh')).toContain('2026');
    expect(formatDateTime('invalid', 'en')).toBe('—');
    expect(formatDateTime(undefined, 'en')).toBe('—');
    expect(formatDateTime(null, 'zh')).toBe('—');
  });
  it('handles recent, past, future and invalid timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    expect(formatRelative('2026-10-14T11:59:45Z', 'en')).toBe('Just now');
    expect(formatRelative('2026-10-14T11:00:00Z', 'en')).toBe('1 hour ago');
    expect(formatRelative('2026-10-14T11:00:00Z', 'zh')).toContain('1小时前');
    expect(formatRelative('2026-10-15T12:00:00Z', 'en')).toBe('tomorrow');
    expect(formatRelative('', 'zh')).toBe('—');
  });
});
