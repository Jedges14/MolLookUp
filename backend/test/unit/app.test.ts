import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from '../../src/app.js';
import { CacheOnlyMissError } from '../../src/compoundService.js';
import { Metrics } from '../../src/metrics.js';
import { PubChemError } from '../../src/pubchem/client.js';

function makeApp(
  overrides: Partial<AppDeps['compounds']> = {},
  factsEnabled = false,
  extra: { redisUp?: boolean; dbUp?: boolean } = {},
) {
  const compounds: AppDeps['compounds'] = {
    search: vi.fn(async (q: string) => ({
      query: q.toLowerCase(),
      cache: 'db' as const,
      results: [{ cid: 2244, name: 'Aspirin', formula: 'C9H8O4', mw: 180.16 }],
    })),
    detail: vi.fn(async () => ({ value: null, cache: 'miss' as const })),
    image: vi.fn(async () => ({
      value: { body: Buffer.from([0x89, 0x50]), contentType: 'image/png' },
      cache: 'redis' as const,
    })),
    ...overrides,
  };
  const app = createApp({
    compounds,
    store: {
      ping: async () => {
        if (extra.dbUp === false) throw new Error('db down');
      },
    },
    cache: { ping: async () => extra.redisUp ?? true },
    metrics: new Metrics(),
    facts: { enabled: factsEnabled, today: async () => 'Octopuses have three hearts.' },
    logger: pino({ level: 'silent' }),
    corsOrigin: 'http://localhost:5173',
  });
  return { app, compounds };
}

describe('API', () => {
  it('GET /health', async () => {
    const { app } = makeApp();
    await request(app).get('/health').expect(200, { status: 'ok', db: 'ok', redis: 'ok', cacheOnly: false });
  });

  it('GET /health stays 200 when only Redis is down, 503 when Postgres is down', async () => {
    const r = await request(makeApp({}, false, { redisUp: false }).app).get('/health').expect(200);
    expect(r.body.redis).toBe('unreachable');
    await request(makeApp({}, false, { dbUp: false }).app).get('/health').expect(503);
  });

  it('cache-only misses become 503 CACHE_MISS', async () => {
    const { app } = makeApp({
      search: vi.fn(async () => {
        throw new CacheOnlyMissError('search "x"');
      }),
    });
    const res = await request(app).get('/api/compounds/search?q=x').expect(503);
    expect(res.body.error.code).toBe('CACHE_MISS');
  });

  it('GET /metrics reports request counts and latency percentiles for /api routes', async () => {
    const { app } = makeApp();
    await request(app).get('/api/compounds/search?q=aspirin');
    await request(app).get('/api/compounds/search?q=');
    await request(app).get('/health');
    const m = (await request(app).get('/metrics').expect(200)).body;
    expect(m.requests.total).toBe(2);
    expect(m.requests.byStatus).toMatchObject({ '2xx': 1, '4xx': 1 });
    expect(m.latencyMs.window).toBe(2);
    expect(m.latencyMs.p95).toBeGreaterThanOrEqual(0);
  });

  it('search returns results and the cache source header', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/compounds/search').query({ q: 'Aspirin' }).expect(200);
    expect(res.headers['x-cache']).toBe('db');
    expect(res.body.results[0]).toEqual({ cid: 2244, name: 'Aspirin', formula: 'C9H8O4', mw: 180.16 });
  });

  it.each([
    ['missing q', ''],
    ['blank q', '?q=%20%20'],
    ['q too long', `?q=${'a'.repeat(201)}`],
    ['repeated q', '?q=a&q=b'],
  ])('search rejects %s with a 400 JSON error', async (_label, qs) => {
    const { app, compounds } = makeApp();
    const res = await request(app).get(`/api/compounds/search${qs}`).expect(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
    expect(compounds.search).not.toHaveBeenCalled();
  });

  it.each(['abc', '0', '-5', '1.5', '99999999999'])('detail rejects cid=%s', async (cid) => {
    const { app } = makeApp();
    const res = await request(app).get(`/api/compounds/${cid}`).expect(400);
    expect(res.body.error.code).toBe('INVALID_INPUT');
  });

  it('detail 404s for an unknown CID', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/compounds/123').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('image is proxied as PNG with cache headers', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/compounds/2244/image').expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=86400, stale-while-revalidate=604800');
    expect(res.headers['x-cache']).toBe('redis');
  });

  it.each([
    ['THROTTLED', 503, 'UPSTREAM_BUSY'],
    ['TIMEOUT', 503, 'UPSTREAM_BUSY'],
    ['UPSTREAM', 502, 'UPSTREAM_ERROR'],
  ] as const)('PubChem %s → %i %s, server keeps running', async (code, status, apiCode) => {
    const { app } = makeApp({
      search: vi.fn(async () => {
        throw new PubChemError('x', code);
      }),
    });
    const res = await request(app).get('/api/compounds/search?q=aspirin').expect(status);
    expect(res.body.error.code).toBe(apiCode);
    await request(app).get('/health').expect(200);
  });

  it('unexpected errors become a generic 500 without leaking details', async () => {
    const { app } = makeApp({
      search: vi.fn(async () => {
        throw new Error('db password is hunter2');
      }),
    });
    const res = await request(app).get('/api/compounds/search?q=aspirin').expect(500);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('fact endpoint is 503 when no key is configured, 200 when it is', async () => {
    await request(makeApp().app).get('/api/fact').expect(503);
    const res = await request(makeApp({}, true).app).get('/api/fact').expect(200);
    expect(res.body.fact).toMatch(/hearts/);
  });

  it('sets CORS only for the configured origin', async () => {
    const { app } = makeApp();
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const other = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unknown routes return a JSON 404', async () => {
    const res = await request(makeApp().app).get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
