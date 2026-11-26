import { describe, expect, it, vi } from 'vitest';
import type { Cache } from '../../src/cache.js';
import { CompoundService } from '../../src/compoundService.js';
import type { CompoundRecord, CompoundStore } from '../../src/db/compoundRepo.js';
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

/** In-memory CompoundStore with the same matching rule as the SQL (lower(name|synonym) = query). */
class MemoryStore implements CompoundStore {
  compounds = new Map<number, Compound>();
  synonyms = new Map<number, Set<string>>();
  async findByQuery(q: string) {
    return [...this.compounds.values()]
      .filter(
        (c) =>
          c.name.toLowerCase() === q ||
          [...(this.synonyms.get(c.cid) ?? [])].some((s) => s.toLowerCase() === q),
      )
      .sort((a, b) => a.cid - b.cid);
  }
  async getByCid(cid: number): Promise<CompoundRecord | null> {
    const c = this.compounds.get(cid);
    return c
      ? { ...c, synonyms: [...(this.synonyms.get(cid) ?? [])].sort(), fetchedAt: '2026-01-01T00:00:00.000Z' }
      : null;
  }
  async save(list: Compound[], syn: Map<number, string[]>) {
    for (const c of list) this.compounds.set(c.cid, c);
    for (const [cid, s] of syn) {
      const set = this.synonyms.get(cid) ?? new Set();
      s.forEach((x) => set.add(x));
      this.synonyms.set(cid, set);
    }
  }
  async ping() {}
}

function fakePubChem() {
  return {
    cidsByName: vi.fn(async (name: string) => {
      if (name === 'aspirin' || name === 'acetylsalicylic acid') return [2244];
      throw new PubChemError('No PubChem record matches', 'NOT_FOUND', 404);
    }),
    properties: vi.fn(async (cids: number[]) => (cids.includes(2244) ? [aspirin] : [])),
    synonyms: vi.fn(async () => ['aspirin', 'ACETYLSALICYLIC ACID', '50-78-2']),
    image: vi.fn(async () => ({ body: Buffer.from('png'), contentType: 'image/png' })),
  };
}

const quietLog = { info: () => undefined, warn: () => undefined };

/** These tests exercise the Postgres tier, so Redis is disabled (always misses). */
const noCache: Cache = { get: async () => null, set: async () => undefined, ping: async () => true };

const pubchemCalls = (p: ReturnType<typeof fakePubChem>) =>
  p.cidsByName.mock.calls.length + p.properties.mock.calls.length + p.synonyms.mock.calls.length;

describe('CompoundService.search', () => {
  it('cold miss: PubChem name → batched properties → synonyms, then persists', async () => {
    const store = new MemoryStore();
    const pubchem = fakePubChem();
    const svc = new CompoundService(store, pubchem, quietLog, { cache: noCache });

    const r = await svc.search('  Aspirin ');
    expect(r).toEqual({
      query: 'aspirin',
      cache: 'miss',
      results: [{ cid: 2244, name: 'Aspirin', formula: 'C9H8O4', mw: 180.16 }],
    });
    expect(pubchem.cidsByName).toHaveBeenCalledWith('aspirin', 5);
    expect(pubchem.properties).toHaveBeenCalledWith([2244]);
    expect(store.compounds.has(2244)).toBe(true);
  });

  it('second identical search is served from Postgres with zero PubChem calls', async () => {
    const store = new MemoryStore();
    const pubchem = fakePubChem();
    const svc = new CompoundService(store, pubchem, quietLog, { cache: noCache });
    await svc.search('aspirin');
    const before = pubchemCalls(pubchem);

    const r = await svc.search('ASPIRIN');
    expect(r.cache).toBe('db');
    expect(pubchemCalls(pubchem)).toBe(before);
  });

  it('a stored synonym also hits Postgres (no PubChem call)', async () => {
    const store = new MemoryStore();
    const pubchem = fakePubChem();
    const svc = new CompoundService(store, pubchem, quietLog, { cache: noCache });
    await svc.search('aspirin');
    const before = pubchemCalls(pubchem);

    const r = await svc.search('Acetylsalicylic   Acid');
    expect(r.cache).toBe('db');
    expect(r.results[0]?.cid).toBe(2244);
    expect(pubchemCalls(pubchem)).toBe(before);
  });

  it('not found in PubChem → empty results, nothing stored', async () => {
    const store = new MemoryStore();
    const svc = new CompoundService(store, fakePubChem(), quietLog, { cache: noCache });
    await expect(svc.search('asprinnn')).resolves.toEqual({ query: 'asprinnn', cache: 'miss', results: [] });
    expect(store.compounds.size).toBe(0);
  });

  it('a numeric query is treated as a CID', async () => {
    const pubchem = fakePubChem();
    const svc = new CompoundService(new MemoryStore(), pubchem, quietLog, { cache: noCache });
    const r = await svc.search('2244');
    expect(r.results.map((x) => x.cid)).toEqual([2244]);
    expect(pubchem.cidsByName).not.toHaveBeenCalled();
  });

  it('still returns results when the synonym fetch fails', async () => {
    const pubchem = fakePubChem();
    pubchem.synonyms.mockRejectedValueOnce(new PubChemError('busy', 'THROTTLED', 503));
    const svc = new CompoundService(new MemoryStore(), pubchem, quietLog, { cache: noCache });
    const r = await svc.search('aspirin');
    expect(r.results).toHaveLength(1);
  });

  it('propagates upstream errors other than not-found', async () => {
    const pubchem = fakePubChem();
    pubchem.cidsByName.mockRejectedValueOnce(new PubChemError('busy', 'THROTTLED', 503));
    const svc = new CompoundService(new MemoryStore(), pubchem, quietLog, { cache: noCache });
    await expect(svc.search('aspirin')).rejects.toMatchObject({ code: 'THROTTLED' });
  });
});

describe('CompoundService.detail', () => {
  it('fetches from PubChem once, then serves from Postgres', async () => {
    const pubchem = fakePubChem();
    const svc = new CompoundService(new MemoryStore(), pubchem, quietLog, { cache: noCache });
    const first = await svc.detail(2244);
    expect(first.value?.synonyms).toContain('50-78-2');
    await svc.detail(2244);
    expect(pubchem.properties).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown CID', async () => {
    const svc = new CompoundService(new MemoryStore(), fakePubChem(), quietLog, { cache: noCache });
    await expect(svc.detail(999999999)).resolves.toMatchObject({ value: null });
  });
});
