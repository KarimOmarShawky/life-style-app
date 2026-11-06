-- READ ONLY: catalog compatibility inspection; does not read application rows.
-- This is NOT an erasure procedure and does not prove the database target,
-- current runtime identity, backups, complete data visibility, or old-writer
-- shutdown. Run only after selecting the intended database. Do not export URLs.
WITH expected(name) AS (
  VALUES ('subscriptions'), ('reminders'), ('transactions'), ('budgets'),
    ('categories'), ('ingest_tokens'), ('wallet_owned_records'),
    ('wallet_account_sessions'), ('wallet_accounts'), ('audit_logs'),
    ('financial_retirement_state'), ('pgmigrations')
)
SELECT e.name AS table_name,
       c.oid IS NOT NULL AS table_exists,
       COALESCE(c.relrowsecurity, false) AS row_security,
       COALESCE(c.relforcerowsecurity, false) AS force_row_security,
       CASE WHEN c.oid IS NULL THEN NULL
            ELSE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
       END AS editor_is_owner,
       (SELECT count(*) FROM pg_trigger t
        WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS custom_triggers,
       (SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = c.oid AND NOT t.tgisinternal AND p.prosecdef)
         AS security_definer_triggers
FROM expected e
LEFT JOIN pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.name
  AND c.relkind IN ('r', 'p')
ORDER BY e.name;
