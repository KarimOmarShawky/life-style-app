/**
 * Forward-only repair: the maintenance role needs SELECT on audit_logs
 * in addition to DELETE. PostgreSQL evaluates a DELETE ... WHERE clause
 * by reading rows, so a filtered delete fails with 42501 (insufficient
 * privilege) when the role cannot read the table. Fresh databases and
 * existing ones must both carry this grant for the audit-retention job.
 */
exports.up = (pgm) => pgm.sql(`
  DO $body$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_maintenance') THEN
      GRANT SELECT ON audit_logs TO lifestyle_maintenance;
    END IF;
  END $body$;
`);
// Do not revoke a grant that may predate this migration on some installations.
exports.down = () => { throw new Error('Forward-only permission repair; use a reviewed forward migration'); };
