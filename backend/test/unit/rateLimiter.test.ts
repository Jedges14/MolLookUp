import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBucket } from '../../src/pubchem/rateLimiter.js';

/** Start N acquires at once and record the fake-clock time each one is granted. */
async function grantTimes(bucket: TokenBucket, n: number, runForMs: number): Promise<number[]> {
  const start = Date.now();
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    void bucket.acquire().then(() => times.push(Date.now() - start));
  }
  await vi.advanceTimersByTimeAsync(runForMs);
  return times;
}

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces requests 250 ms apart at 4 req/s', async () => {
    const times = await grantTimes(new TokenBucket(4), 6, 2000);
    expect(times).toEqual([0, 250, 500, 750, 1000, 1250]);
  });

  it('never lets more than 4 requests into any 1-second window', async () => {
    const times = await grantTimes(new TokenBucket(4), 40, 12_000);
    expect(times).toHaveLength(40);
    for (const t of times) {
      const inWindow = times.filter((x) => x >= t && x < t + 1000).length;
      expect(inWindow).toBeLessThanOrEqual(4);
    }
  });

  it('serves waiters in FIFO order', async () => {
    const bucket = new TokenBucket(4);
    const order: number[] = [];
    for (let i = 0; i < 5; i++) void bucket.acquire().then(() => order.push(i));
    await vi.advanceTimersByTimeAsync(1500);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('refills after idle time but does not bank more than its capacity', async () => {
    const bucket = new TokenBucket(4);
    await grantTimes(bucket, 1, 0);
    await vi.advanceTimersByTimeAsync(10_000); // idle 10 s
    const times = await grantTimes(bucket, 3, 1000);
    expect(times).toEqual([0, 250, 500]);
  });

  it('pause() holds all requests until the pause ends', async () => {
    const bucket = new TokenBucket(4);
    bucket.pause(5000);
    const times = await grantTimes(bucket, 2, 7000);
    expect(times[0]).toBeGreaterThanOrEqual(5000);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(250);
  });

  it('rejects invalid configuration', () => {
    expect(() => new TokenBucket(0)).toThrow();
    expect(() => new TokenBucket(4, 0)).toThrow();
  });
});
