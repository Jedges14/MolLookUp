import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PubChemClient, PubChemError } from '../../src/pubchem/client.js';
import { TokenBucket } from '../../src/pubchem/rateLimiter.js';

const fixtureText = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

const BASE = 'https://pubchem.test/rest/pug';

type Reply = { status: number; body?: string; headers?: Record<string, string> } | Error;

/** A fake fetch that replays `replies` in order and records every call. No network. */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = replies.shift();
    if (!next) throw new Error(`unexpected request: ${String(url)}`);
    if (next instanceof Error) throw next;
    return new Response(next.body ?? '', { status: next.status, headers: next.headers });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function makeClient(replies: Reply[], opts: { limiter?: TokenBucket } = {}) {
  const f = fakeFetch(replies);
  const sleeps: number[] = [];
  const limiter = opts.limiter ?? new TokenBucket(1000); // effectively unthrottled for logic tests
  const client = new PubChemClient({
    baseUrl: BASE,
    userAgent: 'MolLookUp-test/1.0',
    limiter,
    fetchFn: f.fn,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    baseDelayMs: 100,
  });
  return { client, calls: f.calls, sleeps, limiter };
}

const ok = (body: string, headers: Record<string, string> = {}): Reply => ({
  status: 200,
  body,
  headers: { 'content-type': 'application/json', ...headers },
});

describe('PubChemClient', () => {
  it('looks up CIDs by URL-encoded name and sends a descriptive User-Agent', async () => {
    const { client, calls } = makeClient([ok(fixtureText('aspirin_cids.json'))]);
    await expect(client.cidsByName('acetylsalicylic acid/2')).resolves.toEqual([2244]);
    expect(calls[0]?.url).toBe(`${BASE}/compound/name/acetylsalicylic%20acid%2F2/cids/JSON`);
    expect(new Headers(calls[0]?.init?.headers).get('user-agent')).toBe('MolLookUp-test/1.0');
  });

  it('maps 404 to NOT_FOUND without retrying', async () => {
    const { client, calls } = makeClient([{ status: 404, body: fixtureText('notfound_cids.json') }]);
    await expect(client.cidsByName('asprinnn')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
  });

  it('retries 503 with exponential backoff + jitter, then succeeds', async () => {
    const { client, calls, sleeps } = makeClient([
      { status: 503 },
      { status: 503 },
      ok(fixtureText('aspirin_cids.json')),
    ]);
    await expect(client.cidsByName('aspirin')).resolves.toEqual([2244]);
    expect(calls).toHaveLength(3);
    // base 100 ms * 2^(n-1) + 0.5 * 100 jitter
    expect(sleeps).toEqual([150, 250]);
  });

  it('gives up after 3 attempts with THROTTLED', async () => {
    const { client, calls } = makeClient([{ status: 503 }, { status: 429 }, { status: 503 }]);
    await expect(client.cidsByName('aspirin')).rejects.toMatchObject({
      code: 'THROTTLED',
      status: 503,
    });
    expect(calls).toHaveLength(3);
  });

  it('honors Retry-After when it is longer than the backoff', async () => {
    const { client, sleeps } = makeClient([
      { status: 503, headers: { 'retry-after': '2' } },
      ok(fixtureText('aspirin_cids.json')),
    ]);
    await client.cidsByName('aspirin');
    expect(sleeps).toEqual([2000]);
  });

  it('retries network errors and reports TIMEOUT for timeouts', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { client, calls } = makeClient([timeout, timeout, timeout]);
    await expect(client.cidsByName('aspirin')).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(calls).toHaveLength(3);
  });

  it('does not retry other 4xx errors', async () => {
    const { client, calls } = makeClient([{ status: 400 }]);
    const err = await client.cidsByName('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PubChemError);
    expect(err).toMatchObject({ code: 'UPSTREAM', status: 400 });
    expect(calls).toHaveLength(1);
  });

  it('batches property lookups: 250 CIDs → 3 requests of ≤100, de-duplicated, order preserved', async () => {
    const cids = Array.from({ length: 250 }, (_, i) => 250 - i); // descending
    const rowsFor = (url: string) => {
      const list = url.split('/compound/cid/')[1]!.split('/')[0]!.split(',').map(Number);
      // PubChem may answer in any order; return ascending to prove we re-sort.
      return JSON.stringify({
        PropertyTable: {
          Properties: [...list].sort((a, b) => a - b).map((CID) => ({ CID, Title: `c${CID}` })),
        },
      });
    };
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(String(url));
      return new Response(rowsFor(String(url)), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new PubChemClient({
      baseUrl: BASE,
      userAgent: 'ua',
      limiter: new TokenBucket(1000),
      fetchFn,
    });
    const out = await client.properties([...cids, 5, 5]);
    expect(calls).toHaveLength(3);
    for (const u of calls) {
      expect(u.split('/compound/cid/')[1]!.split('/')[0]!.split(',').length).toBeLessThanOrEqual(100);
    }
    expect(out.map((c) => c.cid)).toEqual(cids);
  });

  it('pauses the shared limiter when PubChem reports Yellow/Red load', async () => {
    const limiter = new TokenBucket(1000);
    const pause = vi.spyOn(limiter, 'pause');
    const { client } = makeClient(
      [
        ok(fixtureText('aspirin_cids.json'), {
          'x-throttling-control': 'Request Count status: Red (85%), Service status: Green (10%)',
        }),
      ],
      { limiter },
    );
    await client.cidsByName('aspirin');
    expect(pause).toHaveBeenCalledWith(5000);
  });

  it('waits for a limiter token before every attempt, retries included', async () => {
    const limiter = new TokenBucket(1000);
    const acquire = vi.spyOn(limiter, 'acquire');
    const { client } = makeClient([{ status: 503 }, ok(fixtureText('aspirin_cids.json'))], { limiter });
    await client.cidsByName('aspirin');
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it('returns PNG bytes for images', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const fetchFn = (async () =>
      new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
    const client = new PubChemClient({ baseUrl: BASE, userAgent: 'ua', limiter: new TokenBucket(1000), fetchFn });
    const img = await client.image(2244);
    expect(img.contentType).toBe('image/png');
    expect([...img.body]).toEqual([...png]);
  });
});
