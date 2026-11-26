import type { Logger } from 'pino';
import { cacheKeys, MemoryCache, type Cache } from './cache.js';
import type { CompoundRecord, CompoundStore } from './db/compoundRepo.js';
import { asCid, normalizeQuery } from './lib/normalize.js';
import type { CacheTier, LookupKind, Metrics } from './metrics.js';
import { PubChemError, type PubChemClient, type PubChemImage } from './pubchem/client.js';
import type { Compound } from './pubchem/parse.js';

export interface CompoundSummary {
  cid: number;
  name: string;
  formula: string | null;
  mw: number | null;
}

export interface SearchResult {
  query: string;
  cache: CacheTier;
  results: CompoundSummary[];
}

export interface Sourced<T> {
  value: T;
  cache: CacheTier;
}

/** Thrown in cache-only mode instead of calling PubChem (used by load tests). */
export class CacheOnlyMissError extends Error {
  constructor(what: string) {
    super(`Cache-only mode: ${what} is not cached`);
    this.name = 'CacheOnlyMissError';
  }
}

export interface CacheTtls {
  /** Found search results and compound records. */
  positiveSeconds: number;
  /** "Not found" answers, so repeated misses don't hit PubChem. */
  negativeSeconds: number;
  imageSeconds: number;
}

export const DEFAULT_TTLS: CacheTtls = {
  positiveSeconds: 24 * 60 * 60,
  negativeSeconds: 10 * 60,
  imageSeconds: 7 * 24 * 60 * 60,
};

export interface CompoundServiceOptions {
  cache?: Cache;
  ttls?: CacheTtls;
  /** On a full miss, throw CacheOnlyMissError instead of calling PubChem. */
  cacheOnly?: boolean;
  /**
   * Benchmark baseline only: skip Redis and Postgres entirely (no reads, no writes), so every
   * lookup is what the app would do with no caching at all. Search uses 2 PubChem requests
   * (name → CIDs, batched properties); it skips the synonym fetch that exists only to fill the cache.
   */
  bypassCache?: boolean;
  metrics?: Pick<Metrics, 'recordLookup' | 'recordCacheOnlyRejection'>;
}

type PubChemPort = Pick<PubChemClient, 'cidsByName' | 'properties' | 'synonyms' | 'image'>;

const SEARCH_CID_LIMIT = 5;
const SYNONYM_LIMIT = 25;
const NOT_FOUND = JSON.stringify({ notFound: true });

export const toSummary = (c: Compound): CompoundSummary => ({
  cid: c.cid,
  name: c.name,
  formula: c.formula,
  mw: c.molWeight,
});

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export class CompoundService {
  private readonly cache: Cache;
  private readonly ttls: CacheTtls;
  private readonly cacheOnly: boolean;

  constructor(
    private readonly store: CompoundStore,
    private readonly pubchem: PubChemPort,
    private readonly log: Pick<Logger, 'info' | 'warn'>,
    private readonly opts: CompoundServiceOptions = {},
  ) {
    this.cache = opts.cache ?? new MemoryCache();
    this.ttls = opts.ttls ?? DEFAULT_TTLS;
    this.cacheOnly = opts.cacheOnly ?? false;
  }

  /** Redis → Postgres → PubChem (rate-limited), writing back to each faster tier. */
  async search(rawQuery: string): Promise<SearchResult> {
    const query = normalizeQuery(rawQuery);

    const cid = asCid(query);
    if (cid !== null) {
      const { value, cache } = await this.detail(cid);
      return { query, cache, results: value ? [toSummary(value)] : [] };
    }

    if (this.opts.bypassCache) {
      let found: Compound[] = [];
      try {
        found = await this.pubchem.properties(await this.pubchem.cidsByName(query, SEARCH_CID_LIMIT));
      } catch (err) {
        if (!(err instanceof PubChemError && err.code === 'NOT_FOUND')) throw err;
      }
      return this.done('search', { query, cache: 'miss', results: found.map(toSummary) });
    }

    const key = cacheKeys.search(query);
    const cached = parseJson<{ results: CompoundSummary[] }>(await this.cache.get(key));
    if (cached && Array.isArray(cached.results)) {
      return this.done('search', { query, cache: 'redis', results: cached.results }, cached.results.length === 0);
    }

    const hits = await this.store.findByQuery(query);
    if (hits.length > 0) {
      const results = hits.map(toSummary);
      await this.cache.set(key, JSON.stringify({ results }), this.ttls.positiveSeconds);
      return this.done('search', { query, cache: 'db', results });
    }

    this.assertMayCallPubChem(`search "${query}"`);

    let cids: number[];
    try {
      cids = await this.pubchem.cidsByName(query, SEARCH_CID_LIMIT);
    } catch (err) {
      if (err instanceof PubChemError && err.code === 'NOT_FOUND') {
        await this.cache.set(key, JSON.stringify({ results: [] }), this.ttls.negativeSeconds);
        return this.done('search', { query, cache: 'miss', results: [] });
      }
      throw err;
    }

    const compounds = await this.pubchem.properties(cids);
    const synonyms = new Map<number, string[]>(compounds.map((c) => [c.cid, [query]]));
    const top = compounds[0];
    if (top) {
      // Synonyms for the best match make later lookups by alternate names hit Postgres.
      const extra = await this.pubchem.synonyms(top.cid, SYNONYM_LIMIT).catch((e: unknown) => {
        this.log.warn({ err: e, cid: top.cid }, 'synonym fetch failed; continuing');
        return [] as string[];
      });
      synonyms.set(top.cid, [query, ...extra]);
    }
    await this.store.save(compounds, synonyms);

    const results = (await this.store.findByQuery(query)).map(toSummary);
    await this.cache.set(
      key,
      JSON.stringify({ results }),
      results.length > 0 ? this.ttls.positiveSeconds : this.ttls.negativeSeconds,
    );
    return this.done('search', { query, cache: 'miss', results });
  }

  async detail(cid: number): Promise<Sourced<CompoundRecord | null>> {
    if (this.opts.bypassCache) {
      const [c] = await this.pubchem.properties([cid]).catch((err: unknown) => {
        if (err instanceof PubChemError && err.code === 'NOT_FOUND') return [] as Compound[];
        throw err;
      });
      return this.sourced('detail', c ? { ...c, synonyms: [], fetchedAt: new Date().toISOString() } : null, 'miss');
    }

    const key = cacheKeys.compound(cid);
    const raw = await this.cache.get(key);
    if (raw === NOT_FOUND) return this.sourced('detail', null, 'redis', true);
    const cached = parseJson<CompoundRecord>(raw);
    if (cached && typeof cached.cid === 'number') return this.sourced('detail', cached, 'redis');

    const stored = await this.store.getByCid(cid);
    if (stored) {
      await this.cache.set(key, JSON.stringify(stored), this.ttls.positiveSeconds);
      return this.sourced('detail', stored, 'db');
    }

    this.assertMayCallPubChem(`CID ${cid}`);

    let compounds: Compound[];
    try {
      compounds = await this.pubchem.properties([cid]);
    } catch (err) {
      if (!(err instanceof PubChemError && err.code === 'NOT_FOUND')) throw err;
      compounds = [];
    }
    if (compounds.length === 0) {
      await this.cache.set(key, NOT_FOUND, this.ttls.negativeSeconds);
      return this.sourced('detail', null, 'miss');
    }
    const syn = await this.pubchem.synonyms(cid, SYNONYM_LIMIT).catch(() => [] as string[]);
    await this.store.save(compounds, new Map([[cid, syn]]));
    const record = await this.store.getByCid(cid);
    if (record) await this.cache.set(key, JSON.stringify(record), this.ttls.positiveSeconds);
    return this.sourced('detail', record, 'miss');
  }

  /** Proxied 2D structure PNG, cached in Redis (images aren't stored in Postgres). */
  async image(cid: number): Promise<Sourced<PubChemImage | null>> {
    const key = cacheKeys.image(cid);
    const raw = await this.cache.get(key);
    if (raw === NOT_FOUND) return this.sourced('image', null, 'redis', true);
    const cached = parseJson<{ contentType: string; base64: string }>(raw);
    if (cached?.base64) {
      return this.sourced('image', { contentType: cached.contentType, body: Buffer.from(cached.base64, 'base64') }, 'redis');
    }

    this.assertMayCallPubChem(`image for CID ${cid}`);

    try {
      const img = await this.pubchem.image(cid);
      await this.cache.set(
        key,
        JSON.stringify({ contentType: img.contentType, base64: img.body.toString('base64') }),
        this.ttls.imageSeconds,
      );
      return this.sourced('image', img, 'miss');
    } catch (err) {
      if (err instanceof PubChemError && err.code === 'NOT_FOUND') {
        await this.cache.set(key, NOT_FOUND, this.ttls.negativeSeconds);
        return this.sourced('image', null, 'miss');
      }
      throw err;
    }
  }

  private assertMayCallPubChem(what: string): void {
    if (this.cacheOnly) {
      this.opts.metrics?.recordCacheOnlyRejection();
      throw new CacheOnlyMissError(what);
    }
  }

  private done(kind: LookupKind, r: SearchResult, negative = false): SearchResult {
    this.opts.metrics?.recordLookup(kind, r.cache, negative);
    this.log.info({ cache: r.cache, query: r.query, n: r.results.length }, kind);
    return r;
  }

  private sourced<T>(kind: LookupKind, value: T, cache: CacheTier, negative = false): Sourced<T> {
    this.opts.metrics?.recordLookup(kind, cache, negative);
    return { value, cache };
  }
}
