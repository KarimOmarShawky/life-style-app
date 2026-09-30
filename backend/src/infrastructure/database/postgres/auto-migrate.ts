/**
 * src/infrastructure/database/postgres/auto-migrate.ts
 *
 * Ensures all required PostgreSQL extensions, tables, triggers, and indexes
 * exist on application boot, enabling zero-touch cloud deployment on Railway/Neon/Supabase.
 */

import type pg from 'pg';
import { logger } from '../../../core/logger/logger.js';
import { SCHEMA_SQL } from './schema-sql.js';

export async function ensureDatabaseSchema(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    const tableCheck = await client.query<{ exists: string | null }>(`
      SELECT to_regclass('public.users') as exists;
    `);

    if (tableCheck.rows[0]?.exists) {
      logger.info('Database schema verified: core tables already present.');
      return;
    }

    logger.info('Database uninitialized: bootstrapping schema and extensions...');

    // Execute schema DDL statements in transaction
    await client.query('BEGIN');
    await client.query(SCHEMA_SQL);
    await client.query('COMMIT');

    logger.info('Database schema bootstrap completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Database schema bootstrap encountered an error:', err);
  } finally {
    client.release();
  }
}
