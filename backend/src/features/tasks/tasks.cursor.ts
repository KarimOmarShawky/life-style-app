/**
 * src/features/tasks/tasks.cursor.ts
 *
 * Sort-aware keyset pagination for `GET /tasks` (V-07).
 *
 * The previous cursor always carried `{id, createdAt}` and the list query
 * compared only `id` (for `dueDate`) or `created_at`/`id` (for every other
 * non-default sort), so paging by due date, priority or updated time could
 * repeat or skip tasks. The cursor is now versioned and carries the selected
 * sort field, its direction and the last row's value for that field, and the
 * predicate below matches the ORDER BY exactly, including NULL placement.
 *
 * NULL placement follows PostgreSQL's default for the ORDER BY the repository
 * emits: `ASC` puts NULLs last, `DESC` puts NULLs first. The predicate mirrors
 * that so a page boundary can never be crossed twice or missed.
 *
 * Cursors are opaque to clients but deliberately not secret: they contain only
 * a task id and a sort value the caller already received.
 */

import { AppError } from '../../core/errors/app-error.js';

export type TaskSortField = 'dueDate' | 'priority' | 'createdAt' | 'updatedAt';
export type SortDirection = 'asc' | 'desc';

export const TASK_SORT_FIELDS: readonly TaskSortField[] = [
  'dueDate',
  'priority',
  'createdAt',
  'updatedAt'
];

export const TASK_CURSOR_VERSION = 2;

/** The sort value of the last row of a page. */
export type CursorSortValue = string | number | null;

export interface TaskCursor {
  /** Cursor format version; v1 cursors are rejected, never guessed. */
  v: number;
  /** The sort field the cursor belongs to. */
  sort: TaskSortField;
  /** The direction the cursor belongs to. */
  order: SortDirection;
  /** The last returned row's value for `sort` (null when that column is NULL). */
  value: CursorSortValue;
  /** The last returned row's id, used as the deterministic tie-breaker. */
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeTaskCursor(cursor: TaskCursor): string {
  const payload: TaskCursor = {
    v: TASK_CURSOR_VERSION,
    sort: cursor.sort,
    order: cursor.order,
    value: cursor.value,
    id: cursor.id
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

function invalidCursor(reason: string): AppError {
  return AppError.validation([
    { field: 'cursor', message: `cursor is not valid for this query (${reason})` }
  ]);
}

/**
 * Decodes a cursor and rejects anything that does not describe the requested
 * ordering. A malformed or sort-mismatched cursor is a client error, never a
 * silently ignored predicate: ignoring it would replay the first page forever.
 */
export function decodeTaskCursor(
  raw: string,
  sort: TaskSortField,
  order: SortDirection
): TaskCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw invalidCursor('not a base64 JSON object');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidCursor('not a JSON object');
  }
  const candidate = parsed as Partial<TaskCursor> & Record<string, unknown>;

  if (candidate.v !== TASK_CURSOR_VERSION) {
    // v1 cursors do not carry the sort value, so continuing from them would
    // silently fall back to the defective ordering.
    throw invalidCursor('unsupported cursor version');
  }
  if (candidate.sort !== sort) {
    throw invalidCursor(`cursor was issued for sort "${String(candidate.sort)}"`);
  }
  if (candidate.order !== order) {
    throw invalidCursor(`cursor was issued for order "${String(candidate.order)}"`);
  }
  if (typeof candidate.id !== 'string' || !UUID_PATTERN.test(candidate.id)) {
    throw invalidCursor('missing task id');
  }

  const value = candidate.value;
  const valueIsAcceptable =
    value === null ||
    (sort === 'priority' && typeof value === 'number' && Number.isInteger(value)) ||
    ((sort === 'dueDate' || sort === 'createdAt' || sort === 'updatedAt') &&
      typeof value === 'string' &&
      value.length > 0);
  if (!valueIsAcceptable) {
    throw invalidCursor(`missing ${sort} value`);
  }

  return {
    v: TASK_CURSOR_VERSION,
    sort,
    order,
    value: value as CursorSortValue,
    id: candidate.id
  };
}

/**
 * Builds the sort value a cursor stores for the last row of a page.
 * `row` is a raw database task row.
 */
export function cursorValueFor(
  row: { due_date?: unknown; priority?: unknown; created_at?: unknown; updated_at?: unknown },
  sort: TaskSortField
): CursorSortValue {
  const toIso = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };

  switch (sort) {
    case 'dueDate': {
      const value = row.due_date;
      if (value === null || value === undefined) return null;
      // `due_date` is a date column: keep the calendar day, not a timestamp.
      if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
      }
      return String(value).slice(0, 10);
    }
    case 'priority':
      return typeof row.priority === 'number' ? row.priority : Number(row.priority ?? 0);
    case 'updatedAt':
      return toIso(row.updated_at);
    case 'createdAt':
    default:
      return toIso(row.created_at);
  }
}
