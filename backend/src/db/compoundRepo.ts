import type { Pool, PoolClient } from 'pg';
import type { Compound } from '../pubchem/parse.js';

export interface CompoundRecord extends Compound {
  synonyms: string[];
  fetchedAt: string;
}

/** Storage interface the service depends on (lets unit tests use an in-memory fake). */
export interface CompoundStore {
  /** Compounds whose name or any stored synonym equals the normalized query (case-insensitive). */
  findByQuery(normalized: string, limit?: number): Promise<Compound[]>;
  getByCid(cid: number): Promise<CompoundRecord | null>;
  /** Upsert compounds and attach synonyms, atomically. */
  save(compounds: Compound[], synonyms: Map<number, string[]>): Promise<void>;
  ping(): Promise<void>;
}

interface CompoundRow {
  cid: number;
  name: string;
  iupac_name: string | null;
  formula: string | null;
  mol_weight: string | null;
  canonical_smiles: string | null;
  inchikey: string | null;
  xlogp: string | null;
  fetched_at: Date;
  synonyms?: string[] | null;
}

const toNum = (v: string | null): number | null => (v === null ? null : Number(v));

function fromRow(r: CompoundRow): Compound {
  return {
    cid: r.cid,
    name: r.name,
    iupacName: r.iupac_name,
    formula: r.formula,
    molWeight: toNum(r.mol_weight),
    canonicalSmiles: r.canonical_smiles,
    inchikey: r.inchikey,
    xlogp: toNum(r.xlogp),
  };
}

/** All SQL here is parameterized; user input never reaches a query string. */
export class PgCompoundStore implements CompoundStore {
  constructor(private readonly pool: Pool) {}

  async findByQuery(normalized: string, limit = 10): Promise<Compound[]> {
    const { rows } = await this.pool.query<CompoundRow>(
      `SELECT c.* FROM compounds c
        WHERE c.cid IN (
          SELECT cid FROM compound_synonyms WHERE lower(synonym) = $1
          UNION
          SELECT cid FROM compounds WHERE lower(name) = $1
        )
        ORDER BY c.cid
        LIMIT $2`,
      [normalized, limit],
    );
    return rows.map(fromRow);
  }

  async getByCid(cid: number): Promise<CompoundRecord | null> {
    const { rows } = await this.pool.query<CompoundRow>(
      `SELECT c.*,
              COALESCE(
                (SELECT array_agg(s.synonym ORDER BY s.synonym) FROM compound_synonyms s WHERE s.cid = c.cid),
                '{}'
              ) AS synonyms
         FROM compounds c
        WHERE c.cid = $1`,
      [cid],
    );
    const r = rows[0];
    if (!r) return null;
    return { ...fromRow(r), synonyms: r.synonyms ?? [], fetchedAt: r.fetched_at.toISOString() };
  }

  async save(compounds: Compound[], synonyms: Map<number, string[]>): Promise<void> {
    if (compounds.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await upsertCompounds(client, compounds);
      for (const [cid, list] of synonyms) {
        const clean = [...new Set(list.map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 500))];
        if (clean.length === 0) continue;
        await client.query(
          `INSERT INTO compound_synonyms (cid, synonym)
           SELECT $1, s FROM unnest($2::text[]) AS s
           ON CONFLICT DO NOTHING`,
          [cid, clean],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

async function upsertCompounds(client: PoolClient, compounds: Compound[]): Promise<void> {
  await client.query(
    `INSERT INTO compounds (cid, name, iupac_name, formula, mol_weight, canonical_smiles, inchikey, xlogp, fetched_at)
     SELECT * , now() FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::text[], $7::text[], $8::numeric[])
     ON CONFLICT (cid) DO UPDATE SET
       name = EXCLUDED.name,
       iupac_name = EXCLUDED.iupac_name,
       formula = EXCLUDED.formula,
       mol_weight = EXCLUDED.mol_weight,
       canonical_smiles = EXCLUDED.canonical_smiles,
       inchikey = EXCLUDED.inchikey,
       xlogp = EXCLUDED.xlogp,
       fetched_at = now()`,
    [
      compounds.map((c) => c.cid),
      compounds.map((c) => c.name),
      compounds.map((c) => c.iupacName),
      compounds.map((c) => c.formula),
      compounds.map((c) => c.molWeight),
      compounds.map((c) => c.canonicalSmiles),
      compounds.map((c) => c.inchikey),
      compounds.map((c) => c.xlogp),
    ],
  );
}
