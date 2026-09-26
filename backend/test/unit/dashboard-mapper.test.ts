/**
 * The home summary mapper.
 *
 * It only nests and renames, which is exactly why it is worth a test: a
 * transposition — `overdue` reading the due-today count, or the event list
 * paired with the reminder count — type-checks, runs, and reports a plausible
 * wrong number forever. Every field here is given a distinct value so a swap
 * cannot pass.
 */
import { describe, expect, it } from 'vitest';

import { toDashboardResponse } from '@/features/dashboard/dashboard.mapper';
import type { DashboardRow } from '@/features/dashboard/dashboard.repository';

const row: DashboardRow = {
  overdue: 1,
  due_today: 2,
  completed_today: 3,
  open_tasks: [
    {
      id: 't1',
      title: 'Overdue thing',
      priority: 'high',
      status: 'todo',
      dueDate: '2026-09-23T09:00:00.000Z',
      isOverdue: true,
    },
  ],
  habits_tracked: 4,
  habits_completed: 5,
  pending_habits: [{ id: 'h1', title: 'Stretch', frequency: 'daily' }],
  events_today: 6,
  event_items: [
    {
      id: 'e1',
      title: 'Standup',
      startTime: '2026-09-24T09:00:00.000Z',
      endTime: '2026-09-24T09:15:00.000Z',
      allDay: false,
    },
  ],
  reminders_due: 7,
  reminder_items: [
    {
      id: 'r1',
      entityType: 'task',
      entityId: 't1',
      entityTitle: 'Overdue thing',
      remindAt: '2026-09-24T08:00:00.000Z',
    },
  ],
  spending: [{ currency: 'EGP', today: '15.00', month: '420.00' }],
  budgets_over_limit: 8,
  goals_active: 9,
  goals_due_soon: 10,
};

describe('toDashboardResponse', () => {
  it('puts every count under the section it belongs to', () => {
    const response = toDashboardResponse('2026-09-24', row);

    expect(response.tasks.overdue).toBe(1);
    expect(response.tasks.dueToday).toBe(2);
    expect(response.tasks.completedToday).toBe(3);
    expect(response.habits.tracked).toBe(4);
    expect(response.habits.completed).toBe(5);
    expect(response.events.today).toBe(6);
    expect(response.reminders.due).toBe(7);
    expect(response.money.budgetsOverLimit).toBe(8);
    expect(response.goals.active).toBe(9);
    expect(response.goals.dueSoon).toBe(10);
  });

  it('pairs each list with its own section', () => {
    const response = toDashboardResponse('2026-09-24', row);

    expect(response.tasks.items[0]?.id).toBe('t1');
    expect(response.habits.items[0]?.id).toBe('h1');
    expect(response.events.items[0]?.id).toBe('e1');
    expect(response.reminders.items[0]?.id).toBe('r1');
    expect(response.money.spending[0]?.currency).toBe('EGP');
  });

  it('reports the day it was asked for', () => {
    expect(toDashboardResponse('2026-09-24', row).date).toBe('2026-09-24');
  });

  it('publishes exactly the sections the API documents', () => {
    expect(Object.keys(toDashboardResponse('2026-09-24', row)).sort()).toEqual([
      'date',
      'events',
      'goals',
      'habits',
      'money',
      'reminders',
      'tasks',
    ]);
  });

  it('carries empty lists through as empty, not as undefined', () => {
    const bare = toDashboardResponse('2026-09-24', {
      ...row,
      open_tasks: [],
      pending_habits: [],
      event_items: [],
      reminder_items: [],
      spending: [],
    });

    expect(bare.tasks.items).toEqual([]);
    expect(bare.habits.items).toEqual([]);
    expect(bare.events.items).toEqual([]);
    expect(bare.reminders.items).toEqual([]);
    expect(bare.money.spending).toEqual([]);
  });

  it('keeps money as strings', () => {
    const response = toDashboardResponse('2026-09-24', row);
    expect(typeof response.money.spending[0]?.today).toBe('string');
    expect(response.money.spending[0]?.month).toBe('420.00');
  });
});
