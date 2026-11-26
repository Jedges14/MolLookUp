import { existsSync } from 'node:fs';
import pg from 'pg';
import { pino } from 'pino';
import { createApp } from './app.js';
import { RedisCache } from './cache.js';
import { CompoundService } from './compoundService.js';
import { loadConfig } from './config.js';
import { PgCompoundStore } from './db/compoundRepo.js';
import { FactService } from './fact.js';
import { Metrics } from './metrics.js';
import { PubChemClient } from './pubchem/client.js';
import { TokenBucket } from './pubchem/rateLimiter.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });
const metrics = new Metrics();

const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });
pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));

const cache = new RedisCache(config.REDIS_URL, logger);
cache.start();

// One limiter for the whole process: every PubChem call (search, detail, image) shares it.
const limiter = new TokenBucket(config.PUBCHEM_RPS);
const pubchem = new PubChemClient({
  baseUrl: config.PUBCHEM_BASE_URL,
  userAgent: config.PUBCHEM_USER_AGENT,
  timeoutMs: config.PUBCHEM_TIMEOUT_MS,
  limiter,
  onRequest: ({ url, attempt, status }) => {
    metrics.recordPubChemRequest(status);
    logger.debug({ url, attempt, status }, 'pubchem request');
  },
});
const store = new PgCompoundStore(pool);

const app = createApp({
  compounds: new CompoundService(store, pubchem, logger, {
    cache,
    cacheOnly: config.CACHE_ONLY,
    bypassCache: config.CACHE_BYPASS,
    metrics,
    ttls: {
      positiveSeconds: config.CACHE_TTL_SECONDS,
      negativeSeconds: config.NEGATIVE_CACHE_TTL_SECONDS,
      imageSeconds: config.IMAGE_CACHE_TTL_SECONDS,
    },
  }),
  store,
  cache,
  facts: new FactService(config.RAPIDAPI_KEY),
  metrics,
  logger,
  corsOrigin: config.CORS_ORIGIN,
  cacheOnly: config.CACHE_ONLY,
});

const server = app.listen(config.PORT, () =>
  logger.info({ port: config.PORT, cacheOnly: config.CACHE_ONLY, bypassCache: config.CACHE_BYPASS }, 'MolLookUp API listening'),
);

process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    void Promise.allSettled([pool.end(), cache.close()]).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
