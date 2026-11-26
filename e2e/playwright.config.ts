import { defineConfig, devices } from '@playwright/test';

// Full stack for E2E: real Vite frontend + real API + real Postgres/Redis, with PubChem replaced by a mock.
// Postgres and Redis must already be running (docker compose up -d postgres redis, or CI service containers).
const DB = process.env.E2E_DATABASE_URL ?? 'postgres://mollookup:mollookup@localhost:5432/mollookup_e2e';
const REDIS = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/1';
const MOCK_PORT = 4010;
const API_PORT = 3101;
const WEB_PORT = 5174;
// Set E2E_BASE_URL to smoke-test an already-running deployment instead of starting the local stack.
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: REMOTE ?? `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: REMOTE ? undefined : [
    {
      command: 'node mock-pubchem.mjs',
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      env: { MOCK_PUBCHEM_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
    },
    {
      command: 'npx tsx scripts/e2e-api.ts',
      cwd: '../backend',
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL: DB,
        REDIS_URL: REDIS,
        PUBCHEM_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/rest/pug`,
        CORS_ORIGIN: `http://127.0.0.1:${WEB_PORT}`,
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --host 127.0.0.1',
      cwd: '../frontend',
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { WEB_PORT: String(WEB_PORT), API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
