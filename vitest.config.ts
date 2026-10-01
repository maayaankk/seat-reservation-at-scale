import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'threads',
    poolOptions: {
      threads: { singleThread: true },
    },
    setupFiles: ['test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-change-in-production-min-32-chars-long',
      JWT_EXPIRES_IN: '24h',
      ADMIN_TOKEN: 'test-admin-token',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/seat_reservation',
      DATABASE_DIRECT_URL: 'postgres://postgres:postgres@localhost:5432/seat_reservation',
      ENABLE_DEV_AUTH: 'true',
    },
  },
});