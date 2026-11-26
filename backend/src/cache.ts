import { createClient } from 'redis';

/**
 * Minimal string cache. Implementations must never throw: a failed read is a miss and a
 * failed write is dropped, so a Redis outage degrades to Postgres instead of erroring.
 */
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  ping(): Promise<boolean>;
}

/** Versioned key builders; bump the version to invalidate a shape change. */
export const cacheKeys = {
  search: (normalizedQuery: string) => `search:v1:${normalizedQuery}`,
  compound: (cid: number) => `compound:v1:${cid}`,
  image: (cid: number) => `image:v1:${cid}`,
};

type WarnLog = { warn: (obj: object, msg: string) => void };

export class RedisCache implements Cache {
  private readonly client: ReturnType<typeof createClient>;
  private lastWarn = 0;

  constructor(
    url: string,
    private readonly log: WarnLog,
  ) {
    this.client = createClient({
      url,
      // Fail fast instead of queueing commands while disconnected.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    });
    this.client.on('error', (err) => this.warn(err, 'redis client error'));
  }

  /** Starts connecting in the background; the API serves from Postgres until Redis is up. */
  start(): void {
    this.client.connect().catch((err: unknown) => this.warn(err, 'redis connect failed; will retry'));
  }

  async get(key: string): Promise<string | null> {
    if (!this.client.isReady) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.warn(err, 'redis get failed');
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.client.isReady) return;
    try {
      await this.client.set(key, value, { EX: Math.max(1, Math.round(ttlSeconds)) });
    } catch (err) {
      this.warn(err, 'redis set failed');
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client.isReady) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    try {
      if (this.client.isOpen) await this.client.close();
    } catch {
      this.client.destroy();
    }
  }

  /** Rate-limit warnings so an outage doesn't flood the logs. */
  private warn(err: unknown, msg: string): void {
    const now = Date.now();
    if (now - this.lastWarn < 10_000) return;
    this.lastWarn = now;
    this.log.warn({ err }, msg);
  }
}

/** In-process cache for tests and for running without Redis. */
export class MemoryCache implements Cache {
  readonly store = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async get(key: string): Promise<string | null> {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async ping(): Promise<boolean> {
    return true;
  }

  ttlSeconds(key: string): number | null {
    const e = this.store.get(key);
    return e ? (e.expiresAt - this.now()) / 1000 : null;
  }
}
