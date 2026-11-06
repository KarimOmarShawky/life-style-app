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

  it('reconciles table definitions across authoritative migrations, schema-sql.ts, and schema.sql have matching table inventories (not full schema equivalence)', () => {
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

  it('keeps the wallet session constraints, irreversible revocation and narrow grants in snapshots', () => {
    const root = readFileSync(resolve(repoRoot, 'schema.sql'), 'utf8');
    for (const snapshot of [root, SCHEMA_SQL]) {
      const table = snapshot.match(
        /CREATE TABLE wallet_account_sessions \(([\s\S]*?)\n\s*\);/i
      )?.[1];
      expect(table).toBeDefined();
      expect(table).toMatch(/wallet_account_id UUID NOT NULL REFERENCES wallet_accounts\(id\)/i);
      expect(table).toMatch(
        /token_hash BYTEA NOT NULL UNIQUE CHECK \(octet_length\(token_hash\) = 32\)/i
      );
      expect(table).toMatch(/CHECK \(expires_at > created_at\)/i);
      expect(snapshot).toMatch(/CREATE TRIGGER wallet_session_revocation_final/i);
      expect(snapshot).toMatch(
        /OLD\.revoked_at IS NOT NULL AND NEW\.revoked_at IS DISTINCT FROM OLD\.revoked_at/i
      );
      expect(snapshot).toMatch(
        /GRANT UPDATE \(revoked_at\) ON wallet_account_sessions TO lifestyle_app/i
      );
      expect(snapshot).not.toMatch(/GRANT\s+[^;]*DELETE[^;]*\bwallet_account_sessions\b/i);
    }
  });

  it('keeps reset ownership and fencing columns, foreign key, and indexes in both snapshots', () => {
    const root = readFileSync(resolve(repoRoot, 'schema.sql'), 'utf8');
    for (const snapshot of [root, SCHEMA_SQL]) {
      const table = snapshot.match(
        /CREATE TABLE password_reset_requests \(([\s\S]*?)\n\s*\);/i
      )?.[1];
      expect(table).toBeDefined();
      expect(table).toMatch(/\blease_token\s+UUID\b/i);
      expect(table).toMatch(/\buser_id\s+UUID\b/i);
      expect(table).toMatch(
        /CONSTRAINT\s+password_reset_requests_user_fk\s+FOREIGN KEY\s*\(user_id\)\s+REFERENCES\s+users\s*\(id\)\s+ON DELETE CASCADE/i
      );
      expect(snapshot).toMatch(
        /CREATE INDEX(?: IF NOT EXISTS)? idx_password_reset_user\s+ON password_reset_requests\s*\(user_id\)/i
      );
      expect(snapshot).toMatch(
        /CREATE INDEX(?: IF NOT EXISTS)? idx_password_reset_abandoned\s+ON password_reset_requests\s*\(updated_at\)/i
      );
    }
  });

  it('preserves the optional original monetary scale and its integrity constraint in both snapshots', () => {
    const root = readFileSync(resolve(repoRoot, 'schema.sql'), 'utf8');
    for (const snapshot of [root, SCHEMA_SQL]) {
      for (const [tableName, column] of [
        ['transactions', 'amount'],
        ['subscriptions', 'amount'],
        ['budgets', 'amount_limit']
      ]) {
        const table = snapshot.match(
          new RegExp(`CREATE TABLE ${tableName} \\(([\\s\\S]*?)\\n\\s*\\);`, 'i')
        )?.[1];
        expect(table).toBeDefined();
        expect(table).toMatch(/\bamount_scale\s+SMALLINT\b/i);
        expect(table).toMatch(
          new RegExp(
            `amount_scale BETWEEN 0 AND 4 AND ${column} = trunc\\(${column}, amount_scale\\)`,
            'i'
          )
        );
      }
    }
  });

  it('keeps the approved optional timer task nullable in the reference schema', () => {
    const root = readFileSync(resolve(repoRoot, 'schema.sql'), 'utf8');
    const timer = root.slice(root.indexOf('CREATE TABLE timer_sessions'));
    expect(timer.split(');')[0]).not.toMatch(/task_id\s+UUID\s+NOT NULL/i);
    expect(
      readFileSync(
        resolve(
          backendRoot,
          'src/infrastructure/database/postgres/migrations/1727300004000_timer_sessions_optional_task.cjs'
        ),
        'utf8'
      )
    ).toMatch(/ALTER COLUMN task_id DROP NOT NULL/);
  });

  it('confirms GET /health/migrate remains removed (404)', async () => {
    const app = createApp();
    const res = await request(app).get('/health/migrate');
    expect(res.status).toBe(404);
  });
});
