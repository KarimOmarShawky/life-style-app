import type pg from 'pg';

/**
 * Fail closed before starting API listeners or worker consumers on a database
 * restored from before the irreversible financial erasure. The marker proves
 * the atomic migration committed, not that later partial imports or external
 * backup copies were erased. The query reads catalog metadata, not user data.
 */
export async function assertFinancialRetirement(
  pool: Pick<pg.Pool, 'query'>,
  required: boolean
): Promise<void> {
  if (!required) return;
  try {
    const result = await pool.query<{ completed: boolean; protected: boolean }>(`
      WITH targets(name, allow_update) AS (
        VALUES ('categories', false), ('transactions', false), ('budgets', false),
          ('ingest_tokens', true), ('wallet_owned_records', false),
          ('wallet_account_sessions', false), ('wallet_accounts', false),
          ('financial_retirement_state', false)
      ), relations AS (
        SELECT t.name, t.allow_update, c.oid, c.relowner
        FROM targets t
        LEFT JOIN pg_namespace n ON n.nspname = 'public'
        LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.name AND c.relkind IN ('r', 'p')
      ), assumable AS (
        SELECT r.oid, r.rolsuper FROM pg_roles r WHERE pg_has_role(current_user, r.oid, 'MEMBER')
      )
      SELECT EXISTS (
        SELECT 1 FROM public.financial_retirement_state WHERE feature = 'legacy_money_v1'
      ) AS completed,
      (SELECT count(*) = 8 AND count(oid) = 8 FROM relations)
      AND NOT EXISTS (
        SELECT 1 FROM relations t CROSS JOIN assumable r
        WHERE r.rolsuper OR pg_has_role(r.oid, t.relowner, 'MEMBER')
          OR has_table_privilege(r.oid, t.oid, 'INSERT')
          OR has_any_column_privilege(r.oid, t.oid, 'INSERT')
          OR (NOT t.allow_update AND (
            has_table_privilege(r.oid, t.oid, 'UPDATE')
            OR has_any_column_privilege(r.oid, t.oid, 'UPDATE')
          ))
          OR (t.name = 'financial_retirement_state' AND (
            has_table_privilege(r.oid, t.oid, 'DELETE') OR has_table_privilege(r.oid, t.oid, 'TRUNCATE')
          ))
      ) AS protected
    `);
    if (result.rows.length === 1 && result.rows[0]?.completed && result.rows[0]?.protected) return;
  } catch {
    // Deliberately omit DB errors, URLs and row contents from logs.
  }
  throw new Error('Financial retirement verification failed; service startup blocked');
}
