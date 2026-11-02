/**
 * tests/unit/projects-recurring-dto.test.ts
 *
 * AUD-18: unit coverage for projects and recurring-tasks DTO serialization.
 * These DTOs carry DATE-column fields that were affected by AUD-06
 * (timezone-dependent date formatting). The tests verify that formatDateOnly
 * produces local calendar days, not UTC truncation.
 */

import { describe, it, expect } from 'vitest';
import { toProjectDto } from '../../src/features/projects/projects.dto.js';
import {
  toRecurringTaskDto,
  toRecurrenceDto
} from '../../src/features/recurring-tasks/recurring-tasks.dto.js';
import { formatDateOnly } from '../../src/core/time/date-utils.js';
import type { ProjectRow, ProjectTaskCounts } from '../../src/features/projects/projects.types.js';
import type {
  RecurringTaskRow,
  RecurrenceRow
} from '../../src/features/recurring-tasks/recurring-tasks.types.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RECURRING_ID = '22222222-2222-4222-8222-222222222222';
const RECURRENCE_ID = '33333333-3333-4333-8333-333333333333';

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJECT_ID,
    user_id: '44444444-4444-4444-8444-444444444444',
    name: 'Workout Plan',
    description: 'Strength training',
    status: 'active',
    color: '#4CAF50',
    goal_id: null,
    due_date: '2026-11-15',
    created_at: new Date('2026-10-01T10:00:00Z'),
    updated_at: new Date('2026-10-15T12:00:00Z'),
    deleted_at: null,
    version: 1,
    ...overrides
  };
}

function recurrenceRow(overrides: Partial<RecurrenceRow> = {}): RecurrenceRow {
  return {
    id: RECURRENCE_ID,
    user_id: '44444444-4444-4444-8444-444444444444',
    freq: 'weekly',
    interval: 1,
    by_weekday: ['mon', 'wed', 'fri'],
    by_month_day: null,
    by_month: null,
    start_date: '2026-11-01',
    end_date: null,
    occurrence_limit: null,
    ...overrides
  };
}

function recurringTaskRow(overrides: Partial<RecurringTaskRow> = {}): RecurringTaskRow {
  return {
    id: RECURRING_ID,
    user_id: '44444444-4444-4444-8444-444444444444',
    title: 'Gym session',
    description: null,
    project_id: null,
    priority: 3,
    estimate_minutes: 60,
    due_time: '07:00',
    reminder_offset_minutes: 15,
    status: 'active',
    generated_through: null,
    recurrence_id: RECURRENCE_ID,
    created_at: new Date('2026-10-01T10:00:00Z'),
    updated_at: new Date('2026-10-15T12:00:00Z'),
    deleted_at: null,
    version: 1,
    ...overrides
  };
}

describe('Projects DTO serialization (AUD-18)', () => {
  it('serializes a project row to DTO with correct field mapping', () => {
    const dto = toProjectDto(projectRow());
    expect(dto.id).toBe(PROJECT_ID);
    expect(dto.name).toBe('Workout Plan');
    expect(dto.status).toBe('active');
    expect(dto.dueDate).toBe('2026-11-15');
    expect(dto.taskCounts).toEqual({ open: 0, done: 0 });
  });

  it('formats dueDate with local calendar day (AUD-06)', () => {
    // A Date that is 2026-11-15 in local time but may differ in UTC.
    const localDate = new Date(2026, 10, 15, 12, 0, 0);
    const dto = toProjectDto(projectRow({ due_date: localDate }));
    expect(dto.dueDate).toBe(formatDateOnly(localDate));
  });

  it('passes through task counts when provided', () => {
    const counts: ProjectTaskCounts = { open: 5, done: 3 };
    const dto = toProjectDto(projectRow(), counts);
    expect(dto.taskCounts).toEqual({ open: 5, done: 3 });
  });

  it('returns null dueDate when the row has no due date', () => {
    const dto = toProjectDto(projectRow({ due_date: null }));
    expect(dto.dueDate).toBeNull();
  });
});

describe('Recurring tasks DTO serialization (AUD-18)', () => {
  it('serializes a recurrence row to DTO', () => {
    const dto = toRecurrenceDto(recurrenceRow());
    expect(dto.id).toBe(RECURRENCE_ID);
    expect(dto.freq).toBe('weekly');
    expect(dto.interval).toBe(1);
    expect(dto.byWeekday).toEqual(['mon', 'wed', 'fri']);
    expect(dto.startDate).toBe('2026-11-01');
    expect(dto.endDate).toBeNull();
  });

  it('serializes a recurring task row joined with its recurrence', () => {
    const dto = toRecurringTaskDto(recurringTaskRow(), recurrenceRow());
    expect(dto.id).toBe(RECURRING_ID);
    expect(dto.title).toBe('Gym session');
    expect(dto.priority).toBe('high');
    expect(dto.dueTime).toBe('07:00');
    expect(dto.recurrence.freq).toBe('weekly');
  });

  it('formats recurrence startDate with local calendar day (AUD-06)', () => {
    const localDate = new Date(2026, 10, 1, 12, 0, 0);
    const dto = toRecurrenceDto(recurrenceRow({ start_date: localDate }));
    expect(dto.startDate).toBe(formatDateOnly(localDate));
  });
});
