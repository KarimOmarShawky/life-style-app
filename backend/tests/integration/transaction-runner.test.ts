/**
 * tests/integration/transaction-runner.test.ts
 *
 * Verifies Section 4.5: TransactionRunner and afterCommit hook guarantees.
 */

import { describe, it, expect, vi } from 'vitest';
import { PgTransactionRunner } from '../../src/infrastructure/database/postgres/transaction-runner.js';
import type { Kysely, Transaction } from 'kysely';

describe('TransactionRunner and afterCommit Hooks (Spec §4.5)', () => {
  it('executes afterCommit hooks strictly after transaction commits successfully', async () => {
    const mockTrx = {} as Transaction<Record<string, unknown>>;
    const mockDb = {
      transaction: () => ({
        execute: async (
          callback: (trx: Transaction<Record<string, unknown>>) => Promise<unknown>
        ) => {
          return callback(mockTrx);
        }
      })
    } as unknown as Kysely<Record<string, unknown>>;

    const runner = new PgTransactionRunner(mockDb);

    const hook1 = vi.fn();
    const hook2 = vi.fn();

    const result = await runner.run(async (ctx) => {
      ctx.afterCommit(hook1);
      ctx.afterCommit(hook2);
      expect(hook1).not.toHaveBeenCalled();
      expect(hook2).not.toHaveBeenCalled();
      return 'transaction-success-result';
    });

    expect(result).toBe('transaction-success-result');
    expect(hook1).toHaveBeenCalledTimes(1);
    expect(hook2).toHaveBeenCalledTimes(1);
  });

  it('discards afterCommit hooks and does NOT execute them when transaction rolls back', async () => {
    const mockDb = {
      transaction: () => ({
        execute: async () => {
          throw new Error('Database transaction constraint violation');
        }
      })
    } as unknown as Kysely<Record<string, unknown>>;

    const runner = new PgTransactionRunner(mockDb);
    const hook = vi.fn();

    await expect(
      runner.run(async (ctx) => {
        ctx.afterCommit(hook);
        throw new Error('Fail transaction');
      })
    ).rejects.toThrow();

    expect(hook).not.toHaveBeenCalled();
  });
});
