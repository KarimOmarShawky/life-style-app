/**
 * REHEARSAL DRAFT ONLY — NOT A PRODUCTION MIGRATION OR DEPLOYMENT PROCEDURE.
 *
 * Test candidate scoped grants for an already-created, fresh restricted runtime
 * role after financial erasure. This does not create credentials, provision a
 * role, reconcile migration history, disable old owner connections or writers,
 * establish a safe maintenance role, verify backups, or upgrade a legacy DB.
 * Do not copy to automatic migrations or execute against Neon or production.
 *
 * Run inside a transaction: all preconditions and grants must commit together.
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $preflight$
    DECLARE
      runtime record;
      relation record;
      inherited record;
    BEGIN
      SELECT * INTO runtime FROM pg_roles WHERE rolname = 'lifestyle_app';
      IF NOT FOUND OR NOT runtime.rolcanlogin OR runtime.rolsuper OR runtime.rolcreatedb
         OR runtime.rolcreaterole OR runtime.rolreplication OR runtime.rolbypassrls THEN
        RAISE EXCEPTION 'A fresh nonprivileged lifestyle_app login is required';
      END IF;
      FOR inherited IN SELECT oid, rolname FROM pg_roles
        WHERE rolname <> 'lifestyle_app' AND pg_has_role('lifestyle_app', oid, 'MEMBER')
      LOOP
        RAISE EXCEPTION 'Runtime may assume another role: %', inherited.rolname;
      END LOOP;
      IF NOT has_database_privilege('lifestyle_app', current_database(), 'CONNECT') THEN
        RAISE EXCEPTION 'Runtime has no database CONNECT privilege';
      END IF;
      IF has_schema_privilege('lifestyle_app', 'public', 'CREATE') OR
         has_database_privilege('lifestyle_app', current_database(), 'CREATE') THEN
        RAISE EXCEPTION 'Runtime must not create schema objects';
      END IF;
      IF to_regclass('public.financial_retirement_state') IS NULL OR
         NOT EXISTS (SELECT 1 FROM public.financial_retirement_state WHERE feature = 'legacy_money_v1') THEN
        RAISE EXCEPTION 'Financial erasure marker missing';
      END IF;
      -- This only detects privileges in public; other schemas, functions and
      -- privileged out-of-band writers still need separate review.
      FOR relation IN
        SELECT c.oid, c.relname, c.relowner, c.relkind FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      LOOP
        IF pg_has_role('lifestyle_app', relation.relowner, 'MEMBER') THEN
          RAISE EXCEPTION 'Runtime may assume an object owner';
        END IF;
        IF relation.relkind <> 'S' AND current_setting('server_version_num')::integer >= 170000 THEN
          -- PostgreSQL 17+ includes MAINTAIN, which is not understood by 16.
          -- A fresh role must not have maintenance/locking privileges either.
          IF has_table_privilege('lifestyle_app', relation.oid, 'MAINTAIN') THEN
            RAISE EXCEPTION 'Runtime is not fresh or has inherited/PUBLIC MAINTAIN privilege';
          END IF;
        END IF;
        IF relation.relkind = 'S' THEN
          IF has_sequence_privilege('lifestyle_app', relation.oid, 'USAGE,SELECT,UPDATE') THEN
            RAISE EXCEPTION 'Runtime is not fresh or has inherited/PUBLIC sequence privileges';
          END IF;
        ELSIF relation.relname = 'financial_retirement_state' THEN
          IF NOT has_table_privilege('lifestyle_app', relation.oid, 'SELECT') THEN
            RAISE EXCEPTION 'Runtime must be able to read the retirement marker';
          END IF;
          IF has_table_privilege('lifestyle_app', relation.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
             has_any_column_privilege('lifestyle_app', relation.oid, 'INSERT') OR
             has_any_column_privilege('lifestyle_app', relation.oid, 'UPDATE') THEN
            RAISE EXCEPTION 'Runtime can modify the retirement marker';
          END IF;
        ELSIF relation.relname = 'ingest_tokens' THEN
          -- The erasure draft grants only the legacy revocation column; it
          -- must not be mistaken for broad write or inherited access.
          IF has_table_privilege('lifestyle_app', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
             has_any_column_privilege('lifestyle_app', relation.oid, 'SELECT') OR
             has_any_column_privilege('lifestyle_app', relation.oid, 'INSERT') OR EXISTS (
               SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = relation.oid AND a.attnum > 0 AND NOT a.attisdropped
                 AND a.attname <> 'revoked_at'
                 AND has_column_privilege('lifestyle_app', relation.oid, a.attnum, 'UPDATE')
             ) THEN
            RAISE EXCEPTION 'Runtime is not fresh or has inherited/PUBLIC privileges';
          END IF;
        ELSIF has_table_privilege('lifestyle_app', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
           has_any_column_privilege('lifestyle_app', relation.oid, 'SELECT') OR
           has_any_column_privilege('lifestyle_app', relation.oid, 'INSERT') OR
           has_any_column_privilege('lifestyle_app', relation.oid, 'UPDATE') THEN
          RAISE EXCEPTION 'Runtime is not fresh or has inherited/PUBLIC privileges';
        END IF;
      END LOOP;
    END
    $preflight$;

    GRANT USAGE ON SCHEMA public TO lifestyle_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      public.users, public.auth_sessions, public.refresh_tokens, public.push_devices,
      public.goals, public.milestones, public.projects, public.recurring_tasks,
      public.habits, public.recurrences, public.tasks, public.timer_sessions,
      public.habit_checkins, public.notes, public.note_links, public.events,
      public.subscriptions, public.reminders, public.password_reset_requests
      TO lifestyle_app;
    GRANT SELECT, DELETE ON public.categories, public.transactions, public.budgets,
      public.ingest_tokens TO lifestyle_app;
    GRANT UPDATE (revoked_at) ON public.ingest_tokens TO lifestyle_app;
    GRANT SELECT, INSERT ON public.audit_logs TO lifestyle_app;
    GRANT USAGE, SELECT ON SEQUENCE public.audit_logs_id_seq TO lifestyle_app;
  `);
};

exports.down = () => {
  throw new Error("Rehearsal-only grants are not an automatic migration");
};
