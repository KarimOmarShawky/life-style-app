/**
 * Test bootstrap.
 *
 * NOTE ON THE TEST DATABASE. Integration tests run against the SAME PostgreSQL
 * instance as development, not an isolated one, because provisioning a second
 * database is not free on a hosted plan. Isolation is achieved instead by giving
 * every test run a unique email prefix and deleting those users afterwards;
 * `ON DELETE CASCADE` removes everything that hangs off them.
 *
 * The trade-off: tests must never assert on global counts, and must never
 * TRUNCATE. Both would destroy development data. If this project later gains a
 * CI pipeline, point DATABASE_URL at a throwaway branch there and this
 * restriction disappears.
 */
import { afterAll, beforeAll } from 'vitest';

import { config } from '@/config';
import { closePostgres, query } from '@/infrastructure/database/postgres/pool';
import { closeRedis } from '@/infrastructure/database/redis/client';
import {
  closeMongo,
  connectMongo,
  isMongoConnected,
} from '@/infrastructure/database/mongodb/connection';
import { NoteModel } from '@/infrastructure/database/mongodb/note.model';

/** Unique to this run, so parallel runs cannot collide. */
export const TEST_PREFIX = `vitest-${process.pid}-${Date.now()}`;

export function testEmail(label: string): string {
  return `${TEST_PREFIX}-${label}@example.test`;
}

export const STRONG_PASSWORD = 'CorrectHorse9Battery';

/**
 * Whether this run is configured to use MongoDB.
 *
 * Read from configuration rather than from the live connection, because suites
 * decide whether to skip while they are being collected, which happens before
 * any hook has run. The consequence is deliberate: if MONGODB_URI is set but the
 * server is unreachable, the note suites RUN and FAIL rather than quietly
 * skipping. A configured database that is down is a broken environment, not a
 * reason to report green.
 */
export const MONGO_CONFIGURED = (config.MONGODB_URI ?? '').length > 0;

/**
 * MongoDB is connected here rather than by the app, because `createApp` builds
 * the Express application only; `server.ts` owns process-level connections and
 * integration tests never start a server.
 *
 * With no MONGODB_URI this is a no-op: the note suites skip themselves and the
 * degradation suite runs in their place, so a developer without MongoDB still
 * gets a green and meaningful run.
 */
beforeAll(async () => {
  if (!isMongoConnected()) {
    await connectMongo();
  }
});

afterAll(async () => {
  // Notes are removed BEFORE their users, because the lookup that finds them
  // reads the user ids out of PostgreSQL. There is no cascade across the
  // database boundary; this function is that cascade.
  if (isMongoConnected()) {
    const users = await query<{ id: string }>('SELECT id FROM users WHERE email LIKE $1', [
      `${TEST_PREFIX}%`,
    ]);
    const ids = users.rows.map((row) => row.id);
    if (ids.length > 0) {
      await NoteModel.deleteMany({ userId: { $in: ids } });
    }
  }

  // Scoped to this run's prefix only.
  await query('DELETE FROM users WHERE email LIKE $1', [`${TEST_PREFIX}%`]);
  await closeRedis();
  await closeMongo();
  await closePostgres();
});
