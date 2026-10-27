import { defineConfig } from 'vitest/config';

const shared = {
  environment: 'node' as const,
  setupFiles: ['tests/helpers/setup.ts'],
  env: { TZ: 'Europe/Berlin' },
  pool: 'forks' as const,
};

export default defineConfig({
  test: {
    projects: [
      { test: { ...shared, name: 'unit', include: ['tests/unit/**/*.test.ts'], testTimeout: 20_000 } },
    ],
  },
});
