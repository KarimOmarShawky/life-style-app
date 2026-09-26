/**
 * Goal mapper unit tests.
 *
 * Progress and overdue are both DERIVED. These tests pin the two judgement calls
 * in that derivation: what an empty checklist means, and when a deadline stops
 * mattering.
 */
import { describe, expect, it } from 'vitest';

import { progressPercent, toGoalResponse } from '@/features/goals/goal.mapper';
import type { GoalStatus, GoalWithProgress } from '@/features/goals/goal.types';

function goal(overrides: Partial<GoalWithProgress> = {}): GoalWithProgress {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000000',
    userId: 'bbbbbbbb-0000-0000-0000-000000000000',
    title: 'Graduate',
    description: null,
    targetDate: null,
    status: 'active' as GoalStatus,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    milestoneCount: 0,
    doneMilestoneCount: 0,
    ...overrides,
  };
}

describe('progressPercent', () => {
  it('is null when there is nothing to measure', () => {
    // Not 0: a goal with no checklist has undefined progress, and "0%" claims no
    // progress has been made when nothing has been measured at all.
    expect(progressPercent(0, 0)).toBeNull();
  });

  it('is 0 when a checklist exists but nothing is done', () => {
    expect(progressPercent(0, 4)).toBe(0);
  });

  it('is 100 when everything is done', () => {
    expect(progressPercent(4, 4)).toBe(100);
  });

  it('rounds rather than floors', () => {
    // Flooring would leave a fully-checked goal reading 99% on some counts, and
    // 2 of 3 reading 66% when the nearer whole number is 67.
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(2, 3)).toBe(67);
  });

  it('handles a single milestone', () => {
    expect(progressPercent(0, 1)).toBe(0);
    expect(progressPercent(1, 1)).toBe(100);
  });
});

describe('toGoalResponse', () => {
  it('never exposes userId', () => {
    expect(Object.keys(toGoalResponse(goal(), '2026-09-24'))).not.toContain('userId');
  });

  it('marks an active goal past its target date as overdue', () => {
    const response = toGoalResponse(goal({ targetDate: '2026-09-01' }), '2026-09-24');
    expect(response.isOverdue).toBe(true);
  });

  it('does not mark a goal overdue on its target date', () => {
    // The deadline is the last day, not the first day late.
    const response = toGoalResponse(goal({ targetDate: '2026-09-24' }), '2026-09-24');
    expect(response.isOverdue).toBe(false);
  });

  it('never marks a goal without a target date as overdue', () => {
    expect(toGoalResponse(goal(), '2026-09-24').isOverdue).toBe(false);
  });

  it('stops calling an achieved goal overdue', () => {
    // Finishing late is still finishing. The deadline stopped mattering when the
    // goal stopped being active.
    const response = toGoalResponse(
      goal({ targetDate: '2020-01-01', status: 'achieved' }),
      '2026-09-24',
    );
    expect(response.isOverdue).toBe(false);
  });

  it('stops calling an abandoned goal overdue', () => {
    const response = toGoalResponse(
      goal({ targetDate: '2020-01-01', status: 'abandoned' }),
      '2026-09-24',
    );
    expect(response.isOverdue).toBe(false);
  });

  it('carries the counts through with the percentage', () => {
    const response = toGoalResponse(
      goal({ milestoneCount: 4, doneMilestoneCount: 3 }),
      '2026-09-24',
    );
    expect(response.milestoneCount).toBe(4);
    expect(response.doneMilestoneCount).toBe(3);
    expect(response.progressPercent).toBe(75);
  });
});
