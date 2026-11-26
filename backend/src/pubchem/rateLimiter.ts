/**
 * Token bucket shared by every outbound PubChem request in this process.
 *
 * With the default capacity of 1, requests are spaced at least 1000/rate ms apart,
 * so no 1-second window ever holds more than `rate` requests (a larger burst
 * capacity would let a window hold up to capacity + rate - 1).
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private pausedUntil = 0;
  private readonly waiters: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ratePerSecond: number,
    private readonly capacity = 1,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!(ratePerSecond > 0)) throw new Error('ratePerSecond must be > 0');
    if (!(capacity >= 1)) throw new Error('capacity must be >= 1');
    this.tokens = capacity;
    this.lastRefill = this.now();
  }

  /** Resolves when the caller may send one request. Callers are served FIFO. */
  acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.drain();
    });
  }

  /** Stop handing out tokens for `ms` (used when PubChem signals it is under load). */
  pause(ms: number): void {
    if (ms <= 0) return;
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
    this.tokens = 0;
    this.lastRefill = this.pausedUntil;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.drain();
  }

  get pending(): number {
    return this.waiters.length;
  }

  private refill(): void {
    const t = this.now();
    if (t <= this.lastRefill) return;
    const elapsedSec = (t - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSecond);
    this.lastRefill = t;
  }

  private drain(): void {
    if (this.timer) return;
    const t = this.now();
    if (t < this.pausedUntil) {
      this.schedule(this.pausedUntil - t);
      return;
    }
    this.refill();
    while (this.waiters.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.waiters.shift()!();
    }
    if (this.waiters.length > 0) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
      this.schedule(Math.max(1, waitMs));
    }
  }

  private schedule(ms: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drain();
    }, ms);
  }
}
