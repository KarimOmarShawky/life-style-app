-- Catalog-only inventory for manual compatibility investigation. READ ONLY.
-- Does not read customer rows, connection strings, passwords, or role names.
-- Object names are schema metadata; review output before sharing. Hashes of
-- expressions are fingerprints, not a confidentiality guarantee.
-- Scope: public relations and their columns, constraints, indexes and triggers.
-- It does not prove data completeness, runtime privileges, active writers,
-- other schemas, extension state, privileged functions, or migration history.
WITH relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
), inventory AS (
  SELECT 'relation'::text AS kind, r.relname::text AS relation_name,
         ''::text AS object_name,
         jsonb_build_object('kind', r.relkind::text, 'row_security', r.relrowsecurity,
                            'force_row_security', r.relforcerowsecurity) AS detail
  FROM relations r
  UNION ALL
  SELECT 'column', r.relname::text, a.attname::text,
         jsonb_build_object('type', format_type(a.atttypid, a.atttypmod),
           'not_null', a.attnotnull, 'identity', a.attidentity::text,
           'generated', a.attgenerated::text, 'default_present', d.oid IS NOT NULL)
  FROM relations r JOIN pg_attribute a ON a.attrelid = r.oid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint', r.relname::text, k.conname::text,
         jsonb_build_object('type', k.contype::text, 'validated', k.convalidated,
           'definition_hash', md5(pg_get_constraintdef(k.oid, true)))
  FROM relations r JOIN pg_constraint k ON k.conrelid = r.oid
  UNION ALL
  SELECT 'index', r.relname::text, idx.relname::text,
         jsonb_build_object('valid', i.indisvalid, 'ready', i.indisready,
           'definition_hash', md5(pg_get_indexdef(i.indexrelid)))
  FROM relations r JOIN pg_index i ON i.indrelid = r.oid
  JOIN pg_class idx ON idx.oid = i.indexrelid
  UNION ALL
  SELECT 'trigger', r.relname::text, t.tgname::text,
         jsonb_build_object('enabled', t.tgenabled::text,
           'security_definer', p.prosecdef,
           'definition_hash', md5(pg_get_triggerdef(t.oid, true)),
           'function_hash', md5(p.prosrc))
  FROM relations r JOIN pg_trigger t ON t.tgrelid = r.oid
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
)
SELECT kind, relation_name, object_name, detail
FROM inventory
ORDER BY kind, relation_name, object_name;
