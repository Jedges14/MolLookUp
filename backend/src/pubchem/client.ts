import type { TokenBucket } from './rateLimiter.js';
import {
  PROPERTY_LIST,
  parseCidList,
  parseProperties,
  parseSynonyms,
  throttlePauseMs,
  type Compound,
} from './parse.js';

export type PubChemErrorCode = 'NOT_FOUND' | 'THROTTLED' | 'TIMEOUT' | 'UPSTREAM';

export class PubChemError extends Error {
  constructor(
    message: string,
    readonly code: PubChemErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PubChemError';
  }
}

export interface PubChemClientOptions {
  baseUrl: string;
  userAgent: string;
  limiter: TokenBucket;
  fetchFn?: typeof fetch;
  maxAttempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRequest?: (info: { url: string; attempt: number; status: number | 'error' }) => void;
}

/** Statuses worth retrying: throttling and transient server/gateway errors. */
const RETRYABLE = new Set([429, 502, 503, 504]);
/** PUG-REST accepts many CIDs per request; keep URLs comfortably short. */
const MAX_CIDS_PER_REQUEST = 100;

export interface PubChemImage {
  body: Buffer;
  contentType: string;
}

export class PubChemClient {
  private readonly fetchFn: typeof fetch;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly opts: PubChemClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.baseDelayMs = opts.baseDelayMs ?? 500;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  /** Name/synonym → CIDs, best match first. Throws PubChemError NOT_FOUND when nothing matches. */
  async cidsByName(name: string, limit = 5): Promise<number[]> {
    const res = await this.request(`/compound/name/${encodeURIComponent(name)}/cids/JSON`);
    return parseCidList(await res.json()).slice(0, limit);
  }

  /** Properties for many CIDs, batched into as few requests as PUG-REST allows. Preserves input order. */
  async properties(cids: number[]): Promise<Compound[]> {
    const unique = [...new Set(cids)];
    const out: Compound[] = [];
    for (let i = 0; i < unique.length; i += MAX_CIDS_PER_REQUEST) {
      const chunk = unique.slice(i, i + MAX_CIDS_PER_REQUEST);
      const res = await this.request(
        `/compound/cid/${chunk.join(',')}/property/${PROPERTY_LIST.join(',')}/JSON`,
      );
      out.push(...parseProperties(await res.json()));
    }
    const order = new Map(unique.map((cid, idx) => [cid, idx]));
    return out.sort((a, b) => (order.get(a.cid) ?? 0) - (order.get(b.cid) ?? 0));
  }

  async synonyms(cid: number, limit = 25): Promise<string[]> {
    const res = await this.request(`/compound/cid/${cid}/synonyms/JSON`);
    return parseSynonyms(await res.json(), limit);
  }

  /** 2D structure PNG. */
  async image(cid: number): Promise<PubChemImage> {
    const res = await this.request(`/compound/cid/${cid}/PNG`);
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? 'image/png',
    };
  }

  private backoffMs(attempt: number, retryAfterHeader: string | null): number {
    const exp = this.baseDelayMs * 2 ** (attempt - 1);
    const jitter = this.random() * this.baseDelayMs;
    const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
    const retryAfterMs = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 0;
    return Math.max(exp + jitter, retryAfterMs);
  }

  private async request(path: string): Promise<Response> {
    const url = `${this.opts.baseUrl}${path}`;
    let lastError: PubChemError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      await this.opts.limiter.acquire();

      let res: Response;
      try {
        res = await this.fetchFn(url, {
          headers: { 'User-Agent': this.opts.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        this.opts.onRequest?.({ url, attempt, status: 'error' });
        lastError = new PubChemError(
          isTimeout ? 'PubChem request timed out' : 'PubChem request failed',
          isTimeout ? 'TIMEOUT' : 'UPSTREAM',
        );
        if (attempt < this.maxAttempts) {
          await this.sleep(this.backoffMs(attempt, null));
          continue;
        }
        throw lastError;
      }

      this.opts.onRequest?.({ url, attempt, status: res.status });
      const pause = throttlePauseMs(res.headers.get('x-throttling-control'));
      if (pause > 0) this.opts.limiter.pause(pause);

      if (res.ok) return res;

      await res.body?.cancel().catch(() => undefined);

      if (res.status === 404) {
        throw new PubChemError('No PubChem record matches', 'NOT_FOUND', 404);
      }
      if (RETRYABLE.has(res.status)) {
        lastError = new PubChemError(`PubChem is busy (HTTP ${res.status})`, 'THROTTLED', res.status);
        if (attempt < this.maxAttempts) {
          await this.sleep(this.backoffMs(attempt, res.headers.get('retry-after')));
          continue;
        }
        throw lastError;
      }
      throw new PubChemError(`PubChem responded HTTP ${res.status}`, 'UPSTREAM', res.status);
    }
    throw lastError ?? new PubChemError('PubChem request failed', 'UPSTREAM');
  }
}
