/**
 * tests/unit/search-scope.test.ts
 *
 * F-07: global search must cover the domains it claims. Goals and
 * subscriptions were missing; financial transactions stay excluded on purpose
 * because Money has no transaction-history surface anywhere in the product.
 */

import { describe, it, expect, vi } from 'vitest';
import { SearchService } from '../../src/features/search/search.service.js';
import type { TaskReader, TaskReaderItem } from '../../src/features/tasks/tasks.reader.js';
import type { HabitReader, HabitReaderItem } from '../../src/features/habits/habits.reader.js';
import type {
  CalendarReader,
  EventReaderItem
} from '../../src/features/calendar/calendar.reader.js';
import type { NotesReader, NoteSearchItem } from '../../src/features/notes/notes.reader.js';
import type {
  ProjectsReader,
  ProjectSearchItem
} from '../../src/features/projects/projects.reader.js';
import type { GoalsReader, GoalSearchItem } from '../../src/features/goals/goals.reader.js';
import {
  PgMoneyReader,
  type MoneyReader,
  type SubscriptionSearchItem
} from '../../src/features/money/money.reader.js';

function readers() {
  const task: TaskReaderItem = {
    id: 'task-1',
    title: 'gym',
    description: null,
    status: 'todo',
    priority: 2,
    dueDate: null,
    dueTime: null,
    plannedDate: null,
    isFocus: false,
    estimateMinutes: null
  };
  const habit: HabitReaderItem = {
    id: 'habit-1',
    name: 'gym',
    color: null,
    reminderTime: null,
    status: 'active',
    completedOn: false,
    dueOn: true
  };
  const event: EventReaderItem = {
    id: 'event-1',
    title: 'gym class',
    startAt: '2026-10-24T10:00:00.000Z',
    endAt: '2026-10-24T11:00:00.000Z',
    allDay: false,
    location: null
  };
  const note: NoteSearchItem = { id: 'note-1', title: 'gym', excerpt: null, isPinned: false };
  const project: ProjectSearchItem = {
    id: 'project-1',
    name: 'gym',
    description: null,
    color: null
  };
  const goal: GoalSearchItem = { id: 'goal-1', title: 'gym three times a week', status: 'active' };
  const subscription: SubscriptionSearchItem = {
    id: 'sub-1',
    name: 'Gym membership',
    status: 'active',
    nextBillingDate: '2026-11-01'
  };

  return {
    tasks: { search: vi.fn(async () => [task]) },
    habits: { search: vi.fn(async () => [habit]) },
    calendar: { search: vi.fn(async () => [event]) },
    notes: { search: vi.fn(async () => [note]) },
    projects: { search: vi.fn(async () => [project]) },
    goals: { search: vi.fn(async () => [goal]) },
    money: { searchSubscriptions: vi.fn(async () => [subscription]) }
  };
}

describe('Global search domain coverage (F-07)', () => {
  it('searches every documented domain and returns them all', async () => {
    const fakes = readers();
    const service = new SearchService(
      fakes.tasks as unknown as TaskReader,
      fakes.habits as unknown as HabitReader,
      fakes.calendar as unknown as CalendarReader,
      fakes.notes as unknown as NotesReader,
      fakes.projects as unknown as ProjectsReader,
      fakes.goals as unknown as GoalsReader,
      fakes.money as unknown as MoneyReader
    );

    const result = await service.search('user-1', { q: 'gym', limit: 10 });

    expect(result.query).toBe('gym');
    expect(result.tasks).toHaveLength(1);
    expect(result.habits).toHaveLength(1);
    expect(result.notes).toHaveLength(1);
    expect(result.projects).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    // Previously missing domains.
    expect(result.goals).toEqual([
      { id: 'goal-1', title: 'gym three times a week', status: 'active' }
    ]);
    expect(result.subscriptions).toEqual([
      { id: 'sub-1', name: 'Gym membership', status: 'active', nextBillingDate: '2026-11-01' }
    ]);
  });

  it('passes the caller-scoped query and limit to every reader', async () => {
    const fakes = readers();
    const service = new SearchService(
      fakes.tasks as unknown as TaskReader,
      fakes.habits as unknown as HabitReader,
      fakes.calendar as unknown as CalendarReader,
      fakes.notes as unknown as NotesReader,
      fakes.projects as unknown as ProjectsReader,
      fakes.goals as unknown as GoalsReader,
      fakes.money as unknown as MoneyReader
    );

    await service.search('user-42', { q: 'rent', limit: 3 });

    for (const reader of [
      fakes.tasks.search,
      fakes.habits.search,
      fakes.calendar.search,
      fakes.notes.search,
      fakes.projects.search,
      fakes.goals.search
    ]) {
      expect(reader).toHaveBeenCalledWith('user-42', 'rent', 3);
    }
    expect(fakes.money.searchSubscriptions).toHaveBeenCalledWith('user-42', 'rent', 3);
  });

  it('never exposes a transactions search surface on the money reader', () => {
    // Money deliberately has no transaction-history list; search must not add
    // one. Guards against a future reader method re-introducing the gap.
    const methods = Object.getOwnPropertyNames(MoneyReaderProbe.prototype);
    expect(methods.filter((m) => /transaction/i.test(m))).toEqual([]);
  });
});

// Compile-time probe: the MoneyReader interface is type-only, so assert
// against the implementation's public surface instead.
const MoneyReaderProbe = PgMoneyReader;
