/**
 * Starts the API for the Playwright E2E run against an isolated database and Redis DB index:
 * creates the E2E database if needed, applies migrations, empties its tables and Redis DB, then starts the server.
 * Refuses to run unless the database name ends in "_e2e", because it truncates tables.
 */
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { createClient } from 'redis';

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!dbUrl || !/_e2e$/.test(new URL(dbUrl).pathname)) {
  throw new Error('e2e-api: DATABASE_URL must point at a database whose name ends in _e2e');
}
if (!redisUrl) throw new Error('e2e-api: REDIS_URL is required');

const dbName = new URL(dbUrl).pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(dbName)) throw new Error(`e2e-api: unexpected database name ${dbName}`);
const adminUrl = new URL(dbUrl);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${dbName}`);
await admin.end();

await runner({
  databaseUrl: dbUrl,
  dir: 'migrations',
  direction: 'up',
  migrationsTable: 'pgmigrations',
  log: () => undefined,
});
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
await db.query('TRUNCATE compound_synonyms, compounds');
await db.end();

const redis = createClient({ url: redisUrl });
await redis.connect();
await redis.flushDb();
await redis.close();

await import('../src/server.js');
