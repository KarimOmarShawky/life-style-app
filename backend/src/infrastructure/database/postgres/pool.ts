/**
 * PostgreSQL connection pool and transaction helper.
 *
 * Spec sections 6, 30 and 31.
 *
 * Pooling matters because Postgres backends are processes, not threads: opening
 * a connection per request exhausts the server long before the application is
 * under real load. Every query in the codebase goes through this module.
 */
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { config } from '@/config';
import { AppError } from '@/core/errors';
import { createLogger, maskConnectionString } from '@/core/logger';

const log = createLogger('postgres');

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: config.DATABASE_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,
    // A runaway query holds a pool slot and can cascade into an outage. The
    // server-side timeout cancels it even if the client has gone away.
    statement_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    query_timeout: config.DATABASE_STATEMENT_TIMEOUT_MS,
    application_name: 'lifestyle-api',
  });

  // An idle client can fail from the server side (restart, failover, idle
  // termination). Without this listener the error is unhandled and takes the
  // process down; pg removes the bad client from the pool on its own.
  pool.on('error', (error) => {
    log.error({ err: error }, 'Idle PostgreSQL client errored and was discarded');
  });

  return pool;
}

/**
 * Runs a parameterized query.
 *
 * `text` must contain only $1-style placeholders. Never interpolate user input
 * into it: parameterization is what makes SQL injection structurally impossible
 * (spec section 14). Identifiers cannot be parameterized, so any dynamic column
 * or sort direction must come from a hardcoded allowlist, not from the request.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  const startedAt = process.hrtime.bigint();

  try {
    const result = await getPool().query<T>(text, params as unknown[]);

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (durationMs > 500) {
      // The SQL text is logged, the parameters are not: parameters are user data.
      log.warn({ durationMs, sql: text.replace(/\s+/g, ' ').slice(0, 200) }, 'Slow query');
    }

    return result;
  } catch (error) {
    log.error(
      { err: error, sql: text.replace(/\s+/g, ' ').slice(0, 200) },
      'PostgreSQL query failed',
    );
    throw error;
  }
}

/**
 * Runs `work` inside a single transaction, committing on success and rolling
 * back on any throw.
 *
 * Spec section 31. The callback receives the dedicated client and MUST use it
 * for every statement: calling the module-level `query` inside the callback
 * takes a different pooled connection, which is outside the transaction and
 * silently breaks atomicity. That is the one real footgun here.
 *
 * Example, the atomic event-plus-reminder write required by the ERD:
 *
 *   await withTransaction(async (tx) => {
 *     const event = await insertEvent(tx, input);
 *     await insertReminder(tx, defaultReminderFor(event));
 *     return event;
 *   });
 */
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // The rollback itself failing means the connection is broken. Log it and
      // rethrow the ORIGINAL error, which is the one that explains the failure.
      log.error({ err: rollbackError }, 'ROLLBACK failed; connection is likely broken');
    }
    throw error;
  } finally {
    // Must run on every path or the pool leaks a slot per failed transaction.
    client.release();
  }
}

/** Verifies the database answers. Used by the readiness probe (spec section 47). */
export async function pingPostgres(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    log.error({ err: error }, 'PostgreSQL health check failed');
    return false;
  }
}

export async function connectPostgres(): Promise<void> {
  const ok = await pingPostgres();
  if (!ok) {
    throw AppError.serviceUnavailable('postgres');
  }
  log.info({ url: maskConnectionString(config.DATABASE_URL) }, 'PostgreSQL connected');
}

/** Drains the pool during graceful shutdown (spec section 48). */
export async function closePostgres(): Promise<void> {
  if (!pool) {
    return;
  }
  const current = pool;
  pool = undefined;
  await current.end();
  log.info('PostgreSQL pool closed');
}

export type { PoolClient, QueryResult };
