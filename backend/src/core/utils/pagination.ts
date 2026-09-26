/**
 * Cursor (keyset) pagination (spec section 34).
 *
 * WHY NOT OFFSET. `LIMIT 20 OFFSET 10000` makes PostgreSQL walk and discard
 * 10,000 rows before returning anything, so deep pages get linearly slower. It
 * is also unstable: inserting a row while a user pages shifts every subsequent
 * offset, so they see a duplicate or miss an item.
 *
 * Keyset pagination carries the sort key of the last row seen and asks for
 * "rows after this one". Cost is constant per page and the result is stable
 * under concurrent writes.
 *
 * The key is the COMPOSITE `(created_at, id)`, not `created_at` alone. Two rows
 * created in the same millisecond would otherwise have the same cursor, and the
 * page boundary could skip or repeat one of them. The id breaks that tie.
 */
import { AppError, ErrorCode } from '@/core/errors';

/** Hard ceiling, regardless of what the client asks for. */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 20;

export interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface PageRequest {
  readonly limit: number;
  readonly cursor: Cursor | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * Encodes a cursor as base64url.
 *
 * This is ENCODING, not encryption or authentication. A client can decode and
 * forge one. That is acceptable because a forged cursor only changes which page
 * of *their own* rows they see: the owner filter is applied separately and is
 * not part of the cursor. Never put an ownership or permission value in here.
 */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw AppError.validation([{ field: 'cursor', message: 'cursor is malformed' }]);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('createdAt' in parsed) ||
    !('id' in parsed) ||
    typeof (parsed as Cursor).createdAt !== 'string' ||
    typeof (parsed as Cursor).id !== 'string'
  ) {
    throw AppError.validation([{ field: 'cursor', message: 'cursor is malformed' }]);
  }

  const cursor = parsed as Cursor;

  // The decoded values go straight into query parameters. They are still
  // parameterized, but a bad timestamp would surface as a confusing driver
  // error rather than a clean 422, so they are shape-checked here.
  if (Number.isNaN(Date.parse(cursor.createdAt))) {
    throw AppError.validation([{ field: 'cursor', message: 'cursor is malformed' }]);
  }

  return { createdAt: cursor.createdAt, id: cursor.id };
}

/**
 * Normalizes client paging input.
 *
 * `?limit=999999999` is clamped, not rejected: the request is answerable, just
 * not at that size, and a 422 would be unhelpfully pedantic.
 */
export function toPageRequest(input: {
  limit?: number | undefined;
  cursor?: string | undefined;
}): PageRequest {
  const requested = input.limit ?? DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(requested, 1), MAX_PAGE_SIZE);

  return {
    limit,
    cursor: input.cursor !== undefined ? decodeCursor(input.cursor) : undefined,
  };
}

/**
 * Builds a page from rows fetched with `limit + 1`.
 *
 * Asking for one extra row is how "is there another page?" is answered without
 * a second COUNT query, which on a large table costs more than the page itself.
 * The extra row is dropped before returning.
 */
export function buildPage<T extends { id: string; createdAt: Date }>(
  rows: readonly T[],
  limit: number,
): Page<T> {
  return buildPageWith(rows, limit, (row) => ({
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  }));
}

/**
 * The same page assembly for a list sorted by something other than `createdAt`.
 *
 * Expenses are ordered by the date the money was spent, not the date the row was
 * entered, because a list of last week's spending typed in today is unreadable
 * in entry order. The sort key changes, so the cursor has to change with it: a
 * cursor built from `created_at` cannot resume a scan ordered by `spent_on`.
 *
 * The `createdAt` field of `Cursor` therefore holds WHATEVER THE SORT KEY IS,
 * not necessarily a creation time. The name is historical and the value is
 * opaque to clients, so it is not worth an encoding change that would invalidate
 * every cursor already issued. What matters is that the key used to build a
 * cursor and the key used in the WHERE clause are the same one.
 */
export function buildPageWith<T>(
  rows: readonly T[],
  limit: number,
  toCursor: (row: T) => Cursor,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
  };
}

/** Guard for a sort column supplied by a client (spec section 14). */
export function assertAllowedSortField(field: string, allowed: readonly string[]): string {
  if (!allowed.includes(field)) {
    // Identifiers cannot be parameterized, so an unchecked value here would be
    // interpolated into SQL. The allowlist is the only thing preventing that.
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: `Cannot sort by "${field}".`,
      issues: [{ field: 'sort', message: `sort must be one of: ${allowed.join(', ')}` }],
    });
  }
  return field;
}
