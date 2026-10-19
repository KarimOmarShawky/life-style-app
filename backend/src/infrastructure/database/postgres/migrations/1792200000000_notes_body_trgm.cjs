/**
 * Forward migration: trigram index on notes.body.
 *
 * R-14 residual: the existing idx_notes_trgm covers title only, so
 * substring/ILIKE search over note bodies (the largest text column)
 * had no trigram support. A separate single-column GIN index is used
 * instead of extending the title index because PostgreSQL uses a
 * multi-column GIN index only when the query constrains every column;
 * body-only predicates must remain index-accelerated on their own.
 * The pg_trgm extension already exists (1727300002000).
 */
exports.up = (pgm) => pgm.sql(`
  CREATE INDEX idx_notes_body_trgm ON notes USING gin (body gin_trgm_ops);
`);

exports.down = (pgm) => pgm.sql(`
  DROP INDEX IF EXISTS idx_notes_body_trgm;
`);
