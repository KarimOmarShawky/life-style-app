import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Integration and security tiers.
 *
 * These are the suites that need a real PostgreSQL, and optionally MongoDB and
 * Redis. The unit tier has its own config with no setupFiles; see
 * `vitest.unit.config.ts` for why the two cannot share one.
 *
 * WHY UNIT TESTS ARE NOT INCLUDED HERE. `test/setup.ts` runs once per test
 * FILE, and it opens a MongoDB connection and closes three clients every time.
 * When this config also matched `test/unit/**`, sixteen files of pure functions
 * each paid that cost: `app-error.test.ts` — eleven assertions about an error
 * class, no I/O of any kind — took 18 seconds. Nearly five minutes of a local
 * run was unit tests waiting on databases they never touch. `npm test` runs both
 * tiers, so nothing is lost by separating them.
 *
 * WHY FILES MAY NOW RUN IN PARALLEL. This said `fileParallelism: false` and
 * `maxWorkers: 1`, on the grounds that the files share one database and one
 * run's teardown could close connections another run was using. That is true
 * within a process and false across processes: `pool: 'forks'` gives every file
 * its own process and therefore its own pool, `closePostgres` closes only that
 * pool, and `TEST_PREFIX` includes `process.pid` precisely so concurrent runs
 * cannot collide. The suites were already written for this — `test/setup.ts`
 * forbids asserting on global counts and forbids TRUNCATE.
 *
 * These suites are latency-bound, not CPU-bound: almost all of their wall-clock
 * is spent waiting for a database in another region. That is exactly the shape
 * of work that parallelises well, and why the worker count is not tied to the
 * core count.
 */

/**
 * Six workers suit a developer machine: twelve cores mostly idle, waiting on a
 * database in another country. A CI runner is the opposite — two cores, and
 * PostgreSQL in a container on localhost, where a round trip costs microseconds
 * instead of milliseconds. There the same six forks would contend for two cores
 * and win nothing, so the number that makes a local run ten times faster is not
 * the number CI should use.
 */
const maxWorkers = process.env.CI ? 2 : 6;

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/integration/**/*.test.ts', 'test/security/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      // Six workers times ten connections would be sixty for a test run. Neon's
      // ceiling is well above that, but nothing here needs more than a handful
      // per process, and an exhausted pool fails as a timeout that looks like a
      // slow query rather than like the resource problem it is.
      DATABASE_POOL_MAX: '4',
      // Six workers open six Atlas handshakes at once, and 8000 — the right
      // budget for a live request, where failing fast beats hanging — is not
      // enough for all of them. A fork that loses that race does not crash: it
      // degrades, and every note endpoint in it answers 503, which surfaces as a
      // whole suite failing for a reason that has nothing to do with notes.
      MONGODB_SERVER_SELECTION_TIMEOUT_MS: '20000',
    },
    setupFiles: ['test/setup.ts'],
    pool: 'forks',
    fileParallelism: true,
    maxWorkers,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
