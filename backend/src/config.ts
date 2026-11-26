import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  PUBCHEM_BASE_URL: z.url().default('https://pubchem.ncbi.nlm.nih.gov/rest/pug'),
  // PubChem's published limit is 5 req/s; never allow configuring above 4.
  PUBCHEM_RPS: z.coerce.number().positive().max(4).default(4),
  PUBCHEM_USER_AGENT: z.string().min(1).default('MolLookUp/0.1 (portfolio project)'),
  PUBCHEM_TIMEOUT_MS: z.coerce.number().int().positive().max(30_000).default(30_000),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  NEGATIVE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  IMAGE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  // Load-test mode: a full cache miss returns 503 instead of calling PubChem.
  CACHE_ONLY: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  // Benchmark baseline: bypass Redis and Postgres entirely. Refused in production (see below).
  CACHE_BYPASS: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  RAPIDAPI_KEY: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.CACHE_BYPASS && cfg.NODE_ENV === 'production') {
    throw new Error('Invalid configuration: CACHE_BYPASS is for benchmarks only and is not allowed in production');
  }
  if (cfg.CACHE_BYPASS && cfg.CACHE_ONLY) {
    throw new Error('Invalid configuration: CACHE_BYPASS and CACHE_ONLY cannot both be set');
  }
  return cfg;
}
