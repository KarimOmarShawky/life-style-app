/**
 * Habit and goal schema unit tests.
 *
 * No database needed. These cover the layer that decides what reaches the
 * database at all.
 */
import { describe, expect, it } from 'vitest';

import {
  createHabitSchema,
  habitLogsQuerySchema,
  listHabitsQuerySchema,
  logHabitSchema,
  updateHabitSchema,
} from '@/features/habits/habit.validation';
import {
  createMilestoneSchema,
  listGoalsQuerySchema,
  updateGoalSchema,
} from '@/features/goals/goal.validation';

describe('createHabitSchema', () => {
  it('accepts a title alone and leaves the frequency to the database default', () => {
    const result = createHabitSchema.parse({ title: 'Read' });
    expect(result.frequency).toBeUndefined();
  });

  it('accepts every frequency the database CHECK constraint allows', () => {
    for (const frequency of ['daily', 'weekly', 'custom']) {
      expect(createHabitSchema.safeParse({ title: 'x', frequency }).success).toBe(true);
    }
  });

  it('rejects a frequency the database would refuse', () => {
    // Catching it here turns a 500 from a constraint violation into a 422 that
    // names the field.
    expect(createHabitSchema.safeParse({ title: 'x', frequency: 'hourly' }).success).toBe(false);
  });

  it('rejects a title of only whitespace', () => {
    expect(createHabitSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('rejects an unknown field rather than ignoring it', () => {
    const result = createHabitSchema.safeParse({ title: 'x', userId: 'someone-else' });
    expect(result.success).toBe(false);
  });
});

describe('updateHabitSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateHabitSchema.safeParse({}).success).toBe(false);
  });

  it('accepts archiving alone', () => {
    expect(updateHabitSchema.safeParse({ isArchived: true }).success).toBe(true);
  });
});

describe('logHabitSchema', () => {
  it('accepts an empty body, meaning "done, today"', () => {
    const result = logHabitSchema.parse({});
    expect(result.date).toBeUndefined();
    expect(result.completed).toBeUndefined();
  });

  it('accepts an explicit date and completion', () => {
    expect(logHabitSchema.safeParse({ date: '2026-09-24', completed: false }).success).toBe(true);
  });

  it('rejects a date that is not a calendar date', () => {
    expect(logHabitSchema.safeParse({ date: '24-09-2026' }).success).toBe(false);
    expect(logHabitSchema.safeParse({ date: '2026-13-01' }).success).toBe(false);
    expect(logHabitSchema.safeParse({ date: '2026-09-24T10:00:00Z' }).success).toBe(false);
  });
});

describe('habitLogsQuerySchema', () => {
  it('accepts a range', () => {
    expect(habitLogsQuerySchema.safeParse({ from: '2026-09-01', to: '2026-09-30' }).success).toBe(
      true,
    );
  });

  it('rejects a range that runs backwards', () => {
    // Would silently return nothing, which reads as "no history" rather than
    // "you asked for an impossible window".
    expect(habitLogsQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(
      false,
    );
  });

  it('accepts an open-ended range', () => {
    expect(habitLogsQuerySchema.safeParse({ from: '2026-09-01' }).success).toBe(true);
  });
});

describe('listHabitsQuerySchema', () => {
  it('defaults archived to false', () => {
    expect(listHabitsQuerySchema.parse({}).archived).toBe(false);
  });

  it('rejects an unknown query parameter', () => {
    expect(listHabitsQuerySchema.safeParse({ colour: 'red' }).success).toBe(false);
  });
});

describe('goal schemas', () => {
  it('rejects a status outside the allowed set', () => {
    expect(listGoalsQuerySchema.safeParse({ status: 'nearly' }).success).toBe(false);
  });

  it('allows a target date to be cleared with null', () => {
    expect(updateGoalSchema.safeParse({ targetDate: null }).success).toBe(true);
  });

  it('rejects an empty goal patch', () => {
    expect(updateGoalSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a negative milestone position', () => {
    expect(createMilestoneSchema.safeParse({ title: 'x', position: -1 }).success).toBe(false);
  });

  it('rejects a milestone position used as storage', () => {
    expect(createMilestoneSchema.safeParse({ title: 'x', position: 999999 }).success).toBe(false);
  });

  it('accepts a null taskId, meaning no backing task', () => {
    expect(createMilestoneSchema.safeParse({ title: 'x', taskId: null }).success).toBe(true);
  });

  it('rejects a taskId that is not a UUID', () => {
    expect(createMilestoneSchema.safeParse({ title: 'x', taskId: 'nope' }).success).toBe(false);
  });
});
