/**
 * src/features/notes/notes.reader.ts
 *
 * Read-only cross-feature interface for the notes domain
 * (feature-architecture rule 2).
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';

export interface NoteSearchItem {
  id: string;
  title: string | null;
  excerpt: string | null;
  isPinned: boolean;
}

export interface NotesReader {
  search(userId: string, q: string, limit: number): Promise<NoteSearchItem[]>;
}

export class PgNotesReader implements NotesReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async search(userId: string, q: string, limit: number): Promise<NoteSearchItem[]> {
    const pattern = `%${q}%`;
    const rows = await this.db
      .selectFrom('notes')
      .select(['id', 'title', 'body', 'is_pinned'])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('title', 'ilike', pattern),
          eb('body', 'ilike', pattern),
          eb(sql`search_vector`, '@@', sql`plainto_tsquery('simple', ${q})`)
        ])
      )
      .orderBy('is_pinned', 'desc')
      .orderBy('updated_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      excerpt: row.body ? row.body.slice(0, 160) : null,
      isPinned: row.is_pinned
    }));
  }
}
