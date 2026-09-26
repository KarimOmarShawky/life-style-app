/**
 * PostgreSQL migration runner (spec section 30).
 *
 * Plain numbered .sql files applied in order and recorded in `schema_migrations`.
 *
 * Why hand-written rather than a migration library: the whole mechanism is about
 * a hundred lines, it adds no dependency, and it keeps the migrations themselves
 * as ordinary SQL that a DBA can read and a reviewer can diff. The trade-off is
 * that there is no automatic `down` step. That is deliberate. Reversal is done by
 * writing a new forward migration, because a generated rollback that silently
 * drops a column is more dangerous than not having one (see the decision log).
 *
 * Two safety properties worth understanding:
 *
 *   1. A session-level advisory lock serializes runners, so two instances
 *      starting at once during a rolling deploy cannot apply the same file twice.
 *   2. Every applied file's checksum is stored. Editing a migration that has
 *      already run is rejected, because the database no longer matches the file
 *      and every other environment would diverge.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { getPool, closePostgres, type PoolClient } from './pool';
import { createLogger } from '@/core/logger';

const log = createLogger('postgres.migrate');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** Arbitrary but fixed key identifying this application's migration lock. */
const ADVISORY_LOCK_KEY = 8_273_411_902_551;

interface MigrationFile {
  readonly id: string;
  readonly sql: string;
  readonly checksum: string;
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  const migrations: MigrationFile[] = [];
  for (const name of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), 'utf8');
    migrations.push({
      id: name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }

  return migrations;
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      checksum    TEXT        NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER     NOT NULL
    )
  `);
}

interface AppliedRow {
  id: string;
  checksum: string;
}

async function getApplied(client: PoolClient): Promise<Map<string, string>> {
  const result = await client.query<AppliedRow>('SELECT id, checksum FROM schema_migrations');
  return new Map(result.rows.map((row) => [row.id, row.checksum]));
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: number }> {
  const client = await getPool().connect();
  const applied: string[] = [];
  let skipped = 0;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureMigrationsTable(client);

    const alreadyApplied = await getApplied(client);
    const migrations = await loadMigrations();

    for (const migration of migrations) {
      const previousChecksum = alreadyApplied.get(migration.id);

      if (previousChecksum !== undefined) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.id} has been modified after it was applied. ` +
              `Applied checksum ${previousChecksum.slice(0, 12)}, ` +
              `file checksum ${migration.checksum.slice(0, 12)}. ` +
              `Write a new migration instead of editing this one.`,
          );
        }
        skipped += 1;
        continue;
      }

      const startedAt = Date.now();
      log.info({ migration: migration.id }, 'Applying migration');

      // One transaction per file: a failing migration leaves no partial schema.
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (id, checksum, duration_ms) VALUES ($1, $2, $3)',
          [migration.id, migration.checksum, Date.now() - startedAt],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${migration.id} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
          { cause: error },
        );
      }

      applied.push(migration.id);
      log.info(
        { migration: migration.id, durationMs: Date.now() - startedAt },
        'Migration applied',
      );
    }

    return { applied, skipped };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

export async function migrationStatus(): Promise<
  { id: string; applied: boolean; modified: boolean }[]
> {
  const client = await getPool().connect();
  try {
    await ensureMigrationsTable(client);
    const alreadyApplied = await getApplied(client);
    const migrations = await loadMigrations();

    return migrations.map((migration) => {
      const previous = alreadyApplied.get(migration.id);
      return {
        id: migration.id,
        applied: previous !== undefined,
        modified: previous !== undefined && previous !== migration.checksum,
      };
    });
  } finally {
    client.release();
  }
}

/** CLI entry point: `npm run migrate` / `npm run migrate:status`. */
async function main(): Promise<void> {
  const command = process.argv[2] ?? 'up';

  if (command === 'up') {
    const { applied, skipped } = await runMigrations();
    log.info({ applied: applied.length, skipped }, 'Migrations complete');
    if (applied.length === 0) {
      log.info('Database is already up to date');
    }
    return;
  }

  if (command === 'status') {
    const status = await migrationStatus();
    for (const entry of status) {
      const state = entry.modified ? 'MODIFIED' : entry.applied ? 'applied' : 'pending';
      log.info({ migration: entry.id, state }, 'Migration status');
    }
    return;
  }

  throw new Error(`Unknown command "${command}". Use "up" or "status".`);
}

if (require.main === module) {
  main()
    .then(async () => {
      await closePostgres();
      process.exit(0);
    })
    .catch(async (error: unknown) => {
      log.error({ err: error }, 'Migration run failed');
      await closePostgres().catch(() => undefined);
      process.exit(1);
    });
}
