import type { RequestHandler } from 'express';

export type CacheTier = 'redis' | 'db' | 'miss';
export type LookupKind = 'search' | 'detail' | 'image';

/**
 * In-process metrics for one API instance. Latency percentiles are computed over a
 * sliding window of the most recent /api requests (exact, not histogram-estimated).
 */
export class Metrics {
  private readonly startedAt: number;
  private readonly latencies: number[] = [];
  private latencyCursor = 0;
  private requestsTotal = 0;
  private readonly byStatusClass: Record<string, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  private readonly lookups: Record<LookupKind, Record<CacheTier, number>> = {
    search: { redis: 0, db: 0, miss: 0 },
    detail: { redis: 0, db: 0, miss: 0 },
    image: { redis: 0, db: 0, miss: 0 },
  };
  private negativeHits = 0;
  private pubchemRequests = 0;
  private pubchemErrors = 0;
  private cacheOnlyRejections = 0;

  constructor(
    private readonly windowSize = 5000,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startedAt = this.now();
  }

  recordLookup(kind: LookupKind, tier: CacheTier, negative = false): void {
    this.lookups[kind][tier]++;
    if (negative && tier !== 'miss') this.negativeHits++;
  }

  recordPubChemRequest(status: number | 'error'): void {
    this.pubchemRequests++;
    if (status === 'error' || status >= 500 || status === 429) this.pubchemErrors++;
  }

  recordCacheOnlyRejection(): void {
    this.cacheOnlyRejections++;
  }

  recordRequest(durationMs: number, status: number): void {
    this.requestsTotal++;
    const cls = `${Math.floor(status / 100)}xx`;
    if (cls in this.byStatusClass) this.byStatusClass[cls]!++;
    if (this.latencies.length < this.windowSize) {
      this.latencies.push(durationMs);
    } else {
      this.latencies[this.latencyCursor] = durationMs;
      this.latencyCursor = (this.latencyCursor + 1) % this.windowSize;
    }
  }

  /** Express middleware timing every /api request. */
  middleware(): RequestHandler {
    return (req, res, next) => {
      if (!req.path.startsWith('/api/')) return next();
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        this.recordRequest(ms, res.statusCode);
      });
      next();
    };
  }

  snapshot() {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const pct = (p: number) =>
      sorted.length === 0
        ? null
        : round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!);
    const totals = { redis: 0, db: 0, miss: 0 };
    for (const k of Object.values(this.lookups)) {
      totals.redis += k.redis;
      totals.db += k.db;
      totals.miss += k.miss;
    }
    const lookupsTotal = totals.redis + totals.db + totals.miss;
    return {
      uptimeSeconds: Math.round((this.now() - this.startedAt) / 1000),
      requests: { total: this.requestsTotal, byStatus: { ...this.byStatusClass } },
      latencyMs: {
        window: sorted.length,
        p50: pct(50),
        p95: pct(95),
        p99: pct(99),
        mean: sorted.length ? round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
      },
      cache: {
        lookups: structuredClone(this.lookups),
        totals,
        // Share of lookups answered without calling PubChem (Redis or Postgres).
        hitRatio: lookupsTotal ? round((totals.redis + totals.db) / lookupsTotal, 4) : null,
        redisHitRatio: lookupsTotal ? round(totals.redis / lookupsTotal, 4) : null,
        negativeHits: this.negativeHits,
        cacheOnlyRejections: this.cacheOnlyRejections,
      },
      pubchem: { requests: this.pubchemRequests, errors: this.pubchemErrors },
    };
  }
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
