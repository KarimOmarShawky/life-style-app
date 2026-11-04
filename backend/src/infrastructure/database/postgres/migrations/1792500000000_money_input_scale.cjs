/**
 * Preserve the number of fractional digits actually entered for money amounts.
 * NULL is deliberately retained for historical rows: NUMERIC(19,4) padding
 * makes the original text unrecoverable, so backfilling would invent data.
 */
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE transactions ADD COLUMN amount_scale SMALLINT
      CHECK (amount_scale IS NULL OR (amount_scale BETWEEN 0 AND 4 AND amount = trunc(amount, amount_scale)));
    ALTER TABLE subscriptions ADD COLUMN amount_scale SMALLINT
      CHECK (amount_scale IS NULL OR (amount_scale BETWEEN 0 AND 4 AND amount = trunc(amount, amount_scale)));
    ALTER TABLE budgets ADD COLUMN amount_scale SMALLINT
      CHECK (amount_scale IS NULL OR (amount_scale BETWEEN 0 AND 4 AND amount_limit = trunc(amount_limit, amount_scale)));
  `);
};

exports.down = () => {
  throw new Error('Money input scale is forward-only; dropping it would destroy provenance');
};
