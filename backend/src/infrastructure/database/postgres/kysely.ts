/**
 * src/infrastructure/database/postgres/kysely.ts
 *
 * Implements Section 4.5 & ADR-006: Kysely Query Builder instance over pg pool.
 */

import { Kysely, PostgresDialect } from 'kysely';
import { getPgPool } from './pool.js';

// Generic database schema interface (expanded in Phase P3 with all 22 entity tables)
export interface DatabaseSchema {
  [key: string]: unknown;
}

let kyselyDb: Kysely<DatabaseSchema> | null = null;

export function getKyselyDb(): Kysely<DatabaseSchema> {
  if (kyselyDb) {
    return kyselyDb;
  }

  const pool = getPgPool();
  kyselyDb = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool
    })
  });

  return kyselyDb;
}
