/**
 * src/infrastructure/database/postgres/pool.ts
 *
 * Implements Section 4.5 & 16.7: PostgreSQL connection pool management.
 * Connects with least-privilege runtime role (lifestyle_app).
 */

import pg from 'pg';
import { getEnv } from '../../../config/env.js';
import { logger } from '../../../core/logger/logger.js';
import { summarizeErrorForLog } from '../../../core/logger/log-minimization.js';

const { Pool } = pg;

// DATE is a civil day, not an instant. Keep it consistent with Kysely's string types.
pg.types.setTypeParser(1082, (value) => value);

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (pool) {
    return pool;
  }

  const env = getEnv();

  pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS
  });

  pool.on('error', (err) => {
    logger.error('Unexpected error on idle PostgreSQL client pool', summarizeErrorForLog(err));
  });

  return pool;
}

export async function checkPgHealth(timeoutMs = 1000): Promise<boolean> {
  const currentPool = getPgPool();
  try {
    const client = await Promise.race([
      currentPool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PostgreSQL connection timeout')), timeoutMs)
      )
    ]);

    try {
      await Promise.race([
        client.query('SELECT 1'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('PostgreSQL query timeout')), timeoutMs)
        )
      ]);
      return true;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.warn('PostgreSQL health check probe failed', { ...summarizeErrorForLog(err) });
    return false;
  }
}

export async function closePgPool(): Promise<void> {
  if (pool) {
    logger.info('Closing PostgreSQL connection pool...');
    await pool.end();
    pool = null;
    logger.info('PostgreSQL connection pool closed successfully.');
  }
}
