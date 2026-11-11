/**
 * src/infrastructure/database/postgres/schema-capabilities.ts
 *
 * The production database is owner-managed and has no node-pg-migrate ledger,
 * so additive DDL (for example migration 1792750000000, product events and
 * onboarding) reaches it out of band via an owner-run SQL file. Code that
 * touches such objects must keep working until the DDL is applied: it either
 * checks for the object first (inside transactions, where a failed statement
 * would abort the whole unit of work) or treats "undefined table/column" as
 * "feature not available yet" (single statements outside transactions).
 */

import type pg from 'pg';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

/** PostgreSQL SQLSTATE 42P01 (undefined_table) or 42703 (undefined_column). */
export function isMissingSchemaObject(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return code === '42P01' || code === '42703';
}

/** True when `public.<table>` exists. Reads catalog metadata only. */
export async function tableExists(db: Queryable, table: string): Promise<boolean> {
  const res = await db.query<{ present: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS present',
    [`public.${table}`]
  );
  return res.rows[0]?.present === true;
}
