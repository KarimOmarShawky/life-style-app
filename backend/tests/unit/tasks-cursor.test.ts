/**
 * tests/unit/tasks-cursor.test.ts
 *
 * V-07: the task list cursor is versioned and sort-aware, and the keyset
 * predicate matches the ORDER BY of the selected sort (including NULL
 * placement). The previous cursor carried only `{id, createdAt}`, so paging by
 * due date, priority or updated time repeated or skipped tasks.
 *
 * The SQL is compiled with Kysely only (no database connection): this asserts
 * the generated predicate, not query execution.
 */

import { describe, it, expect } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import type { DatabaseSchema } from '../../src/infrastructure/database/postgres/kysely.js';
import {
  TASK_CURSOR_VERSION,
  cursorValueFor,
  decodeTaskCursor,
  encodeTaskCursor,
  type TaskSortField
} from '../../src/features/tasks/tasks.cursor.js';
import { PgTasksRepository } from '../../src/features/tasks/tasks.repository.pg.js';
import { AppError } from '../../src/core/errors/app-error.js';

const ID = '11111111-1111-4111-8111-111111111111';

function compileHarness() {
  const executed: { sql: string; parameters: readonly unknown[] }[] = [];
  const query = async (text: string, values: readonly unknown[]) => {
    executed.push({ sql: text, parameters: values });
    return { rows: [], rowCount: 0, command: 'SELECT' };
  };
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: { connect: async () => ({ query, release: () => undefined }), end: async () => undefined } as never
    })
  });
  return { db, executed };
}

async function compiledTaskList(
  filter: Parameters<PgTasksRepository['list']>[1]
): Promise<string> {
  const { db, executed } = compileHarness();
  const repository = new PgTasksRepository(db);
  await repository.list('22222222-2222-4222-8222-222222222222', filter, '2026-10-29');
  return executed[0]!.sql;
}

describe('Sort-aware task keyset pagination (V-07)', () => {
  it('round-trips a cursor with its sort field, direction and sort value', () => {
    const cursor = encodeTaskCursor({
      v: TASK_CURSOR_VERSION,
      sort: 'priority',
      order: 'desc',
      value: 2,
      id: ID
    });
    expect(decodeTaskCursor(cursor, 'priority', 'desc')).toEqual({
      v: TASK_CURSOR_VERSION,
      sort: 'priority',
      order: 'desc',
      value: 2,
      id: ID
    });
  });

  it('rejects a cursor issued for another sort, another direction, or an older version', () => {
    const forDueDate = encodeTaskCursor({
      v: TASK_CURSOR_VERSION,
      sort: 'dueDate',
      order: 'asc',
      value: '2026-10-01',
      id: ID
    });
    const expectValidation = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('VALIDATION_ERROR');
        return;
      }
      throw new Error('expected a validation error');
    };

    expectValidation(() => decodeTaskCursor(forDueDate, 'createdAt', 'asc'));
    expectValidation(() => decodeTaskCursor(forDueDate, 'dueDate', 'desc'));

    const legacy = Buffer.from(JSON.stringify({ id: ID, createdAt: new Date().toISOString() })).toString('base64');
    expectValidation(() => decodeTaskCursor(legacy, 'createdAt', 'asc'));

    expectValidation(() => decodeTaskCursor('!!!not-base64-json!!!', 'priority', 'asc'));
    expectValidation(() =>
      decodeTaskCursor(
        encodeTaskCursor({ v: TASK_CURSOR_VERSION, sort: 'priority', order: 'asc', value: 1, id: 'not-a-uuid' }),
        'priority',
        'asc'
      )
    );
    expectValidation(() =>
      decodeTaskCursor(
        encodeTaskCursor({ v: TASK_CURSOR_VERSION, sort: 'dueDate', order: 'asc', value: null, id: ID }),
        'createdAt',
        'asc'
      )
    );
  });

  it('stores the selected sort value, not createdAt, in the next cursor', () => {
    const row = {
      due_date: '2026-10-05',
      priority: 3,
      created_at: new Date('2026-10-01T10:00:00.000Z'),
      updated_at: new Date('2026-10-02T11:00:00.000Z')
    };
    expect(cursorValueFor(row, 'dueDate')).toBe('2026-10-05');
    expect(cursorValueFor(row, 'priority')).toBe(3);
    expect(cursorValueFor(row, 'createdAt')).toBe('2026-10-01T10:00:00.000Z');
    expect(cursorValueFor(row, 'updatedAt')).toBe('2026-10-02T11:00:00.000Z');
    expect(cursorValueFor({ ...row, due_date: null }, 'dueDate')).toBeNull();
  });

  it.each<[TaskSortField, string, 'asc' | 'desc', RegExp]>([
    ['dueDate', '2026-10-05', 'asc', /"tasks"\."due_date" IS NULL\s+OR "tasks"\."due_date" > \$\d+::date/],
    ['dueDate', '2026-10-05', 'desc', /"tasks"\."due_date" < \$\d+::date/],
    ['priority', '2', 'asc', /"tasks"\."priority" IS NULL\s+OR "tasks"\."priority" > \$\d+::int/],
    ['updatedAt', '2026-10-05T00:00:00.000Z', 'desc', /"tasks"\."updated_at" < \$\d+::timestamptz/],
    ['createdAt', '2026-10-05T00:00:00.000Z', 'asc', /"tasks"\."created_at" > \$\d+::timestamptz/]
  ])('builds the %s keyset predicate for %s (%s)', async (sort, rawValue, order, pattern) => {
    const value: string | number = sort === 'priority' ? Number(rawValue) : rawValue;
    const cursor = encodeTaskCursor({
      v: TASK_CURSOR_VERSION,
      sort,
      order,
      value,
      id: ID
    });
    const text = await compiledTaskList({ sort, order, cursor, limit: 25 });

    // The predicate compares the selected column, then the id tie-breaker.
    expect(text).toMatch(pattern);
    expect(text).toMatch(/AND "tasks"\."id" [<>] \$\d+::uuid/);
    // The ORDER BY agrees with the cursor direction.
    expect(text).toMatch(
      new RegExp(
        `order by "(due_date|priority|created_at|updated_at)" ${order === 'asc' ? 'asc' : 'desc'}, "id" ${order === 'asc' ? 'asc' : 'desc'}`
      )
    );
  });

  it('continues inside the NULL block when an ASC cursor row had no value', async () => {
    const cursor = encodeTaskCursor({
      v: TASK_CURSOR_VERSION,
      sort: 'dueDate',
      order: 'asc',
      value: null,
      id: ID
    });
    const text = await compiledTaskList({ sort: 'dueDate', order: 'asc', cursor });
    expect(text).toMatch(/"tasks"\."due_date" IS NULL AND "tasks"\."id" > \$\d+::uuid/);
    expect(text).not.toMatch(/IS NULL OR/);
  });

  it('never re-selects the NULL block for a DESC cursor that already passed it', async () => {
    // PostgreSQL sorts NULLs FIRST for DESC, so a non-NULL cursor value has
    // already consumed every NULL row: including them again would repeat rows
    // page after page (V-07).
    const nonNullCursor = encodeTaskCursor({
      v: TASK_CURSOR_VERSION,
      sort: 'dueDate',
      order: 'desc',
      value: '2026-10-05',
      id: ID
    });
    const text = await compiledTaskList({ sort: 'dueDate', order: 'desc', cursor: nonNullCursor });
    expect(text).not.toMatch(/"tasks"\."due_date" IS NULL/);
    expect(text).toMatch(/"tasks"\."due_date" < \$\d+::date/);
    expect(text).toMatch(/AND "tasks"\."id" < \$\d+::uuid/);

    // A DESC cursor that sits on a NULL row must return the rest of the NULL
    // block and then every non-NULL row exactly once.
    const nullCursor = encodeTaskCursor({
      v: TASK_CURSOR_VERSION,
      sort: 'dueDate',
      order: 'desc',
      value: null,
      id: ID
    });
    const nullText = await compiledTaskList({ sort: 'dueDate', order: 'desc', cursor: nullCursor });
    expect(nullText).toMatch(/"tasks"\."due_date" IS NULL AND "tasks"\."id" < \$\d+::uuid/);
    expect(nullText).toMatch(/OR "tasks"\."due_date" IS NOT NULL/);
  });

  it('rejects a cursor that does not match the requested sort instead of ignoring it', async () => {
    const cursor = encodeTaskCursor({
      v: TASK_CURSOR_VERSION,
      sort: 'priority',
      order: 'asc',
      value: 1,
      id: ID
    });
    await expect(compiledTaskList({ sort: 'dueDate', order: 'asc', cursor })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('keeps the sort value and field in the emitted next cursor', async () => {
    const harness = compileHarness();
    // The first call returns one extra row so a next cursor is produced.
    let call = 0;
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: {
          connect: async () => ({
            query: async (text: string, values: readonly unknown[]) => {
              harness.executed.push({ sql: text, parameters: values });
              call += 1;
              return {
                rows:
                  call === 1
                    ? [
                        { id: ID, created_at: new Date('2026-10-01T00:00:00Z'), due_date: '2026-10-02', priority: 1 },
                        { id: '33333333-3333-4333-8333-333333333333', created_at: new Date('2026-10-02T00:00:00Z'), due_date: '2026-10-03', priority: 2 }
                      ]
                    : [],
                rowCount: 0,
                command: 'SELECT'
              };
            },
            release: () => undefined
          }),
          end: async () => undefined
        } as never
      })
    });

    const repository = new PgTasksRepository(db);
    const result = await repository.list('22222222-2222-4222-8222-222222222222', {
      sort: 'dueDate',
      order: 'asc',
      limit: 1
    });

    expect(result.nextCursor).not.toBeNull();
    const decoded = decodeTaskCursor(result.nextCursor!, 'dueDate', 'asc');
    expect(decoded).toMatchObject({ sort: 'dueDate', order: 'asc', value: '2026-10-02', id: ID });
    expect(decoded.value).not.toHaveProperty?.('createdAt');
    await db.destroy();
  });
});
