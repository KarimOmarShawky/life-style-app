import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors/app-error.js';
import { PgMoneyRepository } from '../../src/features/money/money.repository.pg.js';
import {
  PgTimerSessionsRepository
} from '../../src/features/timer-sessions/timer-sessions.repository.pg.js';

function queryBuilder() {
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const method of ['selectAll', 'where', 'orderBy', 'limit']) {
    builder[method] = () => builder;
  }
  builder.execute = async () => [];
  return {
    selectFrom: () => builder
  };
}

const uuid = 'd9b73678-75f1-432a-bc91-231362095cb7';
const encodeMoneyCursor = (value: string) =>
  Buffer.from(value, 'utf8').toString('base64url');

describe('money and timer pagination cursor validation', () => {
  it('rejects malformed and semantically impossible transaction cursors', async () => {
    const repository = new PgMoneyRepository(queryBuilder() as never);
    await expect(
      repository.listTransactions('user-1', { cursor: '!!!' })
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      repository.listTransactions('user-1', { cursor: '' })
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      repository.listTransactions('user-1', {
        cursor: encodeMoneyCursor(`2026-02-30|${uuid}`)
      })
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      repository.listTransactions('user-1', {
        sort: 'amount',
        cursor: encodeMoneyCursor(`not-a-number|${uuid}`)
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects malformed and impossible-date subscription cursors', async () => {
    const repository = new PgMoneyRepository(queryBuilder() as never);
    await expect(
      repository.listSubscriptions('user-1', { cursor: 'not-base64!' })
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      repository.listSubscriptions('user-1', {
        cursor: encodeMoneyCursor(`2026-02-30|${uuid}`)
      })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects malformed timer cursors before querying the database', async () => {
    const repository = new PgTimerSessionsRepository(queryBuilder() as never);
    await expect(
      repository.list('user-1', { cursor: 'not-base64!' })
    ).rejects.toBeInstanceOf(AppError);
    const badPayload = Buffer.from(
      JSON.stringify({ id: 'not-a-uuid', startedAt: '2026-01-01T00:00:00.000Z' }),
      'utf8'
    ).toString('base64');
    await expect(
      repository.list('user-1', { cursor: badPayload })
    ).rejects.toBeInstanceOf(AppError);
  });
});
