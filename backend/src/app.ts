import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { z, ZodError } from 'zod';
import type { Cache } from './cache.js';
import { CacheOnlyMissError, type CompoundService } from './compoundService.js';
import type { CompoundStore } from './db/compoundRepo.js';
import type { FactService } from './fact.js';
import type { Metrics } from './metrics.js';
import { PubChemError } from './pubchem/client.js';

export interface AppDeps {
  compounds: Pick<CompoundService, 'search' | 'detail' | 'image'>;
  store: Pick<CompoundStore, 'ping'>;
  cache: Pick<Cache, 'ping'>;
  facts: Pick<FactService, 'today' | 'enabled'>;
  metrics: Pick<Metrics, 'middleware' | 'snapshot'>;
  logger: Logger;
  corsOrigin: string;
  cacheOnly?: boolean;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const searchQuerySchema = z.object({
  q: z
    .string({ error: 'q is required' })
    .trim()
    .min(1, 'q must not be empty')
    .max(200, 'q must be at most 200 characters'),
});

const cidParamSchema = z.object({
  cid: z.coerce
    .number({ error: 'cid must be a number' })
    .int('cid must be an integer')
    .positive('cid must be positive')
    .max(2_147_483_647, 'cid is too large'),
});

const sendError = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');

  app.use(
    pinoHttp({
      logger: deps.logger,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : 'info'),
    }),
  );

  // Production frontend is served from another origin (Vercel/Netlify); in dev the Vite proxy is same-origin.
  app.use((req, res, next) => {
    if (req.headers.origin === deps.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', deps.corsOrigin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  });

  app.use(deps.metrics.middleware());

  // Postgres is required; Redis is optional (the API falls back to Postgres without it).
  app.get('/health', async (_req, res) => {
    const [db, redis] = await Promise.all([
      deps.store.ping().then(
        () => 'ok' as const,
        () => 'unreachable' as const,
      ),
      deps.cache.ping().then((ok) => (ok ? ('ok' as const) : ('unreachable' as const))),
    ]);
    const body = { status: db === 'ok' ? 'ok' : 'degraded', db, redis, cacheOnly: deps.cacheOnly ?? false };
    res.status(db === 'ok' ? 200 : 503).json(body);
  });

  app.get('/metrics', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(deps.metrics.snapshot());
  });

  app.get('/api/compounds/search', async (req: Request, res: Response) => {
    const { q } = searchQuerySchema.parse(req.query);
    const result = await deps.compounds.search(q);
    res.setHeader('X-Cache', result.cache);
    res.json({ query: result.query, results: result.results });
  });

  app.get('/api/compounds/:cid', async (req: Request, res: Response) => {
    const { cid } = cidParamSchema.parse(req.params);
    const { value: record, cache } = await deps.compounds.detail(cid);
    res.setHeader('X-Cache', cache);
    if (!record) throw new HttpError(404, 'NOT_FOUND', `No compound with CID ${cid}`);
    res.json(record);
  });

  app.get('/api/compounds/:cid/image', async (req: Request, res: Response) => {
    const { cid } = cidParamSchema.parse(req.params);
    const { value: img, cache } = await deps.compounds.image(cid);
    res.setHeader('X-Cache', cache);
    if (!img) throw new HttpError(404, 'NOT_FOUND', `No structure image for CID ${cid}`);
    res.setHeader('Content-Type', img.contentType);
    // Structures don't change; let browsers and CDNs keep them for a day, serve stale for a week.
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.send(img.body);
  });

  app.get('/api/fact', async (_req, res) => {
    if (!deps.facts.enabled) throw new HttpError(503, 'FACT_UNAVAILABLE', 'Daily fact is not configured');
    try {
      res.json({ fact: await deps.facts.today() });
    } catch (err) {
      deps.logger.warn({ err }, 'fact fetch failed');
      throw new HttpError(503, 'FACT_UNAVAILABLE', 'Daily fact is unavailable right now');
    }
  });

  app.use((_req, res) => sendError(res, 404, 'NOT_FOUND', 'Route not found'));

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof ZodError) {
      return sendError(res, 400, 'INVALID_INPUT', err.issues.map((i) => i.message).join('; '));
    }
    if (err instanceof HttpError) return sendError(res, err.status, err.code, err.message);
    if (err instanceof CacheOnlyMissError) return sendError(res, 503, 'CACHE_MISS', err.message);
    if (err instanceof PubChemError) {
      req.log?.warn({ err }, 'pubchem error');
      if (err.code === 'NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'Not found in PubChem');
      if (err.code === 'THROTTLED' || err.code === 'TIMEOUT') {
        return sendError(res, 503, 'UPSTREAM_BUSY', 'PubChem is busy; please try again shortly');
      }
      return sendError(res, 502, 'UPSTREAM_ERROR', 'PubChem returned an unexpected response');
    }
    req.log?.error({ err }, 'unhandled error');
    return sendError(res, 500, 'INTERNAL', 'Something went wrong');
  };
  app.use(onError);

  return app;
}
