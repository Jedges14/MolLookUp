import { defineConfig, mergeConfig } from 'vitest/config';
import integration from './vitest.int.config.js';

// Unit + integration tests in one run so coverage reflects both (needs Docker for Testcontainers).
export default mergeConfig(
  integration,
  defineConfig({
    test: {
      include: ['test/unit/**/*.test.ts', 'test/integration/**/*.int.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        // Process wiring only (env, listen, signals); everything it composes is tested.
        exclude: ['src/server.ts'],
        reporter: ['text', 'text-summary', 'json-summary', 'html'],
      },
    },
  }),
);
