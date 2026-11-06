import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { assertFinancialRetirement } from '../../src/infrastructure/database/postgres/financial-retirement-guard.js';

describe('financial retirement startup guard', () => {
  it('does not connect in unguarded development mode', async () => {
    const query = vi.fn();
    await assertFinancialRetirement({ query } as unknown as pg.Pool, false);
    expect(query).not.toHaveBeenCalled();
  });

  it('requires both the marker and safe effective privileges', async () => {
    const query = vi.fn();
    const pool = { query } as unknown as pg.Pool;
    for (const row of [
      { completed: false, protected: true },
      { completed: true, protected: false },
      { completed: false, protected: false }
    ]) {
      query.mockResolvedValueOnce({ rows: [row] });
      await expect(assertFinancialRetirement(pool, true)).rejects.toThrow(/startup blocked/);
    }
    query.mockResolvedValueOnce({ rows: [{ completed: true, protected: true }] });
    await expect(assertFinancialRetirement(pool, true)).resolves.toBeUndefined();
  });

  it('fails closed without exposing connection errors or private data', async () => {
    const query = vi.fn().mockRejectedValue(new Error('private database details'));
    await expect(assertFinancialRetirement({ query } as unknown as pg.Pool, true)).rejects.toThrow(
      'Financial retirement verification failed; service startup blocked'
    );
  });
});
