import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { FactService } from '../../src/fact.js';

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

  it('applies safe defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      PORT: 3001,
      PUBCHEM_RPS: 4,
      PUBCHEM_TIMEOUT_MS: 30_000,
      CACHE_ONLY: false,
      NEGATIVE_CACHE_TTL_SECONDS: 600,
    });
    expect(c.RAPIDAPI_KEY).toBeUndefined();
  });

  it('refuses a PubChem rate above 4 req/s (PubChem asks for ≤5)', () => {
    expect(() => loadConfig({ ...base, PUBCHEM_RPS: '5' })).toThrow(/PUBCHEM_RPS/);
    expect(loadConfig({ ...base, PUBCHEM_RPS: '2' }).PUBCHEM_RPS).toBe(2);
  });

  it('requires DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('parses CACHE_ONLY=%s', (v, expected) => {
    expect(loadConfig({ ...base, CACHE_ONLY: v }).CACHE_ONLY).toBe(expected);
  });

  it('rejects an unknown CACHE_ONLY value instead of guessing', () => {
    expect(() => loadConfig({ ...base, CACHE_ONLY: 'yes' })).toThrow(/CACHE_ONLY/);
  });

  it('treats an empty RAPIDAPI_KEY as unset', () => {
    expect(loadConfig({ ...base, RAPIDAPI_KEY: '' }).RAPIDAPI_KEY).toBeUndefined();
  });
});

describe('FactService', () => {
  const ok = (fact: string) =>
    vi.fn(async () => new Response(JSON.stringify([{ fact }]), { status: 200 })) as unknown as typeof fetch;

  it('is disabled without a key', async () => {
    const s = new FactService(undefined);
    expect(s.enabled).toBe(false);
    await expect(s.today()).rejects.toThrow(/not configured/);
  });

  it('sends the key only to RapidAPI and caches the fact for a day', async () => {
    let now = 0;
    const fetchFn = ok('Honey never spoils.');
    const s = new FactService('test-key', fetchFn, () => now);

    await expect(s.today()).resolves.toBe('Honey never spoils.');
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe('https://facts-by-api-ninjas.p.rapidapi.com/v1/facts');
    expect((init as RequestInit).headers).toMatchObject({ 'x-rapidapi-key': 'test-key' });

    now += 23 * 60 * 60 * 1000;
    await s.today();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    now += 2 * 60 * 60 * 1000; // past 24 h
    await s.today();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws on an upstream error or unexpected body', async () => {
    const unauthorized = vi.fn(async () => new Response('{"message":"Invalid API key"}', { status: 401 }));
    await expect(new FactService('k', unauthorized as unknown as typeof fetch).today()).rejects.toThrow(/401/);

    const weird = vi.fn(async () => new Response('[]', { status: 200 }));
    await expect(new FactService('k', weird as unknown as typeof fetch).today()).rejects.toThrow();
  });
});

describe('CACHE_BYPASS guard', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };
  it('is allowed outside production', () => {
    expect(loadConfig({ ...base, CACHE_BYPASS: 'true' }).CACHE_BYPASS).toBe(true);
  });
  it('is refused in production and together with CACHE_ONLY', () => {
    expect(() => loadConfig({ ...base, CACHE_BYPASS: 'true', NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => loadConfig({ ...base, CACHE_BYPASS: 'true', CACHE_ONLY: 'true' })).toThrow(/cannot both/);
  });
});

describe('connection URL validation (catches values pasted with their key or quotes)', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };
  it.each([
    'REDIS_URL="rediss://default:pw@host.upstash.io:6379"',
    '"rediss://default:pw@host.upstash.io:6379"',
    'https://host.upstash.io',
  ])('rejects REDIS_URL %s with a readable message', (v) => {
    expect(() => loadConfig({ ...base, REDIS_URL: v })).toThrow(/REDIS_URL: must be just the URL/);
  });
  it('accepts redis:// and rediss://', () => {
    expect(loadConfig({ ...base, REDIS_URL: 'rediss://default:pw@host.upstash.io:6379' }).REDIS_URL).toMatch(/^rediss:/);
    expect(loadConfig({ ...base, REDIS_URL: 'redis://localhost:6379/2' }).REDIS_URL).toMatch(/^redis:/);
  });
  it('rejects a quoted DATABASE_URL and accepts postgresql://', () => {
    expect(() => loadConfig({ DATABASE_URL: '"postgresql://u:p@h/db"' })).toThrow(/DATABASE_URL: must be just the URL/);
    expect(loadConfig({ DATABASE_URL: 'postgresql://u:p@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=verify-full' }).DATABASE_URL).toMatch(/^postgresql:/);
  });
});
