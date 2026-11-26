// SPEC §5 benchmark 1: search latency with caching disabled vs. warm cache.
//
// Runs the built API (backend/dist/server.js) as a local process against its own database
// (mollookup_bench) and Redis DB 2, so dev data can't pre-warm anything. Passes, in order:
//   uncached   CACHE_BYPASS=true: every query goes to PubChem (no Redis/Postgres reads or writes)
//   cold       normal mode, empty Redis + Postgres: every query misses, then fills both tiers
//   warm-redis normal mode, same queries again: served from Redis
//   warm-db    Redis flushed, Postgres kept: served from Postgres (and re-warms Redis)
// Queries run one at a time (latency, not throughput). Outbound PubChem traffic is capped by the
// API's token bucket (<=4 req/s) and the script reports the observed rate per pass.
//
// Prereqs: docker compose up -d postgres redis; cd backend && npm ci && npm run build
// Usage:   node bench/latency.mjs            (from the repo root)

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'mollookup_bench';
const DATABASE_URL = `postgres://mollookup:mollookup@localhost:5432/${DB}`;
const REDIS_URL = 'redis://localhost:6379/2';

const queries = readFileSync(join(ROOT, 'bench/compounds.txt'), 'utf8')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
if (queries.length !== 200) throw new Error(`expected 200 queries, got ${queries.length}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const compose = (...args) =>
  execFileSync('docker', ['compose', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const psql = (db, sql) => compose('exec', '-T', 'postgres', 'psql', '-U', 'mollookup', '-d', db, '-tAc', sql).trim();

function resetStores() {
  if (psql('postgres', `SELECT 1 FROM pg_database WHERE datname='${DB}'`) !== '1') {
    psql('postgres', `CREATE DATABASE ${DB}`);
  }
  execFileSync('npm', ['run', 'migrate'], {
    cwd: join(ROOT, 'backend'),
    env: { ...process.env, DATABASE_URL },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  psql(DB, 'TRUNCATE compound_synonyms, compounds');
  flushRedis();
}
const flushRedis = () => compose('exec', '-T', 'redis', 'redis-cli', '-n', '2', 'FLUSHDB');

async function startApi(extraEnv) {
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: join(ROOT, 'backend'),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      DATABASE_URL,
      REDIS_URL,
      LOG_LEVEL: 'warn',
      CACHE_ONLY: 'false',
      CACHE_BYPASS: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i++) {
    try {
      const h = await (await fetch(`${BASE}/health`)).json();
      if (h.db === 'ok' && h.redis === 'ok') return child;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  child.kill();
  throw new Error('API did not become healthy');
}

async function stopApi(child) {
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
}

const pubchemRequests = async () => (await (await fetch(`${BASE}/metrics`)).json()).pubchem.requests;

async function runPass(label) {
  const rows = [];
  const pubchemBefore = await pubchemRequests();
  const started = performance.now();
  for (const q of queries) {
    const t0 = performance.now();
    let status = -1;
    let cache = null;
    let n = null;
    try {
      const res = await fetch(`${BASE}/api/compounds/search?q=${encodeURIComponent(q)}`);
      status = res.status;
      cache = res.headers.get('x-cache');
      const body = await res.json();
      n = Array.isArray(body.results) ? body.results.length : null;
    } catch {
      // network error: recorded as status -1
    }
    rows.push({ q, status, cache, n, ms: performance.now() - t0 });
  }
  const seconds = (performance.now() - started) / 1000;
  const pubchem = (await pubchemRequests()) - pubchemBefore;
  return { label, rows, seconds, pubchem };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
function summarize(pass) {
  const ok = pass.rows.filter((r) => r.status === 200);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  const tiers = {};
  for (const r of pass.rows) tiers[r.cache ?? 'none'] = (tiers[r.cache ?? 'none'] ?? 0) + 1;
  return {
    label: pass.label,
    n: pass.rows.length,
    ok: ok.length,
    errors: pass.rows.length - ok.length,
    found: ok.filter((r) => r.n > 0).length,
    notFound: ok.filter((r) => r.n === 0).length,
    meanMs: ms.reduce((a, b) => a + b, 0) / ms.length,
    p50Ms: pct(ms, 50),
    p95Ms: pct(ms, 95),
    minMs: ms[0],
    maxMs: ms[ms.length - 1],
    tiers,
    pubchemRequests: pass.pubchem,
    pubchemReqPerSec: pass.pubchem / pass.seconds,
    wallSeconds: pass.seconds,
  };
}

const fmt = (n) => n.toFixed(1);
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() !== '';

console.log(`Resetting ${DB} and Redis DB 2…`);
resetStores();

const passes = [];
let api = await startApi({ CACHE_BYPASS: 'true' });
console.log('Pass 1/4 uncached (CACHE_BYPASS, every query → PubChem)…');
passes.push(await runPass('uncached'));
await stopApi(api);

resetStores();
api = await startApi({});
console.log('Pass 2/4 cold (empty caches, normal mode)…');
passes.push(await runPass('cold'));
console.log('Pass 3/4 warm-redis…');
passes.push(await runPass('warm-redis'));
flushRedis();
console.log('Pass 4/4 warm-db (Redis flushed, Postgres kept)…');
passes.push(await runPass('warm-db'));
await stopApi(api);

const summaries = passes.map(summarize);
const byLabel = Object.fromEntries(summaries.map((s) => [s.label, s]));
const reduction = (label) => 1 - byLabel[label].meanMs / byLabel.uncached.meanMs;

const result = {
  benchmark: 'search latency, caching disabled vs warm (SPEC §5.1)',
  date: new Date().toISOString(),
  commit: dirty ? `${commit}+uncommitted` : commit,
  machine: {
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    cpus: os.cpus().length,
    memGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
    node: process.version,
  },
  setup: 'API = node backend/dist/server.js on the same machine; Postgres 17 + Redis 8 in Docker; sequential queries',
  summaries,
  reductionVsUncached: {
    'warm-redis': reduction('warm-redis'),
    'warm-db': reduction('warm-db'),
  },
  rows: Object.fromEntries(passes.map((p) => [p.label, p.rows])),
};

mkdirSync(join(ROOT, 'bench/results'), { recursive: true });
const out = join(ROOT, `bench/results/latency-${result.date.replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify(result, null, 2) + '\n');

console.log('\n| Pass | ok/err | found/not found | mean ms | p50 ms | p95 ms | tiers (X-Cache) | PubChem req (req/s) |');
console.log('|---|---|---|---|---|---|---|---|');
for (const s of summaries) {
  const tiers = Object.entries(s.tiers).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(
    `| ${s.label} | ${s.ok}/${s.errors} | ${s.found}/${s.notFound} | ${fmt(s.meanMs)} | ${fmt(s.p50Ms)} | ${fmt(s.p95Ms)} | ${tiers} | ${s.pubchemRequests} (${s.pubchemReqPerSec.toFixed(2)}) |`,
  );
}
console.log(
  `\nMean latency reduction vs uncached: warm-redis ${(reduction('warm-redis') * 100).toFixed(1)}%, warm-db ${(reduction('warm-db') * 100).toFixed(1)}%`,
);
console.log(`Saved ${out}`);
