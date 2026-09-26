/**
 * Note query-filter unit tests.
 *
 * `buildNoteFilter` decides which documents a request can reach, so these
 * assertions are security tests that happen not to need a database. They check
 * the filter document itself rather than the rows it returns, which is the only
 * way to prove the owner condition is present in EVERY shape the builder can
 * produce.
 */
import { describe, expect, it } from 'vitest';

import { buildNoteFilter } from '@/features/notes/note.repository';
import type { Cursor } from '@/core/utils/pagination';
import type { AppError } from '@/core/errors';

const USER = 'a1b2c3d4-0000-0000-0000-000000000000';
const OTHER_USER = 'b2c3d4e5-0000-0000-0000-000000000000';

function filterFor(
  overrides: Record<string, unknown> = {},
  cursor?: Cursor,
): Record<string, unknown> {
  return buildNoteFilter(USER, { archived: false, ...overrides }, cursor) as Record<
    string,
    unknown
  >;
}

describe('buildNoteFilter', () => {
  it('always scopes to the owner', () => {
    expect(filterFor()['userId']).toBe(USER);
  });

  it('keeps the owner condition when every other filter is applied', () => {
    const filter = filterFor(
      {
        tag: 'work',
        search: 'meeting',
        projectId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
        taskId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      },
      { createdAt: '2026-09-01T10:00:00.000Z', id: '507f1f77bcf86cd799439011' },
    );

    // The owner is a top-level equality, not one condition among many that a
    // later edit could accidentally drop into an $or.
    expect(filter['userId']).toBe(USER);
    expect(filter['userId']).not.toBe(OTHER_USER);
  });

  it('separates archived notes from live ones in every query', () => {
    expect(filterFor()['isArchived']).toBe(false);
    expect(filterFor({ archived: true })['isArchived']).toBe(true);
  });

  it('adds no conditions when nothing is filtered', () => {
    expect(filterFor()['$and']).toBeUndefined();
  });

  it('matches a tag against the array', () => {
    const conditions = filterFor({ tag: 'work' })['$and'] as Record<string, unknown>[];
    expect(conditions).toContainEqual({ tags: 'work' });
  });

  it('searches title and content case-insensitively', () => {
    const conditions = filterFor({ search: 'Meeting' })['$and'] as Record<string, unknown>[];
    const search = conditions.find((condition) => '$or' in condition) as {
      $or: { title?: RegExp; content?: RegExp }[];
    };

    expect(search.$or[0]?.title?.source).toBe('Meeting');
    expect(search.$or[0]?.title?.flags).toContain('i');
    expect(search.$or[1]?.content?.source).toBe('Meeting');
  });

  it('treats regular-expression metacharacters in a search as literal text', () => {
    // Unescaped, "c++" is a syntax error and "(a+)+$" is a denial of service
    // against our own process.
    const conditions = filterFor({ search: 'c++' })['$and'] as Record<string, unknown>[];
    const search = conditions.find((condition) => '$or' in condition) as {
      $or: { title?: RegExp }[];
    };

    const pattern = search.$or[0]?.title as RegExp;
    expect(pattern.test('learning c++ today')).toBe(true);
    expect(pattern.test('ccc')).toBe(false);
  });

  it('does not hang on a catastrophic backtracking pattern', () => {
    const conditions = filterFor({ search: '(a+)+$' })['$and'] as Record<string, unknown>[];
    const search = conditions.find((condition) => '$or' in condition) as {
      $or: { title?: RegExp }[];
    };
    const pattern = search.$or[0]?.title as RegExp;

    const started = Date.now();
    pattern.test('a'.repeat(40));
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('builds a composite keyset predicate', () => {
    const conditions = filterFor(
      {},
      {
        createdAt: '2026-09-01T10:00:00.000Z',
        id: '507f1f77bcf86cd799439011',
      },
    )['$and'] as Record<string, unknown>[];

    const keyset = conditions.find((condition) => '$or' in condition) as {
      $or: Record<string, unknown>[];
    };

    // Strictly older, OR same instant with a smaller id. The tie-break is what
    // stops a page boundary skipping or repeating a note.
    expect(keyset.$or).toHaveLength(2);
    expect(keyset.$or[0]).toHaveProperty('createdAt.$lt');
    expect(keyset.$or[1]).toHaveProperty('_id.$lt');
  });

  it('rejects a forged cursor whose id is not an ObjectId', () => {
    // Cursors are encoded, not signed, so a client can build one. A bad id must
    // become a clean 422 rather than a driver exception surfacing as a 500.
    try {
      filterFor({}, { createdAt: '2026-09-01T10:00:00.000Z', id: 'not-an-object-id' });
      expect.unreachable('a forged cursor must be rejected');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe('VALIDATION_ERROR');
      expect(appError.status).toBe(422);
      // The field name is what tells the client which value to stop sending.
      expect(appError.issues?.[0]?.field).toBe('cursor');
    }
  });

  it('keeps search and the cursor as separate conditions', () => {
    // Both contribute an $or. Merged into one object, the second would silently
    // overwrite the first and the page would return the wrong notes.
    const conditions = filterFor(
      { search: 'x' },
      {
        createdAt: '2026-09-01T10:00:00.000Z',
        id: '507f1f77bcf86cd799439011',
      },
    )['$and'] as Record<string, unknown>[];

    expect(conditions.filter((condition) => '$or' in condition)).toHaveLength(2);
  });
});
