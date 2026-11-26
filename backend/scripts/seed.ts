/**
 * Seed Postgres with the frontend's "molecule of the day" list.
 * Makes exactly one batched PubChem property request (all CIDs at once) through the shared limiter.
 * Usage: npm run seed   (needs DATABASE_URL; run migrations first)
 */
import { existsSync } from 'node:fs';
import pg from 'pg';
import { loadConfig } from '../src/config.js';
import { PgCompoundStore } from '../src/db/compoundRepo.js';
import { PubChemClient } from '../src/pubchem/client.js';
import { TokenBucket } from '../src/pubchem/rateLimiter.js';

if (existsSync('.env')) process.loadEnvFile('.env');

interface Molecule {
  name: string;
  cid: number;
  formula: string;
}

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
const client = new PubChemClient({
  baseUrl: config.PUBCHEM_BASE_URL,
  userAgent: config.PUBCHEM_USER_AGENT,
  limiter: new TokenBucket(config.PUBCHEM_RPS),
});

try {
  // Plain JS module owned by the frontend; loaded at runtime so the backend build doesn't include it.
  const moleculesUrl = new URL('../../frontend/src/molecules.js', import.meta.url).href;
  const list = (await import(moleculesUrl)).default as Molecule[];
  const compounds = await client.properties(list.map((m) => m.cid));
  const byCid = new Map(compounds.map((c) => [c.cid, c]));

  let mismatches = 0;
  for (const m of list) {
    const c = byCid.get(m.cid);
    if (!c) {
      console.warn(`! CID ${m.cid} (${m.name}) not returned by PubChem`);
      mismatches++;
    } else if (c.formula !== m.formula) {
      console.warn(`! ${m.name}: molecules.js formula ${m.formula} ≠ PubChem ${c.formula} (CID ${m.cid})`);
      mismatches++;
    }
  }

  const synonyms = new Map(list.map((m) => [m.cid, [m.name]]));
  await new PgCompoundStore(pool).save(compounds, synonyms);
  console.log(`Seeded ${compounds.length} compounds; ${mismatches} mismatch(es) with molecules.js.`);
  if (mismatches > 0) process.exitCode = 1;
} finally {
  await pool.end();
}
