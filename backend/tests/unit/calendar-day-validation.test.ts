/**
 * tests/unit/calendar-day-validation.test.ts
 *
 * V-09: every feature schema rejects an impossible calendar day, not just a
 * string shaped like one. The canonical day route already did this; the money,
 * tasks, goals, habits, projects, recurring-task and calendar schemas were
 * shape-only, so `2026-02-30` reached date arithmetic and PostgreSQL.
 */

import { describe, it, expect } from 'vitest';
import {
  calendarDaySchema,
  calendarDaySchemaFor,
  isValidCalendarDate
} from '../../src/core/validation/date-only.js';
import {
  createTransactionSchema,
  dateStringSchema,
  listTransactionsQuerySchema,
  paySubscriptionSchema
} from '../../src/features/money/money.validation.js';
import { createTaskSchema, listTasksQuerySchema } from '../../src/features/tasks/tasks.validation.js';
import { createGoalSchema, createMilestoneSchema } from '../../src/features/goals/goals.validation.js';
import {
  createHabitSchema,
  getCheckinsQuerySchema
} from '../../src/features/habits/habits.validation.js';
import { createProjectSchema } from '../../src/features/projects/projects.validation.js';
import { createRecurringTaskSchema } from '../../src/features/recurring-tasks/recurring-tasks.validation.js';
import { agendaQuerySchema } from '../../src/features/calendar/calendar.validation.js';
import { dayParamSchema } from '../../src/features/days/days.validation.js';

const reject = (result: { success: boolean }) => expect(result.success).toBe(false);
const accept = (result: { success: boolean }) => expect(result.success).toBe(true);

describe('Shared semantic calendar-day validation (V-09)', () => {
  it('accepts real days, including leap days, and rejects impossible ones', () => {
    for (const value of ['2024-02-29', '2026-01-01', '2026-12-31', '2000-02-29']) {
      expect(isValidCalendarDate(value), value).toBe(true);
    }
    for (const value of [
      '2023-02-29', // not a leap year
      '2026-02-30', // February never has 30 days
      '2026-04-31', // April never has 31 days
      '2026-13-01', // month out of range
      '2026-00-10',
      '2026-01-00',
      '2026-01-32',
      '2026-1-01', // not the exact round-trip format
      ' 2026-01-01',
      '2026-01-01T00:00:00Z',
      '1900-02-29', // 1900 is not a leap year (Gregorian rule)
      '',
      'abc'
    ]) {
      expect(isValidCalendarDate(value), value).toBe(false);
    }
    expect(isValidCalendarDate(undefined)).toBe(false);
    expect(isValidCalendarDate(20260101)).toBe(false);
  });

  it('is timezone independent and reports a uniform field-scoped message', () => {
    // A day that shifts across a month boundary in negative/positive offsets.
    expect(calendarDaySchema.safeParse('2026-03-01').success).toBe(true);
    const result = calendarDaySchemaFor('occurredOn').safeParse('2026-02-30');
    reject(result);
    expect(result.error?.issues[0]?.message).toContain('occurredOn');
    expect(result.error?.issues[0]?.message).toContain('real calendar date');
  });

  it('applies to money create, update, list and payment schemas', () => {
    reject(dateStringSchema.safeParse('2026-02-30'));
    reject(
      createTransactionSchema.safeParse({
        kind: 'expense',
        amount: '10.00',
        currency: 'USD',
        occurredOn: '2026-02-30'
      })
    );
    accept(
      createTransactionSchema.safeParse({
        kind: 'expense',
        amount: '10.00',
        currency: 'USD',
        occurredOn: '2024-02-29'
      })
    );
    reject(listTransactionsQuerySchema.safeParse({ from: '2026-04-31' }));
    reject(paySubscriptionSchema.safeParse({ occurredOn: '2026-02-30' }));
  });

  it('applies to tasks, goals, habits, projects, recurring tasks and calendar', () => {
    reject(createTaskSchema.safeParse({ title: 'task', dueDate: '2026-02-30' }));
    reject(createTaskSchema.safeParse({ title: 'task', plannedDate: '2026-06-31' }));
    reject(listTasksQuerySchema.safeParse({ dueFrom: '2026-02-30' }));
    reject(listTasksQuerySchema.safeParse({ plannedDate: '2026-06-31' }));
    accept(createTaskSchema.safeParse({ title: 'task', dueDate: '2024-02-29' }));

    reject(createGoalSchema.safeParse({ title: 'goal', startDate: '2026-02-30' }));
    reject(createMilestoneSchema.safeParse({ title: 'milestone', dueDate: '2026-02-30' }));
    reject(createHabitSchema.safeParse({ name: 'habit', startDate: '2026-02-30' }));
    reject(getCheckinsQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }));
    reject(createProjectSchema.safeParse({ name: 'project', dueDate: '2026-02-30' }));
    reject(
      createRecurringTaskSchema.safeParse({ title: 'rec', startDate: '2026-02-30', freq: 'daily' })
    );
    reject(agendaQuerySchema.safeParse({ date: '2026-02-30' }));
    accept(agendaQuerySchema.safeParse({ date: '2026-02-28' }));
  });

  it('keeps the canonical day route on the same rule as every feature', () => {
    reject(dayParamSchema.safeParse({ date: '2026-02-30' }));
    accept(dayParamSchema.safeParse({ date: '2024-02-29' }));
    reject(dayParamSchema.safeParse({ date: '1899-12-31' }));
  });
});
