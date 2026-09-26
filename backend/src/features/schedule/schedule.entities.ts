/**
 * Where each polymorphic type lives, and the SQL that resolves one to a title.
 *
 * Separate from `schedule.references` — which queries the database — precisely
 * so this half can be tested with no database at all. What it produces is SQL
 * built from identifiers written here, and the property worth proving about it
 * is that EVERY branch is scoped by `user_id`. A missing predicate in one branch
 * would be invisible in normal use and would resolve another account's titles;
 * a unit test can read the generated string and see it.
 */
import type { ReminderEntityType } from './schedule.types';

/**
 * Where each polymorphic type lives, and what it calls its title.
 *
 * Subscriptions call it `name`; everything else calls it `title`. This map is
 * the ONLY place either identifier appears, and every value in it is a literal
 * written here — never a string from a request. Identifiers cannot be
 * parameterized, so that distinction is what keeps the generated SQL safe.
 */
export const ENTITY_SOURCES: Readonly<
  Record<ReminderEntityType, { table: string; titleColumn: string }>
> = {
  task: { table: 'tasks', titleColumn: 'title' },
  habit: { table: 'habits', titleColumn: 'title' },
  subscription: { table: 'subscriptions', titleColumn: 'name' },
  event: { table: 'events', titleColumn: 'title' },
};

/**
 * SQL that resolves a polymorphic reference to the target's title.
 *
 * Correlated subqueries rather than a chain of LEFT JOINs: only one branch of
 * the CASE is ever evaluated, so a row pointing at a task never touches the
 * subscriptions table. Each branch is scoped by `user_id` as well as by `id`, so
 * a reference to another user's row resolves to null even if one were somehow
 * stored — the resolution path cannot become a way to read across accounts.
 */
export function entityTitleExpression(options: {
  readonly alias: string;
  readonly typeColumn: string;
  readonly idColumn: string;
  readonly types: readonly ReminderEntityType[];
}): string {
  const { alias, typeColumn, idColumn, types } = options;

  const branches = types.map((type) => {
    const source = ENTITY_SOURCES[type];
    return (
      `WHEN '${type}' THEN (SELECT ref.${source.titleColumn} FROM ${source.table} ref ` +
      `WHERE ref.id = ${alias}.${idColumn} AND ref.user_id = ${alias}.user_id)`
    );
  });

  return `CASE ${alias}.${typeColumn} ${branches.join(' ')} END`;
}
