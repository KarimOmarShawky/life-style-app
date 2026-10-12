/**
 * tests/unit/account-deletion.test.ts
 *
 * Verifies Fix #2 (B-07): Account deletion scheduling, session/token revocation,
 * FK-safe related data cleanup, ownership scoping, idempotency on repeated
 * requests, and transaction rollback on failure.
 */

import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import type { Request, Response } from 'express';
import {
  PgUsersRepository,
  USER_OWNED_TABLES_IN_DELETE_ORDER
} from '../../src/features/users/users.repository.pg.js';
import { UsersService } from '../../src/features/users/users.service.js';
import { UsersController } from '../../src/features/users/users.controller.js';
import type { AuditLogger } from '../../src/infrastructure/database/postgres/audit-logger.js';

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createTransactionalPoolMock(options?: {
  userRow?: {
    id: string;
    status: 'active' | 'disabled' | 'pending_deletion';
    deletion_scheduled_for: Date | null;
  } | null;
  failOnPattern?: RegExp;
}): {
  pool: pg.Pool;
  queries: RecordedQuery[];
  released: () => boolean;
} {
  const queries: RecordedQuery[] = [];
  let isReleased = false;
  const userRow =
    options && 'userRow' in options
      ? options.userRow
      : {
          id: '11111111-1111-4111-8111-111111111111',
          status: 'active' as const,
          deletion_scheduled_for: null
        };

  const client = {
    query: vi.fn(async (sqlText: string, params: unknown[] = []) => {
      const normalized = sqlText.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, params });

      if (options?.failOnPattern && options.failOnPattern.test(normalized)) {
        throw new Error('SIMULATED_DB_FAILURE');
      }

      if (normalized.startsWith('SELECT') && normalized.includes('FROM users')) {
        return {
          rows: userRow ? [userRow] : [],
          rowCount: userRow ? 1 : 0
        };
      }

      return { rows: [], rowCount: 1 };
    }),
    release: vi.fn(() => {
      isReleased = true;
    })
  };

  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sqlText: string, params: unknown[] = []) => {
      const normalized = sqlText.replace(/\s+/g, ' ').trim();
      queries.push({ sql: normalized, params });
      if (normalized.includes('FROM users') && normalized.includes('deletion_scheduled_for <=')) {
        return {
          rows: userRow ? [{ id: userRow.id }] : [],
          rowCount: userRow ? 1 : 0
        };
      }
      return { rows: [], rowCount: 0 };
    })
  } as unknown as pg.Pool;

  return { pool, queries, released: () => isReleased };
}

function createNoopAuditLogger(): { logger: AuditLogger; events: unknown[] } {
  const events: unknown[] = [];
  const logger: AuditLogger = {
    log: vi.fn(async (entry) => {
      events.push(entry);
    })
  };
  return { logger, events };
}

describe('Account Deletion & Data Lifecycle (B-07)', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const sessionA1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('schedules deletion transactionally, revoking ingest tokens, push devices, reminders, and other sessions', async () => {
    const { pool, queries, released } = createTransactionalPoolMock();
    const { logger, events } = createNoopAuditLogger();
    const repo = new PgUsersRepository(pool);
    const service = new UsersService(repo, logger);

    const res = await service.scheduleDeletion(userA, { ip: '127.0.0.1' }, sessionA1);

    expect(res.status).toBe('pending_deletion');
    expect(new Date(res.deletionScheduledFor).getTime()).toBeGreaterThan(Date.now());
    expect(released()).toBe(true);
    expect(queries[0]?.sql).toBe('BEGIN');
    expect(queries.at(-1)?.sql).toBe('COMMIT');

    // Ingest tokens, push devices, reminders, and other sessions are cleaned up for userA only
    expect(
      queries.some(
        (q) => q.sql.includes('UPDATE ingest_tokens SET revoked_at') && q.params[0] === userA
      )
    ).toBe(true);
    expect(
      queries.some((q) => q.sql.includes('DELETE FROM push_devices') && q.params[0] === userA)
    ).toBe(true);
    expect(
      queries.some(
        (q) =>
          q.sql.includes('UPDATE auth_sessions') &&
          q.params[0] === userA &&
          q.params[1] === sessionA1
      )
    ).toBe(true);
    expect(
      queries.some(
        (q) =>
          q.sql.includes('UPDATE refresh_tokens') &&
          q.params[0] === userA &&
          q.params[1] === sessionA1
      )
    ).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('is idempotent on repeated deletion requests and preserves original deletionScheduledFor', async () => {
    const originalDate = new Date('2026-10-20T00:00:00.000Z');
    const { pool, queries } = createTransactionalPoolMock({
      userRow: {
        id: userA,
        status: 'pending_deletion',
        deletion_scheduled_for: originalDate
      }
    });
    const { logger } = createNoopAuditLogger();
    const service = new UsersService(new PgUsersRepository(pool), logger);

    const first = await service.scheduleDeletion(userA, undefined, sessionA1);
    const second = await service.scheduleDeletion(userA, undefined, sessionA1);

    expect(first.deletionScheduledFor).toBe(originalDate.toISOString());
    expect(second.deletionScheduledFor).toBe(originalDate.toISOString());
    // Must not overwrite deletion_scheduled_for when already pending_deletion
    expect(queries.some((q) => q.sql.startsWith('UPDATE users SET status'))).toBe(false);
  });

  it('rejects unauthenticated deletion requests at controller boundary (authorization/ownership)', async () => {
    const { pool } = createTransactionalPoolMock();
    const { logger } = createNoopAuditLogger();
    const controller = new UsersController(new UsersService(new PgUsersRepository(pool), logger));

    const req = { headers: {}, socket: {} } as unknown as Request;
    const res = {} as unknown as Response;
    const next = vi.fn();

    await controller.scheduleDeletion(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0]?.[0] as { code?: string; httpStatus?: number };
    expect(err.code).toBe('UNAUTHENTICATED');
    expect(err.httpStatus).toBe(401);
  });

  it('purges expired pending_deletion account and all related data in FK-safe order scoped strictly to target user', async () => {
    const pastSchedule = new Date(Date.now() - 60_000);
    const { pool, queries, released } = createTransactionalPoolMock({
      userRow: {
        id: userA,
        status: 'pending_deletion',
        deletion_scheduled_for: pastSchedule
      }
    });
    const { logger, events } = createNoopAuditLogger();
    const repo = new PgUsersRepository(pool);
    const service = new UsersService(repo, logger);

    const purged = await service.purgeAccount(userA, {
      requirePendingDeletion: true,
      cutoff: new Date()
    });

    expect(purged).toBe(true);
    expect(released()).toBe(true);
    expect(queries[0]?.sql).toBe('BEGIN');
    expect(queries.at(-1)?.sql).toBe('COMMIT');

    // Every single DELETE/UPDATE statement in the transaction must be parameterized with userA
    const dmlQueries = queries.filter(
      (q) => q.sql.startsWith('DELETE ') || q.sql.startsWith('UPDATE ')
    );
    expect(dmlQueries.length).toBeGreaterThan(20);
    for (const q of dmlQueries) {
      expect(q.params).toEqual([userA]);
    }

    // Verify FK-safe order: transactions, subscriptions, and budgets are deleted BEFORE categories,
    // and categories is deleted BEFORE users.
    const indexOfDelete = (table: string) =>
      queries.findIndex((q) => q.sql === `DELETE FROM ${table} WHERE user_id = $1`);

    const txIdx = indexOfDelete('transactions');
    const subIdx = indexOfDelete('subscriptions');
    const budIdx = indexOfDelete('budgets');
    const catIdx = indexOfDelete('categories');
    const userDeleteIdx = queries.findIndex((q) => q.sql === 'DELETE FROM users WHERE id = $1');

    expect(txIdx).toBeGreaterThan(0);
    expect(subIdx).toBeGreaterThan(txIdx);
    expect(budIdx).toBeGreaterThan(subIdx);
    expect(catIdx).toBeGreaterThan(budIdx);
    expect(userDeleteIdx).toBeGreaterThan(catIdx);

    // Verify all user-owned tables are covered
    for (const table of USER_OWNED_TABLES_IN_DELETE_ORDER) {
      expect(indexOfDelete(table)).toBeGreaterThan(0);
    }

    expect(events).toHaveLength(1);
  });

  it('is idempotent when purging a non-existent or active account', async () => {
    const missingMock = createTransactionalPoolMock({ userRow: null });
    const repoMissing = new PgUsersRepository(missingMock.pool);
    expect(await repoMissing.purgeAccount(userA)).toBe(false);

    const activeMock = createTransactionalPoolMock({
      userRow: { id: userA, status: 'active', deletion_scheduled_for: null }
    });
    const repoActive = new PgUsersRepository(activeMock.pool);
    expect(await repoActive.purgeAccount(userA, { requirePendingDeletion: true })).toBe(false);
    expect(activeMock.queries.some((q) => q.sql.startsWith('DELETE FROM'))).toBe(false);
  });

  it('rolls back the transaction if any deletion step fails mid-flight', async () => {
    const pastSchedule = new Date(Date.now() - 60_000);
    const { pool, queries, released } = createTransactionalPoolMock({
      userRow: {
        id: userA,
        status: 'pending_deletion',
        deletion_scheduled_for: pastSchedule
      },
      failOnPattern: /DELETE FROM categories/
    });
    const repo = new PgUsersRepository(pool);

    await expect(
      repo.purgeAccount(userA, { requirePendingDeletion: true, cutoff: new Date() })
    ).rejects.toThrow('SIMULATED_DB_FAILURE');

    expect(released()).toBe(true);
    expect(queries[0]?.sql).toBe('BEGIN');
    expect(queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(queries.some((q) => q.sql === 'COMMIT')).toBe(false);
    expect(queries.some((q) => q.sql === 'DELETE FROM users WHERE id = $1')).toBe(false);
  });
});
