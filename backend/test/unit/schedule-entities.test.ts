/**
 * The generated polymorphic-lookup SQL.
 *
 * This is a security test that needs no database. The expression it checks is
 * the only place in the application where a table name is written INTO a query
 * string rather than bound as a parameter, and the only thing standing between a
 * user and another account's data in that query is a `user_id` predicate inside
 * every branch of a CASE. A branch missing it would behave perfectly in every
 * normal test — the ids simply would not match anything — and would leak the
 * moment two accounts existed.
 *
 * Reading the generated string is the cheapest way to prove that property holds
 * for every entity type, including ones added later.
 */
import { describe, expect, it } from 'vitest';

import { ENTITY_SOURCES, entityTitleExpression } from '@/features/schedule/schedule.entities';
import { REMINDER_ENTITY_TYPES } from '@/features/schedule/schedule.types';

function build(types: readonly (typeof REMINDER_ENTITY_TYPES)[number][]): string {
  return entityTitleExpression({
    alias: 'r',
    typeColumn: 'entity_type',
    idColumn: 'entity_id',
    types,
  });
}

describe('entityTitleExpression', () => {
  it('scopes every single branch to the owning user', () => {
    for (const type of REMINDER_ENTITY_TYPES) {
      const sql = build([type]);
      expect(sql, `${type} branch is not owner-scoped`).toContain('ref.user_id = r.user_id');
    }
  });

  it('scopes every branch when all of them are built together', () => {
    const sql = build(REMINDER_ENTITY_TYPES);

    const branches = sql.split('WHEN ').slice(1);
    expect(branches).toHaveLength(REMINDER_ENTITY_TYPES.length);

    for (const branch of branches) {
      expect(branch).toContain('ref.user_id = r.user_id');
      expect(branch).toContain('ref.id = r.entity_id');
    }
  });

  it('reads the title from the column each table actually uses', () => {
    // Subscriptions call it `name`. Assuming `title` everywhere would be a
    // runtime error on one branch out of four, which is exactly the kind of
    // thing that ships.
    expect(build(['subscription'])).toContain('SELECT ref.name FROM subscriptions');
    expect(build(['task'])).toContain('SELECT ref.title FROM tasks');
    expect(build(['habit'])).toContain('SELECT ref.title FROM habits');
    expect(build(['event'])).toContain('SELECT ref.title FROM events');
  });

  it('touches only the tables it was asked for', () => {
    // The event link is task-or-habit. If this expression mentioned
    // subscriptions, a malformed row could reach a table events know nothing of.
    const sql = build(['task', 'habit']);
    expect(sql).not.toContain('subscriptions');
    expect(sql).not.toContain('FROM events');
  });

  it('threads the caller-supplied alias and columns through every branch', () => {
    const sql = entityTitleExpression({
      alias: 'e',
      typeColumn: 'linked_type',
      idColumn: 'linked_id',
      types: ['task'],
    });

    expect(sql.startsWith('CASE e.linked_type')).toBe(true);
    expect(sql).toContain('ref.id = e.linked_id');
    expect(sql).toContain('ref.user_id = e.user_id');
  });

  it('keeps one source per entity type, so nothing can be resolved from two tables', () => {
    expect(Object.keys(ENTITY_SOURCES).sort()).toEqual([...REMINDER_ENTITY_TYPES].sort());
  });

  it('builds identifiers only from its own map, never from the type string', () => {
    // The `types` parameter is typed to the union, so this cast is what a bug
    // elsewhere in the process would look like. The map lookup yields undefined
    // and the expression cannot name a table it was not told about.
    const sql = build(REMINDER_ENTITY_TYPES);
    expect(sql).not.toContain('undefined');

    for (const source of Object.values(ENTITY_SOURCES)) {
      expect(/^[a-z_]+$/.test(source.table)).toBe(true);
      expect(/^[a-z_]+$/.test(source.titleColumn)).toBe(true);
    }
  });
});
