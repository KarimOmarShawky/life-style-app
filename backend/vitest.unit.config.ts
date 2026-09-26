import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Unit tier.
 *
 * Deliberately has NO setupFiles. The shared `test/setup.ts` imports the
 * configuration module, which fails fast when DATABASE_URL and the JWT secrets
 * are absent, and it deletes test users in teardown. Both are correct for the
 * integration tier and wrong for this one: a test that cannot run without a
 * database is not a unit test, and CI proved the point by failing this job on
 * every push while the integration job passed.
 *
 * The rule this encodes: `npm run test:unit` must pass on a machine with no
 * .env file, no database and no network.
 */
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    globals: true,
    include: ['test/unit/**/*.test.ts'],
    env: { NODE_ENV: 'test' },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
