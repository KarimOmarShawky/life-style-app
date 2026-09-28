/**
 * src/infrastructure/database/postgres/transaction-runner.ts
 *
 * Implements Section 4.5: Unit of Work and TransactionRunner with after-commit hooks.
 * Guarantees that side effects (job enqueues, push notifications) are executed
 * strictly after the database transaction commits successfully.
 */

import type { Kysely, Transaction } from 'kysely';
import type { DatabaseSchema } from './kysely.js';
import { logger } from '../../../core/logger/logger.js';

export type CommitHook = () => Promise<void> | void;

export interface TransactionContext<DB = DatabaseSchema> {
  readonly tx: Transaction<DB>;
  afterCommit(hook: CommitHook): void;
}

export interface TransactionRunner<DB = DatabaseSchema> {
  run<T>(fn: (ctx: TransactionContext<DB>) => Promise<T>): Promise<T>;
}

export class PgTransactionRunner<DB = DatabaseSchema> implements TransactionRunner<DB> {
  constructor(private readonly db: Kysely<DB>) {}

  public async run<T>(fn: (ctx: TransactionContext<DB>) => Promise<T>): Promise<T> {
    const afterCommitHooks: CommitHook[] = [];

    const result = await this.db.transaction().execute(async (trx) => {
      const ctx: TransactionContext<DB> = {
        tx: trx,
        afterCommit(hook: CommitHook): void {
          afterCommitHooks.push(hook);
        }
      };

      return fn(ctx);
    });

    // Transaction committed successfully. Execute after-commit hooks.
    for (const hook of afterCommitHooks) {
      try {
        await hook();
      } catch (err) {
        // After-commit failures are logged; transaction is already committed.
        logger.error('Error executing after-commit side-effect hook', err);
      }
    }

    return result;
  }
}
