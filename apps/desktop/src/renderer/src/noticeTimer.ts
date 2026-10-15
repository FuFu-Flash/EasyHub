/** Pause reasons are independent: leaving hover cannot resume a focused notice. */
export class NoticeTimer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private remaining: number;
  private started = 0;
  private paused = new Set<string>();
  constructor(
    private readonly expire: () => void,
    duration = 4000,
  ) {
    this.remaining = duration;
    this.resume();
  }
  pause(reason: string): void {
    if (!this.paused.size) {
      this.remaining = Math.max(0, this.remaining - (Date.now() - this.started));
      clearTimeout(this.timer);
    }
    this.paused.add(reason);
  }
  release(reason: string): void {
    if (this.paused.delete(reason) && !this.paused.size) this.resume();
  }
  dispose(): void {
    clearTimeout(this.timer);
  }
  private resume(): void {
    clearTimeout(this.timer);
    this.started = Date.now();
    this.timer = setTimeout(this.expire, this.remaining);
  }
}
