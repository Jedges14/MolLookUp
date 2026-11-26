/**
 * API integration tests against real PostgreSQL and Redis (Testcontainers).
 * PubChem is replaced by a fake fetch that replays recorded fixtures and counts calls,
 * so these tests are deterministic and never touch the real service.
 */
import { readFileSync } from 'node:fs';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { Express } from 'express';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { pino } from 'pino';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { RedisCache, cacheKeys } from '../../src/cache.js';
import { CompoundService } from '../../src/compoundService.js';
import { PgCompoundStore } from '../../src/db/compoundRepo.js';
import { FactService } from '../../src/fact.js';
import { Metrics } from '../../src/metrics.js';
import { PubChemClient } from '../../src/pubchem/client.js';
import { TokenBucket } from '../../src/pubchem/rateLimiter.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const BASE = 'https://pubchem.invalid/rest/pug';

/** Fake PubChem: knows aspirin (CID 2244) only; everything else is a 404. */
function fakePubChem() {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const path = url.slice(BASE.length);
    const json = (body: string) =>
      new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    if (path === '/compound/name/aspirin/cids/JSON') return json(fixture('aspirin_cids.json'));
    if (/^\/compound\/cid\/2244\/property\//.test(path)) {
      const table = JSON.parse(fixture('aspirin_properties.json'));
      table.PropertyTable.Properties = table.PropertyTable.Properties.filter((p: { CID: number }) => p.CID === 2244);
      return json(JSON.stringify(table));
    }
    if (path === '/compound/cid/2244/synonyms/JSON') return json(fixture('aspirin_synonyms.json'));
    if (path === '/compound/cid/2244/PNG') {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response(fixture('notfound_cids.json'), { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

let pgC: StartedPostgreSqlContainer;
let redisC: StartedRedisContainer;
let pool: pg.Pool;

interface Harness {
  app: Express;
  calls: string[];
  metrics: Metrics;
  cache: RedisCache;
}
const openCaches: RedisCache[] = [];

async function harness(opts: { cacheOnly?: boolean; redisUrl?: string } = {}): Promise<Harness> {
  const { fetchFn, calls } = fakePubChem();
  const metrics = new Metrics();
  const logger = pino({ level: 'silent' });
  const cache = new RedisCache(opts.redisUrl ?? redisC.getConnectionUrl(), logger);
  openCaches.push(cache);
  cache.start();
  if (!opts.redisUrl) {
    // Wait until the client is ready so the first request can use Redis.
    for (let i = 0; i < 50 && !(await cache.ping()); i++) await new Promise((r) => setTimeout(r, 50));
  }
  const pubchem = new PubChemClient({
    baseUrl: BASE,
    userAgent: 'MolLookUp-integration-test',
    limiter: new TokenBucket(4),
    fetchFn,
    sleep: async () => undefined,
    onRequest: ({ status }) => metrics.recordPubChemRequest(status),
  });
  const store = new PgCompoundStore(pool);
  const app = createApp({
    compounds: new CompoundService(store, pubchem, logger, { cache, metrics, cacheOnly: opts.cacheOnly }),
    store,
    cache,
    facts: new FactService(undefined),
    metrics,
    logger,
    corsOrigin: 'http://localhost:5173',
    cacheOnly: opts.cacheOnly,
  });
  return { app, calls, metrics, cache };
}

async function flushRedis() {
  const c = createClient({ url: redisC.getConnectionUrl() });
  await c.connect();
  await c.flushAll();
  await c.close();
}

async function redisTtl(key: string): Promise<number> {
  const c = createClient({ url: redisC.getConnectionUrl() });
  await c.connect();
  const ttl = await c.ttl(key);
  await c.close();
  return ttl;
}

beforeAll(async () => {
  [pgC, redisC] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:8-alpine').start(),
  ]);
  await runner({
    databaseUrl: pgC.getConnectionUri(),
    dir: new URL('../../migrations', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    direction: 'up',
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
  pool = new pg.Pool({ connectionString: pgC.getConnectionUri() });
});

afterAll(async () => {
  await Promise.all(openCaches.map((c) => c.close()));
  await pool?.end();
  await Promise.all([pgC?.stop(), redisC?.stop()]);
});

beforeEach(async () => {
  await pool.query('TRUNCATE compound_synonyms, compounds');
  await flushRedis();
});

describe('search caching (real Redis + Postgres, fake PubChem)', () => {
  it('second identical request makes zero PubChem calls (served from Redis)', async () => {
    const h = await harness();

    const first = await request(h.app).get('/api/compounds/search?q=aspirin').expect(200);
    expect(first.headers['x-cache']).toBe('miss');
    expect(first.body.results).toEqual([{ cid: 2244, name: 'Aspirin', formula: 'C9H8O4', mw: 180.16 }]);
    const callsAfterFirst = h.calls.length;
    expect(callsAfterFirst).toBe(3); // name → CIDs, batched properties, synonyms

    const second = await request(h.app).get('/api/compounds/search?q=%20ASPIRIN%20').expect(200);
    expect(second.headers['x-cache']).toBe('redis');
    expect(second.body.results).toEqual(first.body.results);
    expect(h.calls.length).toBe(callsAfterFirst);

    const m = (await request(h.app).get('/metrics').expect(200)).body;
    expect(m.pubchem.requests).toBe(3);
    expect(m.cache.totals).toEqual({ redis: 1, db: 0, miss: 1 });
    expect(m.cache.hitRatio).toBe(0.5);
  });

  it('after Redis is flushed, Postgres answers (zero PubChem calls) and re-warms Redis', async () => {
    const h = await harness();
    await request(h.app).get('/api/compounds/search?q=aspirin').expect(200);
    await flushRedis();
    const before = h.calls.length;

    const fromDb = await request(h.app).get('/api/compounds/search?q=aspirin').expect(200);
    expect(fromDb.headers['x-cache']).toBe('db');
    expect(h.calls.length).toBe(before);

    const fromRedis = await request(h.app).get('/api/compounds/search?q=aspirin').expect(200);
    expect(fromRedis.headers['x-cache']).toBe('redis');
  });

  it('stored synonyms resolve from Postgres without PubChem', async () => {
    const h = await harness();
    await request(h.app).get('/api/compounds/search?q=aspirin').expect(200);
    const before = h.calls.length;
    const res = await request(h.app).get('/api/compounds/search?q=Acetylsalicylic%20Acid').expect(200);
    expect(res.headers['x-cache']).toBe('db');
    expect(res.body.results[0].cid).toBe(2244);
    expect(h.calls.length).toBe(before);
  });

  it('not-found searches are negatively cached in Redis for ≤10 minutes', async () => {
    const h = await harness();
    const miss = await request(h.app).get('/api/compounds/search?q=asprinnn').expect(200);
    expect(miss.body.results).toEqual([]);
    expect(h.calls.length).toBe(1);

    const ttl = await redisTtl(cacheKeys.search('asprinnn'));
    expect(ttl).toBeGreaterThan(590);
    expect(ttl).toBeLessThanOrEqual(600);

    const again = await request(h.app).get('/api/compounds/search?q=asprinnn').expect(200);
    expect(again.headers['x-cache']).toBe('redis');
    expect(h.calls.length).toBe(1);
  });

  it('SQL-looking input is just a query string', async () => {
    const h = await harness();
    const q = encodeURIComponent("'; DROP TABLE compounds; --");
    await request(h.app).get(`/api/compounds/search?q=${q}`).expect(200, {
      query: "'; drop table compounds; --",
      results: [],
    });
    await pool.query('SELECT 1 FROM compounds LIMIT 1'); // table still exists
  });
});

describe('detail and image caching', () => {
  it('detail: miss → Redis, zero PubChem calls on repeat; record persisted in Postgres', async () => {
    const h = await harness();
    const a = await request(h.app).get('/api/compounds/2244').expect(200);
    expect(a.headers['x-cache']).toBe('miss');
    expect(a.body).toMatchObject({ cid: 2244, inchikey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', xlogp: 1.2 });
    expect(a.body.synonyms).toContain('ACETYLSALICYLIC ACID');
    const before = h.calls.length;

    const b = await request(h.app).get('/api/compounds/2244').expect(200);
    expect(b.headers['x-cache']).toBe('redis');
    expect(b.body).toEqual(a.body);
    expect(h.calls.length).toBe(before);

    const { rows } = await pool.query('SELECT name FROM compounds WHERE cid = 2244');
    expect(rows).toEqual([{ name: 'Aspirin' }]);
  });

  it('image: proxied once, then served from Redis with cache headers', async () => {
    const h = await harness();
    const a = await request(h.app).get('/api/compounds/2244/image').expect(200);
    expect(a.headers['x-cache']).toBe('miss');
    expect(a.headers['content-type']).toBe('image/png');
    expect(a.headers['cache-control']).toContain('max-age=86400');
    const b = await request(h.app).get('/api/compounds/2244/image').expect(200);
    expect(b.headers['x-cache']).toBe('redis');
    expect(Buffer.compare(b.body, PNG)).toBe(0);
    expect(h.calls.filter((u) => u.endsWith('/PNG'))).toHaveLength(1);
  });

  it('unknown CID: 404, negatively cached', async () => {
    const h = await harness();
    await request(h.app).get('/api/compounds/999999/image').expect(404);
    await request(h.app).get('/api/compounds/999999/image').expect(404);
    expect(h.calls).toHaveLength(1);
  });
});

describe('cache-only mode (for load tests)', () => {
  it('serves warm entries and returns 503 instead of calling PubChem on a miss', async () => {
    const warm = await harness();
    await request(warm.app).get('/api/compounds/search?q=aspirin').expect(200);

    const h = await harness({ cacheOnly: true });
    const hit = await request(h.app).get('/api/compounds/search?q=aspirin').expect(200);
    expect(hit.headers['x-cache']).toBe('redis');
    const miss = await request(h.app).get('/api/compounds/search?q=ibuprofen').expect(503);
    expect(miss.body.error.code).toBe('CACHE_MISS');
    await request(h.app).get('/api/compounds/2244/image').expect(503);
    expect(h.calls).toHaveLength(0);
    expect((await request(h.app).get('/health')).body.cacheOnly).toBe(true);
  });
});

describe('Redis outage', () => {
  it('API keeps working from Postgres when Redis is unreachable', async () => {
    const warm = await harness();
    await request(warm.app).get('/api/compounds/search?q=aspirin').expect(200);

    const h = await harness({ redisUrl: 'redis://127.0.0.1:1' }); // nothing listens here
    const res = await request(h.app).get('/api/compounds/search?q=aspirin').expect(200);
    expect(res.headers['x-cache']).toBe('db');
    expect(h.calls).toHaveLength(0);
    const health = await request(h.app).get('/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok', db: 'ok', redis: 'unreachable' });
  });
});
