/**
 * src/features/calendar/calendar.reader.ts
 *
 * Read-only cross-feature interface for the calendar domain
 * (feature-architecture rule 2).
 */

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../infrastructure/database/postgres/kysely.js';

export interface EventReaderItem {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
}

export interface CalendarReader {
  listForDate(userId: string, date: string, timezone: string): Promise<EventReaderItem[]>;
  search(userId: string, q: string, limit: number): Promise<EventReaderItem[]>;
}

const EVENT_FIELDS = ['id', 'title', 'start_at', 'end_at', 'all_day', 'location'] as const;

function toEventItem(row: Record<string, unknown>): EventReaderItem {
  return {
    id: row.id as string,
    title: row.title as string,
    startAt: (row.start_at as Date).toISOString(),
    endAt: (row.end_at as Date).toISOString(),
    allDay: Boolean(row.all_day),
    location: (row.location as string | null) ?? null
  };
}

export class PgCalendarReader implements CalendarReader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  public async listForDate(
    userId: string,
    date: string,
    timezone: string
  ): Promise<EventReaderItem[]> {
    // Events overlap the [date 00:00, date+1 00:00) window in the user's zone.
    const rows = await this.db
      .selectFrom('events')
      .select([...EVENT_FIELDS])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`(end_at AT TIME ZONE ${timezone})::date >= ${date}::date`)
      .where(sql<boolean>`(start_at AT TIME ZONE ${timezone})::date <= ${date}::date`)
      .orderBy('start_at', 'asc')
      .execute();
    return rows.map((row) => toEventItem(row as unknown as Record<string, unknown>));
  }

  public async search(userId: string, q: string, limit: number): Promise<EventReaderItem[]> {
    const pattern = `%${q}%`;
    const rows = await this.db
      .selectFrom('events')
      .select([...EVENT_FIELDS])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('title', 'ilike', pattern), eb('location', 'ilike', pattern)]))
      .orderBy('start_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map((row) => toEventItem(row as unknown as Record<string, unknown>));
  }
}
