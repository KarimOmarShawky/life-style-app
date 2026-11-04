import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { getPgPool, closePgPool } from '../../src/infrastructure/database/postgres/pool.js';
import { GoalsService } from '../../src/features/goals/goals.service.js';

describe('PostgreSQL DATE boundary', () => {
  it('registers a date-only string parser at pool boot', async () => {
    getPgPool();
    expect(pg.types.getTypeParser(1082)('2026-02-03')).toBe('2026-02-03');
    await closePgPool();
  });

  it('rejects an earlier partial target date even for a legacy Date row', async () => {
    const repository = {
      findGoalById: vi.fn().mockResolvedValue({ startDate: new Date(2026, 9, 10), targetDate: null }),
      updateGoal: vi.fn()
    };
    const service = new GoalsService(repository as never);
    await expect(service.updateGoal('u', 'g', { targetDate: '2026-10-09' })).rejects.toMatchObject({
      httpStatus: 400,
      details: [expect.objectContaining({ field: 'targetDate' })]
    });
    expect(repository.updateGoal).not.toHaveBeenCalled();
  });
});
