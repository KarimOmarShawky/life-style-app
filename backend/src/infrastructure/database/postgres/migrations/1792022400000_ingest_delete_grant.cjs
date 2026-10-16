/** Forward-only repair: existing databases must receive the same purge grant as fresh ones. */
exports.up = (pgm) => pgm.sql(`
  DO $body$ BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifestyle_app') THEN
      GRANT DELETE ON ingest_tokens TO lifestyle_app;
    END IF;
  END $body$;
`);
// Do not revoke a grant that may predate this migration on some installations.
exports.down = () => { throw new Error('Forward-only permission repair; use a reviewed forward migration'); };
