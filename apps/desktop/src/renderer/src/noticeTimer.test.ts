import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoticeTimer } from './noticeTimer';
afterEach(() => vi.useRealTimers());
describe('success notice lifetime', () => {
  it('expires after four seconds', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    new NoticeTimer(done);
    vi.advanceTimersByTime(3999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledOnce();
  });
  it('pauses while either hovered or focused and resumes the remaining time', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const timer = new NoticeTimer(done);
    vi.advanceTimersByTime(1500);
    timer.pause('hover');
    timer.pause('focus');
    vi.advanceTimersByTime(9000);
    timer.release('hover');
    vi.advanceTimersByTime(9000);
    expect(done).not.toHaveBeenCalled();
    timer.release('focus');
    vi.advanceTimersByTime(2499);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledOnce();
  });
  it('cancels stale timers when closed or navigating away', () => {
    vi.useFakeTimers();
    const done = vi.fn();
    const timer = new NoticeTimer(done);
    timer.dispose();
    vi.advanceTimersByTime(10000);
    expect(done).not.toHaveBeenCalled();
  });
});
