-- READ ONLY CATALOG INVENTORY. No application table rows, SQL bodies,
-- connection strings, passwords, token hashes, session queries, IP addresses,
-- or connection parameters are selected. Object/role names and other metadata
-- can still be sensitive; review before sharing. Hashes are fingerprints, not
-- a confidentiality guarantee. Run only against the intended database, with
-- no other SQL statements; do not run any erasure or migration draft.
--
-- Captures role attributes/memberships, role/database setting NAMES only,
-- database/schema/relation/column/default ACLs, non-system SECURITY DEFINER
-- functions, triggers and incoming FKs, and a limited activity summary. It
-- cannot prove all privileges, safe function bodies, other databases/branches,
-- external writers, historical data, backup recovery, or actual runtime URL.
-- Activity visibility is restricted by PostgreSQL privileges and is only a
-- point-in-time observation, not proof that writers are stopped.
WITH
context AS (
  SELECT current_user AS editor, to_regrole('lifestyle_app') AS app_role,
         current_setting('server_version_num') AS server_version_num
),
user_schemas AS (
  SELECT n.* FROM pg_namespace n
  WHERE n.nspname <> 'information_schema' AND left(n.nspname, 3) <> 'pg_'
),
relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl,
         c.relrowsecurity, c.relforcerowsecurity, n.nspname
  FROM pg_class c JOIN user_schemas n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
),
report AS (
  SELECT 'environment'::text AS kind, 'current_database'::text AS object,
         jsonb_build_object('database', current_database(),
           'server_version_num', x.server_version_num,
           'editor_role', x.editor, 'runtime_role_exists', x.app_role IS NOT NULL,
           'database_owner', pg_get_userbyid(d.datdba),
           'editor_connect', has_database_privilege(x.editor, d.oid, 'CONNECT'),
           'editor_create', has_database_privilege(x.editor, d.oid, 'CREATE'),
           'runtime_connect', CASE WHEN x.app_role IS NOT NULL THEN has_database_privilege(x.app_role, d.oid, 'CONNECT') END,
           'runtime_create', CASE WHEN x.app_role IS NOT NULL THEN has_database_privilege(x.app_role, d.oid, 'CREATE') END) AS detail
  FROM pg_database d CROSS JOIN context x WHERE d.datname = current_database()
  UNION ALL
  SELECT 'role', r.rolname::text,
         jsonb_build_object('login', r.rolcanlogin, 'superuser', r.rolsuper,
           'create_role', r.rolcreaterole, 'create_database', r.rolcreatedb,
           'replication', r.rolreplication, 'bypass_rls', r.rolbypassrls,
           'inherit', r.rolinherit, 'password_expiry_set', r.rolvaliduntil IS NOT NULL)
  FROM pg_roles r
  UNION ALL
  SELECT 'membership', pg_get_userbyid(m.member)::text || ' -> ' || pg_get_userbyid(m.roleid)::text,
         jsonb_build_object('grantor', pg_get_userbyid(m.grantor), 'admin_option', m.admin_option,
           'inherit_option', to_jsonb(m)->'inherit_option', 'set_option', to_jsonb(m)->'set_option')
  FROM pg_auth_members m
  UNION ALL
  SELECT 'role_setting', COALESCE(r.rolname, 'ALL ROLES')::text || ' / ' ||
           COALESCE(d.datname, 'ALL DATABASES')::text || ' / ' || split_part(s.value, '=', 1),
         jsonb_build_object('setting_name', split_part(s.value, '=', 1))
  FROM pg_db_role_setting rs
  LEFT JOIN pg_roles r ON r.oid = rs.setrole
  LEFT JOIN pg_database d ON d.oid = rs.setdatabase
  CROSS JOIN LATERAL unnest(rs.setconfig) AS s(value)
  WHERE rs.setdatabase = 0 OR d.datname = current_database()
  UNION ALL
  SELECT 'database_acl', COALESCE(r.rolname, 'PUBLIC')::text || ' / ' || a.privilege_type,
         jsonb_build_object('grantee', COALESCE(r.rolname, 'PUBLIC'),
           'privilege', a.privilege_type, 'grantable', a.is_grantable)
  FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE d.datname = current_database()
  UNION ALL
  SELECT 'schema', n.nspname::text,
         jsonb_build_object('owner', pg_get_userbyid(n.nspowner),
           'editor_usage', has_schema_privilege(x.editor, n.oid, 'USAGE'),
           'editor_create', has_schema_privilege(x.editor, n.oid, 'CREATE'),
           'runtime_usage', CASE WHEN x.app_role IS NOT NULL THEN has_schema_privilege(x.app_role, n.oid, 'USAGE') END,
           'runtime_create', CASE WHEN x.app_role IS NOT NULL THEN has_schema_privilege(x.app_role, n.oid, 'CREATE') END)
  FROM user_schemas n CROSS JOIN context x
  UNION ALL
  SELECT 'schema_acl', n.nspname::text || ' / ' || COALESCE(r.rolname, 'PUBLIC')::text || ' / ' || a.privilege_type,
         jsonb_build_object('schema', n.nspname, 'grantee', COALESCE(r.rolname, 'PUBLIC'),
           'privilege', a.privilege_type, 'grantable', a.is_grantable)
  FROM user_schemas n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  UNION ALL
  SELECT 'relation', r.nspname::text || '.' || r.relname::text,
         jsonb_build_object('schema', r.nspname, 'name', r.relname, 'kind', r.relkind::text,
           'owner', pg_get_userbyid(r.relowner), 'row_security', r.relrowsecurity,
           'force_row_security', r.relforcerowsecurity)
  FROM relations r
  UNION ALL
  SELECT 'relation_acl', r.nspname::text || '.' || r.relname::text || ' / ' || COALESCE(g.rolname, 'PUBLIC')::text || ' / ' || a.privilege_type,
         jsonb_build_object('schema', r.nspname, 'name', r.relname,
           'grantee', COALESCE(g.rolname, 'PUBLIC'), 'privilege', a.privilege_type, 'grantable', a.is_grantable)
  FROM relations r CROSS JOIN LATERAL aclexplode(COALESCE(r.relacl,
    CASE WHEN r.relkind = 'S' THEN acldefault('S', r.relowner) ELSE acldefault('r', r.relowner) END)) a
  LEFT JOIN pg_roles g ON g.oid = a.grantee
  UNION ALL
  SELECT 'target_effective', r.nspname::text || '.' || r.relname::text || ' / ' || g.rolname::text,
         jsonb_build_object('schema', r.nspname, 'name', r.relname, 'role', g.rolname,
           'database_connect', has_database_privilege(g.oid, current_database(), 'CONNECT'),
           'schema_usage', has_schema_privilege(g.oid, r.nspname, 'USAGE'),
           'table_select', has_table_privilege(g.oid, r.oid, 'SELECT'),
           'table_insert', has_table_privilege(g.oid, r.oid, 'INSERT'),
           'column_insert', has_any_column_privilege(g.oid, r.oid, 'INSERT'),
           'table_update', has_table_privilege(g.oid, r.oid, 'UPDATE'),
           'column_update', has_any_column_privilege(g.oid, r.oid, 'UPDATE'),
           'table_delete', has_table_privilege(g.oid, r.oid, 'DELETE'),
           'table_truncate', has_table_privilege(g.oid, r.oid, 'TRUNCATE'))
  FROM relations r CROSS JOIN pg_roles g
  WHERE g.rolcanlogin AND r.nspname = 'public' AND r.relkind IN ('r', 'p') AND r.relname IN
    ('transactions', 'budgets', 'categories', 'ingest_tokens', 'wallet_accounts', 'wallet_account_sessions',
     'wallet_owned_records', 'financial_retirement_state', 'subscriptions', 'reminders', 'audit_logs')
  UNION ALL
  SELECT 'column_acl', r.nspname::text || '.' || r.relname::text || '.' || col.attname::text || ' / ' || COALESCE(g.rolname, 'PUBLIC')::text || ' / ' || a.privilege_type,
         jsonb_build_object('schema', r.nspname, 'name', r.relname, 'column', col.attname,
           'grantee', COALESCE(g.rolname, 'PUBLIC'), 'privilege', a.privilege_type, 'grantable', a.is_grantable)
  FROM relations r JOIN pg_attribute col ON col.attrelid = r.oid AND col.attnum > 0 AND NOT col.attisdropped
  CROSS JOIN LATERAL aclexplode(col.attacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
  WHERE col.attacl IS NOT NULL
  UNION ALL
  SELECT 'default_acl', COALESCE(n.nspname, 'ALL SCHEMAS')::text || ' / ' || pg_get_userbyid(d.defaclrole)::text || ' / ' || d.defaclobjtype::text || ' / ' || COALESCE(g.rolname, 'PUBLIC')::text || ' / ' || a.privilege_type,
         jsonb_build_object('schema', n.nspname, 'owner', pg_get_userbyid(d.defaclrole),
           'object_type', d.defaclobjtype::text, 'grantee', COALESCE(g.rolname, 'PUBLIC'),
           'privilege', a.privilege_type, 'grantable', a.is_grantable)
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a LEFT JOIN pg_roles g ON g.oid = a.grantee
  WHERE d.defaclnamespace = 0 OR n.oid IN (SELECT oid FROM user_schemas)
  UNION ALL
  SELECT 'security_definer', n.nspname::text || '.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         jsonb_build_object('schema', n.nspname, 'name', p.proname,
           'owner', pg_get_userbyid(p.proowner), 'language', l.lanname,
           'source_hash', md5(p.prosrc),
           'search_path_settings', ARRAY(SELECT value FROM unnest(p.proconfig) AS value WHERE value LIKE 'search_path=%'),
           'public_execute', EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
           'editor_execute', has_function_privilege(x.editor, p.oid, 'EXECUTE'),
           'runtime_execute', CASE WHEN x.app_role IS NOT NULL THEN has_function_privilege(x.app_role, p.oid, 'EXECUTE') END,
           'extension', (SELECT e.extname FROM pg_depend dep JOIN pg_extension e ON e.oid = dep.refobjid
                         WHERE dep.classid = 'pg_proc'::regclass AND dep.objid = p.oid AND dep.refclassid = 'pg_extension'::regclass AND dep.deptype = 'e' LIMIT 1))
  FROM pg_proc p JOIN user_schemas n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang CROSS JOIN context x
  WHERE p.prosecdef
  UNION ALL
  SELECT 'function_acl', n.nspname::text || '.' || p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ') / ' || COALESCE(g.rolname, 'PUBLIC')::text || ' / ' || a.privilege_type,
         jsonb_build_object('schema', n.nspname, 'name', p.proname,
           'grantee', COALESCE(g.rolname, 'PUBLIC'), 'privilege', a.privilege_type,
           'grantor', pg_get_userbyid(a.grantor), 'grantable', a.is_grantable)
  FROM pg_proc p JOIN user_schemas n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
  LEFT JOIN pg_roles g ON g.oid = a.grantee WHERE p.prosecdef
  UNION ALL
  SELECT 'trigger', r.nspname::text || '.' || r.relname::text || ' / ' || t.tgname::text,
         jsonb_build_object('schema', r.nspname, 'table', r.relname, 'name', t.tgname,
           'enabled', t.tgenabled::text, 'function_schema', fn.nspname, 'function', p.proname,
           'security_definer', p.prosecdef, 'function_hash', md5(p.prosrc))
  FROM relations r JOIN pg_trigger t ON t.tgrelid = r.oid AND NOT t.tgisinternal
  JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_namespace fn ON fn.oid = p.pronamespace
  UNION ALL
  SELECT 'incoming_fk', cn.nspname::text || '.' || child.relname::text || ' / ' || k.conname::text,
         jsonb_build_object('child_schema', cn.nspname, 'child_table', child.relname,
           'parent_schema', pn.nspname, 'parent_table', parent.relname,
           'constraint', k.conname, 'definition_hash', md5(pg_get_constraintdef(k.oid, true)),
           'validated', k.convalidated)
  FROM pg_constraint k JOIN pg_class child ON child.oid = k.conrelid
  JOIN pg_namespace cn ON cn.oid = child.relnamespace
  JOIN pg_class parent ON parent.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = parent.relnamespace
  WHERE k.contype = 'f' AND pn.nspname = 'public' AND parent.relname IN
    ('transactions', 'budgets', 'categories', 'ingest_tokens', 'wallet_accounts', 'wallet_account_sessions', 'wallet_owned_records')
  UNION ALL
  SELECT 'activity_summary', COALESCE(a.usename, 'UNKNOWN')::text || ' / ' || COALESCE(a.state, 'HIDDEN')::text,
         jsonb_build_object('role', COALESCE(a.usename, 'UNKNOWN'), 'state', COALESCE(a.state, 'HIDDEN'), 'connections', count(*))
  FROM pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend'
  GROUP BY a.usename, a.state
)
SELECT kind, object, detail FROM report ORDER BY kind, object, detail::text;
