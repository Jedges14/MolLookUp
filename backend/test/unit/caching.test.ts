import { describe, expect, it, vi } from 'vitest';
import { cacheKeys, MemoryCache, type Cache } from '../../src/cache.js';
import { CacheOnlyMissError, CompoundService, DEFAULT_TTLS } from '../../src/compoundService.js';
import type { CompoundRecord, CompoundStore } from '../../src/db/compoundRepo.js';
import { Metrics } from '../../src/metrics.js';
import { PubChemError } from '../../src/pubchem/client.js';
import type { Compound } from '../../src/pubchem/parse.js';

const aspirin: Compound = {
  cid: 2244,
  name: 'Aspirin',
  iupacName: '2-acetyloxybenzoic acid',
  formula: 'C9H8O4',
  molWeight: 180.16,
  canonicalSmiles: 'CC(=O)OC1=CC=CC=C1C(=O)O',
  inchikey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N',
  xlogp: 1.2,
};

function fakeStore() {
  const compounds = new Map<number, Compound>();
  const synonyms = new Map<number, Set<string>>();
  const store = {
    findByQuery: vi.fn(async (q: string) =>
      [...compounds.values()].filter(
        (c) => c.name.toLowerCase() === q || [...(synonyms.get(c.cid) ?? [])].some((s) => s.toLowerCase() === q),
      ),
    ),
    getByCid: vi.fn(async (cid: number): Promise<CompoundRecord | null> => {
      const c = compounds.get(cid);
      return c ? { ...c, synonyms: [...(synonyms.get(cid) ?? [])], fetchedAt: '2026-01-01T00:00:00.000Z' } : null;
    }),
    save: vi.fn(async (list: Compound[], syn: Map<number, string[]>) => {
      list.forEach((c) => compounds.set(c.cid, c));
      for (const [cid, s] of syn) synonyms.set(cid, new Set([...(synonyms.get(cid) ?? []), ...s]));
    }),
    ping: async () => undefined,
  } satisfies CompoundStore;
  return store;
}

function fakePubChem() {
  return {
    cidsByName: vi.fn(async (name: string) => {
      if (name === 'aspirin') return [2244];
      throw new PubChemError('No PubChem record matches', 'NOT_FOUND', 404);
    }),
    properties: vi.fn(async (cids: number[]) => (cids.includes(2244) ? [aspirin] : [])),
    synonyms: vi.fn(async () => ['aspirin', 'ACETYLSALICYLIC ACID']),
    image: vi.fn(async (cid: number) => {
      if (cid !== 2244) throw new PubChemError('No PubChem record matches', 'NOT_FOUND', 404);
      return { body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' };
    }),
  };
}

const quietLog = { info: () => undefined, warn: () => undefined };
const callsTo = (p: ReturnType<typeof fakePubChem>) =>
  p.cidsByName.mock.calls.length +
  p.properties.mock.calls.length +
  p.synonyms.mock.calls.length +
  p.image.mock.calls.length;

function setup(opts: { cacheOnly?: boolean; cache?: Cache; now?: () => number } = {}) {
  const store = fakeStore();
  const pubchem = fakePubChem();
  const cache = opts.cache ?? new MemoryCache(opts.now);
  const metrics = new Metrics();
  const svc = new CompoundService(store, pubchem, quietLog, { cache, cacheOnly: opts.cacheOnly, metrics });
  return { svc, store, pubchem, cache, metrics };
}

describe('cache tiers (Redis → Postgres → PubChem)', () => {
  it('miss → redis: the second identical search makes zero PubChem calls and skips Postgres', async () => {
    const { svc, pubchem, store } = setup();
    expect((await svc.search('aspirin')).cache).toBe('miss');
    const pubchemBefore = callsTo(pubchem);
    const dbBefore = store.findByQuery.mock.calls.length;

    const second = await svc.search(' Aspirin ');
    expect(second.cache).toBe('redis');
    expect(second.results[0]?.cid).toBe(2244);
    expect(callsTo(pubchem)).toBe(pubchemBefore);
    expect(store.findByQuery.mock.calls.length).toBe(dbBefore);
  });

  it('Postgres hit writes back to Redis, so the next one is a Redis hit', async () => {
    const { svc, store, cache } = setup();
    await store.save([aspirin], new Map([[2244, ['aspirin']]]));
    expect((await svc.search('aspirin')).cache).toBe('db');
    expect(await cache.get(cacheKeys.search('aspirin'))).not.toBeNull();
    expect((await svc.search('aspirin')).cache).toBe('redis');
  });

  it('positive search results get the 24 h TTL', async () => {
    const now = 0;
    const cache = new MemoryCache(() => now);
    const { svc } = setup({ cache });
    await svc.search('aspirin');
    expect(cache.ttlSeconds(cacheKeys.search('aspirin'))).toBe(DEFAULT_TTLS.positiveSeconds);
  });

  it('detail: redis → db → pubchem with write-back', async () => {
    const { svc, pubchem } = setup();
    expect((await svc.detail(2244)).cache).toBe('miss');
    const before = callsTo(pubchem);
    const again = await svc.detail(2244);
    expect(again.cache).toBe('redis');
    expect(again.value?.formula).toBe('C9H8O4');
    expect(callsTo(pubchem)).toBe(before);
  });

  it('a corrupted cache entry is treated as a miss, not an error', async () => {
    const { svc, cache } = setup();
    await cache.set(cacheKeys.search('aspirin'), '{not json', 60);
    await expect(svc.search('aspirin')).resolves.toMatchObject({ cache: 'miss' });
  });

  it('a cache that is down (always misses, writes dropped) still serves from Postgres/PubChem', async () => {
    const down: Cache = { get: async () => null, set: async () => undefined, ping: async () => false };
    const { svc } = setup({ cache: down });
    expect((await svc.search('aspirin')).cache).toBe('miss');
    expect((await svc.search('aspirin')).cache).toBe('db');
  });
});

describe('negative caching', () => {
  it('a not-found search is cached for 10 minutes, then retried', async () => {
    let now = 0;
    const cache = new MemoryCache(() => now);
    const { svc, pubchem } = setup({ cache });

    expect(await svc.search('asprinnn')).toEqual({ query: 'asprinnn', cache: 'miss', results: [] });
    expect(cache.ttlSeconds(cacheKeys.search('asprinnn'))).toBe(600);

    now += 599_000;
    expect((await svc.search('asprinnn')).cache).toBe('redis');
    expect(pubchem.cidsByName).toHaveBeenCalledTimes(1);

    now += 2_000; // past 10 minutes
    expect((await svc.search('asprinnn')).cache).toBe('miss');
    expect(pubchem.cidsByName).toHaveBeenCalledTimes(2);
  });

  it('unknown CIDs and missing images are negatively cached too', async () => {
    const { svc, pubchem } = setup();
    expect((await svc.detail(999)).value).toBeNull();
    expect(await svc.detail(999)).toEqual({ value: null, cache: 'redis' });
    expect(pubchem.properties).toHaveBeenCalledTimes(1);

    expect((await svc.image(999)).value).toBeNull();
    expect(await svc.image(999)).toEqual({ value: null, cache: 'redis' });
    expect(pubchem.image).toHaveBeenCalledTimes(1);
  });

  it('upstream errors (not "not found") are NOT cached', async () => {
    const { svc, pubchem, cache } = setup();
    pubchem.cidsByName.mockRejectedValueOnce(new PubChemError('busy', 'THROTTLED', 503));
    await expect(svc.search('aspirin')).rejects.toMatchObject({ code: 'THROTTLED' });
    expect(await cache.get(cacheKeys.search('aspirin'))).toBeNull();
  });
});

describe('image caching', () => {
  it('caches PNG bytes for 7 days and returns identical bytes from Redis', async () => {
    const now = 0;
    const cache = new MemoryCache(() => now);
    const { svc, pubchem } = setup({ cache });
    const first = await svc.image(2244);
    expect(first.cache).toBe('miss');
    expect(cache.ttlSeconds(cacheKeys.image(2244))).toBe(DEFAULT_TTLS.imageSeconds);
    const second = await svc.image(2244);
    expect(second.cache).toBe('redis');
    expect(second.value?.body.equals(first.value!.body)).toBe(true);
    expect(pubchem.image).toHaveBeenCalledTimes(1);
  });
});

describe('cache-only mode', () => {
  it('serves cached data but refuses to call PubChem on a miss', async () => {
    const cache = new MemoryCache();
    const warm = setup({ cache });
    await warm.svc.search('aspirin');
    await warm.svc.image(2244);

    const { svc, pubchem, metrics } = setup({ cache, cacheOnly: true });
    expect((await svc.search('aspirin')).cache).toBe('redis');
    expect((await svc.image(2244)).cache).toBe('redis');
    await expect(svc.search('ibuprofen')).rejects.toBeInstanceOf(CacheOnlyMissError);
    await expect(svc.image(3672)).rejects.toBeInstanceOf(CacheOnlyMissError);
    await expect(svc.detail(3672)).rejects.toBeInstanceOf(CacheOnlyMissError);
    expect(callsTo(pubchem)).toBe(0);
    expect(metrics.snapshot().cache.cacheOnlyRejections).toBe(3);
  });
});

describe('Metrics', () => {
  it('computes hit ratio across tiers', async () => {
    const { svc, metrics } = setup();
    await svc.search('aspirin'); // miss
    await svc.search('aspirin'); // redis
    await svc.search('aspirin'); // redis
    await svc.search('asprinnn'); // miss (negative stored)
    await svc.search('asprinnn'); // redis (negative hit)
    const c = metrics.snapshot().cache;
    expect(c.totals).toEqual({ redis: 3, db: 0, miss: 2 });
    expect(c.hitRatio).toBe(0.6);
    expect(c.negativeHits).toBe(1);
  });

  it('reports exact p50/p95 over the window and evicts old samples', () => {
    const m = new Metrics(100);
    for (let i = 1; i <= 100; i++) m.recordRequest(i, 200);
    expect(m.snapshot().latencyMs).toMatchObject({ window: 100, p50: 50, p95: 95, p99: 99 });
    for (let i = 0; i < 100; i++) m.recordRequest(1000, 200);
    expect(m.snapshot().latencyMs.p50).toBe(1000);
    expect(m.snapshot().requests.total).toBe(200);
  });

  it('counts PubChem requests and errors', () => {
    const m = new Metrics();
    m.recordPubChemRequest(200);
    m.recordPubChemRequest(503);
    m.recordPubChemRequest('error');
    expect(m.snapshot().pubchem).toEqual({ requests: 3, errors: 2 });
  });
});
