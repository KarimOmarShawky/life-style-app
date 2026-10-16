/**
 * src/features/notes/notes.repository.pg.ts
 *
 * Implements Section 4.3 & 6.6: Notes & Note Links PostgreSQL Repository.
 */

import { sql, type Kysely } from 'kysely';
import { literalContainsPattern } from '../../core/pagination/search-pattern.js';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';
import type { NotesRepository } from './notes.repository.js';
import type {
  NoteEntity,
  NoteLinkEntity,
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesFilter,
  CreateNoteLinkInput
} from './notes.types.js';
import type { TagCountDto } from './notes.dto.js';

interface NoteDbRow {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  tags: string[];
  is_pinned: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  version: number;
}

interface NoteLinkDbRow {
  id: string;
  user_id: string;
  note_id: string;
  task_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  habit_id: string | null;
  event_id: string | null;
  created_at: Date;
}

function toNoteEntity(row: NoteDbRow): NoteEntity {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    body: row.body,
    tags: Array.isArray(row.tags) ? row.tags : [],
    isPinned: row.is_pinned,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    deletedAt:
      row.deleted_at instanceof Date
        ? row.deleted_at
        : row.deleted_at
          ? new Date(row.deleted_at)
          : null,
    version: row.version
  };
}

function toNoteLinkEntity(row: NoteLinkDbRow): NoteLinkEntity {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    taskId: row.task_id,
    projectId: row.project_id,
    goalId: row.goal_id,
    habitId: row.habit_id,
    eventId: row.event_id,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
  };
}

export class PgNotesRepository implements NotesRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async createNote(
    userId: string,
    input: CreateNoteInput,
    links?: CreateNoteLinkInput[] | undefined
  ): Promise<{ note: NoteEntity; links: NoteLinkEntity[] }> {
    return await this.db.transaction().execute(async (trx) => {
      const noteRow = (await trx
        .insertInto('notes')
        .values({
          user_id: userId,
          title: input.title ?? null,
          body: input.body ?? '',
          tags: input.tags ?? [],
          is_pinned: input.isPinned ?? false
        })
        .returningAll()
        .executeTakeFirstOrThrow()) as unknown as NoteDbRow;

      const createdLinks: NoteLinkEntity[] = [];

      if (links && links.length > 0) {
        for (const link of links) {
          const linkRow = (await trx
            .insertInto('note_links')
            .values({
              user_id: userId,
              note_id: noteRow.id,
              task_id: link.taskId ?? null,
              project_id: link.projectId ?? null,
              goal_id: link.goalId ?? null,
              habit_id: link.habitId ?? null,
              event_id: link.eventId ?? null
            })
            .returningAll()
            .executeTakeFirstOrThrow()) as unknown as NoteLinkDbRow;

          createdLinks.push(toNoteLinkEntity(linkRow));
        }
      }

      return {
        note: toNoteEntity(noteRow),
        links: createdLinks
      };
    });
  }

  async findNoteById(userId: string, noteId: string): Promise<NoteEntity | null> {
    const row = (await this.db
      .selectFrom('notes')
      .selectAll()
      .where('id', '=', noteId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as unknown as NoteDbRow | undefined;

    return row ? toNoteEntity(row) : null;
  }

  async findNoteByIdWithDeleted(userId: string, noteId: string): Promise<NoteEntity | null> {
    const row = (await this.db
      .selectFrom('notes')
      .selectAll()
      .where('id', '=', noteId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as NoteDbRow | undefined;

    return row ? toNoteEntity(row) : null;
  }

  async listNotes(userId: string, filter: ListNotesFilter): Promise<NoteEntity[]> {
    let query = this.db.selectFrom('notes').selectAll().where('user_id', '=', userId);

    if (!filter.includeDeleted) {
      query = query.where('deleted_at', 'is', null);
    }

    if (filter.isPinned !== undefined) {
      query = query.where('is_pinned', '=', filter.isPinned);
    }

    if (filter.tag) {
      query = query.where(sql<boolean>`${filter.tag} = ANY(tags)`);
    }

    if (filter.q) {
      query = query.where(
        sql<boolean>`(search_vector @@ plainto_tsquery('simple', ${filter.q}) OR title ILIKE ${literalContainsPattern(filter.q)} ESCAPE '\\')`
      );
    }

    if (filter.taskId) {
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM note_links WHERE note_links.note_id = notes.id AND note_links.task_id = ${filter.taskId} AND note_links.user_id = ${userId})`
      );
    }

    if (filter.projectId) {
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM note_links WHERE note_links.note_id = notes.id AND note_links.project_id = ${filter.projectId} AND note_links.user_id = ${userId})`
      );
    }

    if (filter.goalId) {
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM note_links WHERE note_links.note_id = notes.id AND note_links.goal_id = ${filter.goalId} AND note_links.user_id = ${userId})`
      );
    }

    if (filter.habitId) {
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM note_links WHERE note_links.note_id = notes.id AND note_links.habit_id = ${filter.habitId} AND note_links.user_id = ${userId})`
      );
    }

    if (filter.eventId) {
      query = query.where(
        sql<boolean>`EXISTS (SELECT 1 FROM note_links WHERE note_links.note_id = notes.id AND note_links.event_id = ${filter.eventId} AND note_links.user_id = ${userId})`
      );
    }

    const rows = (await query
      .orderBy('is_pinned', 'desc')
      .orderBy('updated_at', 'desc')
      .execute()) as unknown as NoteDbRow[];

    return rows.map(toNoteEntity);
  }

  async updateNote(
    userId: string,
    noteId: string,
    input: UpdateNoteInput,
    expectedVersion?: number | undefined
  ): Promise<NoteEntity | null> {
    let query = this.db
      .updateTable('notes')
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.isPinned !== undefined ? { is_pinned: input.isPinned } : {}),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', noteId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null);

    if (expectedVersion !== undefined) {
      query = query.where('version', '=', expectedVersion);
    }

    const row = (await query.returningAll().executeTakeFirst()) as unknown as NoteDbRow | undefined;
    return row ? toNoteEntity(row) : null;
  }

  async softDeleteNote(userId: string, noteId: string): Promise<boolean> {
    const result = await this.db
      .updateTable('notes')
      .set({
        deleted_at: new Date(),
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', noteId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) > 0;
  }

  async restoreNote(userId: string, noteId: string): Promise<NoteEntity | null> {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const row = (await this.db
      .updateTable('notes')
      .set({
        deleted_at: null,
        updated_at: new Date(),
        version: sql<number>`version + 1`
      })
      .where('id', '=', noteId)
      .where('user_id', '=', userId)
      .where('deleted_at', 'is not', null)
      .where('deleted_at', '>=', cutoff)
      .returningAll()
      .executeTakeFirst()) as unknown as NoteDbRow | undefined;

    return row ? toNoteEntity(row) : null;
  }

  async countActiveNotes(userId: string): Promise<number> {
    const result = (await this.db
      .selectFrom('notes')
      .select(sql<number>`count(*)::int`.as('count'))
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()) as { count: number } | undefined;

    return result ? Number(result.count) : 0;
  }

  async createNoteLink(
    userId: string,
    noteId: string,
    link: CreateNoteLinkInput
  ): Promise<NoteLinkEntity> {
    const row = (await this.db
      .insertInto('note_links')
      .values({
        user_id: userId,
        note_id: noteId,
        task_id: link.taskId ?? null,
        project_id: link.projectId ?? null,
        goal_id: link.goalId ?? null,
        habit_id: link.habitId ?? null,
        event_id: link.eventId ?? null
      })
      .returningAll()
      .executeTakeFirstOrThrow()) as unknown as NoteLinkDbRow;

    return toNoteLinkEntity(row);
  }

  async listNoteLinks(userId: string, noteId: string): Promise<NoteLinkEntity[]> {
    const rows = (await this.db
      .selectFrom('note_links')
      .selectAll()
      .where('note_id', '=', noteId)
      .where('user_id', '=', userId)
      .orderBy('created_at', 'asc')
      .execute()) as unknown as NoteLinkDbRow[];

    return rows.map(toNoteLinkEntity);
  }

  async replaceNoteLinks(
    userId: string,
    noteId: string,
    links: CreateNoteLinkInput[]
  ): Promise<NoteLinkEntity[]> {
    return await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('note_links')
        .where('note_id', '=', noteId)
        .where('user_id', '=', userId)
        .execute();

      const createdLinks: NoteLinkEntity[] = [];
      for (const link of links) {
        const row = (await trx
          .insertInto('note_links')
          .values({
            user_id: userId,
            note_id: noteId,
            task_id: link.taskId ?? null,
            project_id: link.projectId ?? null,
            goal_id: link.goalId ?? null,
            habit_id: link.habitId ?? null,
            event_id: link.eventId ?? null
          })
          .returningAll()
          .executeTakeFirstOrThrow()) as unknown as NoteLinkDbRow;

        createdLinks.push(toNoteLinkEntity(row));
      }

      return createdLinks;
    });
  }

  async deleteNoteLink(userId: string, noteId: string, linkId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('note_links')
      .where('id', '=', linkId)
      .where('note_id', '=', noteId)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }

  async findNoteLinkById(
    userId: string,
    noteId: string,
    linkId: string
  ): Promise<NoteLinkEntity | null> {
    const row = (await this.db
      .selectFrom('note_links')
      .selectAll()
      .where('id', '=', linkId)
      .where('note_id', '=', noteId)
      .where('user_id', '=', userId)
      .executeTakeFirst()) as unknown as NoteLinkDbRow | undefined;

    return row ? toNoteLinkEntity(row) : null;
  }

  async listTags(userId: string): Promise<TagCountDto[]> {
    const result = await sql<{ tag: string; count: number | string }>`
      SELECT unnest(tags) AS tag, count(*)::int AS count
      FROM notes
      WHERE user_id = ${userId} AND deleted_at IS NULL
      GROUP BY tag
      ORDER BY count DESC, tag ASC
    `.execute(this.db);

    return result.rows.map((row) => ({
      tag: row.tag,
      count: Number(row.count)
    }));
  }
}
