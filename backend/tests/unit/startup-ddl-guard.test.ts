/**
 * tests/unit/startup-ddl-guard.test.ts
 *
 * Verifies Fix #3 (B-09) & Section 9 (/health/migrate removal):
 * - Normal application startup does NOT import or execute arbitrary schema DDL.
 * - `applyTestSchemaBootstrap` is strictly guarded against production/development execution.
 * - Authoritative migrations (`migrations/*.cjs`), `schema-sql.ts`, and `schema.sql` have zero table drift.
 * - `GET /health/migrate` remains absent (returns 404).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import {
  SCHEMA_SQL,
  applyTestSchemaBootstrap
} from '../../src/infrastructure/database/postgres/schema-sql.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(currentDir, '../..');
const repoRoot = resolve(backendRoot, '..');

function extractCreatedTables(sqlContent: string): string[] {
  const matches = sqlContent.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)/gi);
  return Array.from(new Set(Array.from(matches, (m) => m[1]!.toLowerCase()))).sort();
}

describe('Boot-Time Database DDL & Schema Drift Guard (B-09)', () => {
  it('ensures server.ts, worker.ts, app.ts, container.ts, and pool.ts never execute boot-time schema DDL', () => {
    const runtimeFiles = [
      'src/server.ts',
      'src/worker.ts',
      'src/app.ts',
      'src/container.ts',
      'src/infrastructure/database/postgres/pool.ts'
    ];

    for (const relPath of runtimeFiles) {
      const source = readFileSync(resolve(backendRoot, relPath), 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*schema-sql/);
      expect(source).not.toMatch(/from\s+['"][^'"]*auto-migrate/);
      expect(source).not.toMatch(/applyTestSchemaBootstrap/);
      expect(source).not.toMatch(/CREATE\s+TABLE/i);
      expect(source).not.toMatch(/ALTER\s+TABLE/i);
      expect(source).not.toMatch(/DROP\s+TABLE/i);
    }
  });

  it('strictly blocks applyTestSchemaBootstrap in production and development environments', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };

    await expect(applyTestSchemaBootstrap(pool as never, 'production')).rejects.toThrow(
      /Refusing to execute raw schema DDL bootstrap/
    );
    await expect(applyTestSchemaBootstrap(pool as never, 'development')).rejects.toThrow(
      /Refusing to execute raw schema DDL bootstrap/
    );
    await expect(applyTestSchemaBootstrap(pool as never, '')).rejects.toThrow(
      /Refusing to execute raw schema DDL bootstrap/
    );
    expect(pool.query).not.toHaveBeenCalled();

    await applyTestSchemaBootstrap(pool as never, 'test');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('reconciles table definitions across authoritative migrations, schema-sql.ts, and schema.sql with zero drift', () => {
    const migrationsDir = resolve(backendRoot, 'src/infrastructure/database/postgres/migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.cjs'))
      .sort();

    const migrationSql = migrationFiles
      .map((f) => readFileSync(resolve(migrationsDir, f), 'utf8'))
      .join('\n');

    const rootSchemaSql = readFileSync(resolve(repoRoot, 'schema.sql'), 'utf8');

    const migrationTables = extractCreatedTables(migrationSql);
    const schemaTsTables = extractCreatedTables(SCHEMA_SQL);
    const rootSchemaTables = extractCreatedTables(rootSchemaSql);

    expect(migrationTables.length).toBeGreaterThanOrEqual(23);
    expect(schemaTsTables).toEqual(migrationTables);
    expect(rootSchemaTables).toEqual(migrationTables);
  });

  it('confirms GET /health/migrate remains removed (404)', async () => {
    const app = createApp();
    const res = await request(app).get('/health/migrate');
    expect(res.status).toBe(404);
  });
});
