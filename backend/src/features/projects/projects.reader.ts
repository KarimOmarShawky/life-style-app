/**
 * src/features/projects/projects.reader.ts
 *
 * Read-only cross-feature interface for the projects domain
 * (feature-architecture rule 2).
 */

import { type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';

export interface ProjectSearchItem {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
}

export interface ProjectsReader {
  search(userId: string, q: string, limit: number): Promise<ProjectSearchItem[]>;
}

export class PgProjectsReader implements ProjectsReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async search(userId: string, q: string, limit: number): Promise<ProjectSearchItem[]> {
    const pattern = `%${q}%`;
    const rows = await this.db
      .selectFrom('projects')
      .select(['id', 'name', 'description', 'color'])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('name', 'ilike', pattern), eb('description', 'ilike', pattern)]))
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color
    }));
  }
}
