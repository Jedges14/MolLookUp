import { defineConfig } from 'vitest/config';

// Integration tests: real Postgres + Redis via Testcontainers (needs Docker). PubChem is always faked.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
