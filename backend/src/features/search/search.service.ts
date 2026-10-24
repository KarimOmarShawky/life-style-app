/**
 * src/features/search/search.service.ts
 *
 * Implements Section 14 (P1-05): Global Search. Runs each feature's
 * read-only Reader search and merges the results — no cross-feature table
 * access (feature-architecture rule 2).
 *
 * Supported domains (F-07): tasks, notes, habits, projects, calendar events,
 * goals and subscriptions. Financial transactions are intentionally NOT
 * searched: Money exposes no transaction-history surface anywhere in the
 * product, and adding one through search would silently change that decision.
 */

import type { TaskReader } from '../tasks/tasks.reader.js';
import type { HabitReader } from '../habits/habits.reader.js';
import type { CalendarReader } from '../calendar/calendar.reader.js';
import type { NotesReader } from '../notes/notes.reader.js';
import type { ProjectsReader } from '../projects/projects.reader.js';
import type { GoalsReader } from '../goals/goals.reader.js';
import type { MoneyReader } from '../money/money.reader.js';
import type { SearchResults } from './search.types.js';
import type { SearchQuery } from './search.validation.js';

export class SearchService {
  constructor(
    private readonly tasks: TaskReader,
    private readonly habits: HabitReader,
    private readonly calendar: CalendarReader,
    private readonly notes: NotesReader,
    private readonly projects: ProjectsReader,
    private readonly goals: GoalsReader,
    private readonly money: MoneyReader
  ) {}

  public async search(userId: string, query: SearchQuery): Promise<SearchResults> {
    const { q, limit } = query;
    const [tasks, notes, habits, projects, events, goals, subscriptions] = await Promise.all([
      this.tasks.search(userId, q, limit),
      this.notes.search(userId, q, limit),
      this.habits.search(userId, q, limit),
      this.projects.search(userId, q, limit),
      this.calendar.search(userId, q, limit),
      this.goals.search(userId, q, limit),
      this.money.searchSubscriptions(userId, q, limit)
    ]);

    return { query: q, tasks, notes, habits, projects, events, goals, subscriptions };
  }
}
