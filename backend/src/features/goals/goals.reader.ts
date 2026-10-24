/**
 * src/features/goals/goals.reader.ts
 *
 * Read-only cross-feature reader for the goals domain (feature-architecture
 * rule 2). Added for F-07 so global search covers goals without letting the
 * search feature reach into goal tables directly.
 */

import { type Kysely } from 'kysely';
import { literalContainsPattern } from '../../core/pagination/search-pattern.js';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';

export interface GoalSearchItem {
  id: string;
  title: string;
  status: string;
}

export interface GoalsReader {
  search(userId: string, q: string, limit: number): Promise<GoalSearchItem[]>;
}

export class PgGoalsReader implements GoalsReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async search(userId: string, q: string, limit: number): Promise<GoalSearchItem[]> {
    const pattern = literalContainsPattern(q);
    const rows = await this.db
      .selectFrom('goals')
      .select(['id', 'title', 'status'])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('title', 'ilike', pattern), eb('description', 'ilike', pattern)]))
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status
    }));
  }
}
